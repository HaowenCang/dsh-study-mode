import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.ts';
test('schema 1 migrates to 3 while preserving issued attempts, help, and idempotency',async t=>{
  const {engine,databasePath}=await fixture();const a=engine.issue('s','q-single','i1');engine.hint('s',a.attemptId,'H1','h1');
  // Schema-1 fixture: remove only the additive v2 plan table, not learning records.
  engine.store.db.exec('DROP TABLE course_plans; PRAGMA user_version=1');engine.close();
  const next=await fixture(databasePath);t.after(()=>next.engine.close());
  assert.equal(next.engine.store.db.prepare('PRAGMA user_version').get()?.user_version,3);
  assert.equal(next.engine.attempt(a.attemptId).maxHelp,'H1');
  assert.equal(next.engine.issue('s','q-single','i1').attemptId,a.attemptId);
  next.engine.store.verify();
});
