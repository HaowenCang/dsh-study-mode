import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fixture} from './fixtures.ts';

function worker(path:string,mode:string,id?:string){return spawn(process.execPath,[new URL('./process-worker.ts',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),path,mode,...id?[id]:[]],{stdio:['pipe','pipe','pipe'],windowsHide:true});}

test('forced process exit retains committed help and rolls back an unfinished SQLite transaction',async t=>{
  const setup=await fixture();setup.engine.close();
  const child=worker(setup.databasePath,'uncommitted');t.after(()=>child.kill());
  let error='';child.stderr.on('data',b=>{error+=b.toString();});
  const closed=once(child,'close');
  const readiness=await Promise.race([once(child.stdout,'data'),closed.then(()=>{throw new Error('Worker closed before readiness: '+error);})]);
  const ready=JSON.parse(String(readiness[0]).trim()); assert.equal(ready.ready,true);
  child.kill('SIGKILL');await closed;
  const reopened=await fixture(setup.databasePath);t.after(()=>reopened.engine.close());
  assert.equal(reopened.engine.attempt(ready.attemptId).maxHelp,'H2');
  assert.equal(reopened.engine.store.events('synthetic-learner','partial').length,0);
  reopened.engine.store.verify();
});

test('concurrent processes retry one issue operation without duplicate attempt records',async t=>{
  const setup=await fixture();setup.engine.close();
  const results=await Promise.all(Array.from({length:6},async()=>{
    const child=worker(setup.databasePath,'issue','shared-id');let stdout='',stderr='';
    child.stdout.on('data',b=>{stdout+=b.toString();});child.stderr.on('data',b=>{stderr+=b.toString();});
    const [code]=await once(child,'close');assert.equal(code,0,stderr);return JSON.parse(stdout.trim());
  }));
  assert.equal(new Set(results.map(r=>r.attemptId)).size,1);
  const reopened=await fixture(setup.databasePath);t.after(()=>reopened.engine.close());
  assert.equal(reopened.engine.state().attempts.length,1);
  assert.equal(reopened.engine.history(results[0].attemptId).length,1);
});

test('consistent backup restores history and immutable SQL history refuses update/delete',async t=>{
  const {engine,databasePath}=await fixture();t.after(()=>engine.close());
  const a=engine.issue('s','q-single','i1');engine.submit('s',a.attemptId,['a'],'s1');
  assert.throws(()=>engine.store.db.exec('DELETE FROM events'),/immutable/);
  assert.throws(()=>engine.store.db.exec("UPDATE events SET body='{}'"),/immutable/);
  const backupPath=join(databasePath,'..','backup.db');await engine.store.backupTo(backupPath);
  const restored=await fixture(backupPath);t.after(()=>restored.engine.close());
  assert.equal(restored.engine.attempt(a.attemptId).grade?.outcome,'correct');restored.engine.store.verify();
});

test('unknown future schema is refused without downgrading stored data',async()=>{
  const {engine,databasePath}=await fixture();engine.close();
  const db=new DatabaseSync(databasePath);db.exec('PRAGMA user_version=99');db.close();
  await assert.rejects(()=>fixture(databasePath),/schema version/i);
  const check=new DatabaseSync(databasePath);assert.equal(check.prepare('PRAGMA user_version').get()?.user_version,99);check.close();
});
