import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {canonical} from '../shared/validation.ts';
export interface Event {id:string;learnerId:string;aggregate:string;sessionId:string;kind:string;time:string;payload:unknown}
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export class StudyStore {
  readonly db:DatabaseSync;
  constructor(path:string){
    mkdirSync(dirname(path),{recursive:true}); this.db=new DatabaseSync(path);
    try{
      this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      const version=this.db.prepare('PRAGMA user_version').get()?.user_version;
      if(version!==0&&version!==1&&version!==2) throw new Error('Unsupported study database schema version');
      if(version!==0)this.verify();
      this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS questions (id TEXT NOT NULL, version INTEGER NOT NULL, hash TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(id,version));
        CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, learner TEXT NOT NULL, aggregate_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, previous_hash TEXT NOT NULL, hash TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS events_aggregate ON events(learner,aggregate_id,seq);
        CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, result TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS course_plans (id TEXT NOT NULL, version INTEGER NOT NULL, hash TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(id,version));
        CREATE TRIGGER IF NOT EXISTS immutable_events_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'immutable event history'); END;
        CREATE TRIGGER IF NOT EXISTS immutable_events_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'immutable event history'); END;
        CREATE TRIGGER IF NOT EXISTS immutable_questions_update BEFORE UPDATE ON questions BEGIN SELECT RAISE(ABORT,'immutable question revision'); END;
        CREATE TRIGGER IF NOT EXISTS immutable_questions_delete BEFORE DELETE ON questions BEGIN SELECT RAISE(ABORT,'immutable question revision'); END;
        CREATE TRIGGER IF NOT EXISTS immutable_plans_update BEFORE UPDATE ON course_plans BEGIN SELECT RAISE(ABORT,'immutable course plan'); END;
        CREATE TRIGGER IF NOT EXISTS immutable_plans_delete BEFORE DELETE ON course_plans BEGIN SELECT RAISE(ABORT,'immutable course plan'); END;
        PRAGMA user_version=2; COMMIT;`);
      this.verify();
    }catch(error){this.db.close();throw error;}
  }
  verify():void{
    const integrity=this.db.prepare('PRAGMA integrity_check').get();
    if(integrity?.integrity_check!=='ok') throw new Error('Study database integrity check failed');
    let previous='';
    for(const row of this.db.prepare('SELECT * FROM events ORDER BY seq').all()){
      const body=String(row.body);
      if(row.previous_hash!==previous||row.hash!==digest(previous+'\n'+body)) throw new Error('Study event integrity chain mismatch');
      JSON.parse(body); previous=String(row.hash);
    }
    for(const row of this.db.prepare('SELECT * FROM questions').all()) if(row.hash!==digest(String(row.payload))) throw new Error('Question integrity mismatch');
    if(this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='course_plans'").get())for(const row of this.db.prepare('SELECT * FROM course_plans').all())if(row.hash!==digest(String(row.payload)))throw new Error('Course plan integrity mismatch');
  }
  registerQuestion(id:string,version:number,payload:unknown):void{
    const body=canonical(payload),hash=digest(body);
    const current=this.db.prepare('SELECT hash FROM questions WHERE id=? AND version=?').get(id,version);
    if(current&&current.hash!==hash) throw new Error('Question revision is immutable; increment version');
    this.db.prepare('INSERT OR IGNORE INTO questions VALUES(?,?,?,?)').run(id,version,hash,body);
    if(this.db.prepare('SELECT hash FROM questions WHERE id=? AND version=?').get(id,version)?.hash!==hash) throw new Error('Question revision is immutable; concurrent catalog version conflict');
  }
  registerPlan(id:string,version:number,payload:unknown):void{
    const body=canonical(payload),hash=digest(body);
    this.db.prepare('INSERT OR IGNORE INTO course_plans VALUES(?,?,?,?)').run(id,version,hash,body);
    if(this.db.prepare('SELECT hash FROM course_plans WHERE id=? AND version=?').get(id,version)?.hash!==hash)throw new Error('Course plan revision is immutable; increment version');
  }
  question(id:string,version:number):unknown{
    const row=this.db.prepare('SELECT payload FROM questions WHERE id=? AND version=?').get(id,version);
    if(!row) throw new Error('Unknown question revision'); return JSON.parse(String(row.payload));
  }
  transact<T>(id:string,request:unknown,work:()=>T):T{
    const hash=digest(canonical(request)); this.db.exec('BEGIN IMMEDIATE');
    try{
      const prior=this.db.prepare('SELECT request_hash,result FROM operations WHERE id=?').get(id);
      if(prior){if(prior.request_hash!==hash) throw new Error('Idempotency key conflict');this.db.exec('COMMIT');return JSON.parse(String(prior.result)) as T;}
      const result=work(); this.db.prepare('INSERT INTO operations VALUES(?,?,?)').run(id,hash,canonical(result));
      this.db.exec('COMMIT'); return JSON.parse(canonical(result)) as T;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  append(event:Omit<Event,'id'>):void{
    const value={...event,id:randomUUID()},body=canonical(value);
    const previous=String(this.db.prepare('SELECT hash FROM events ORDER BY seq DESC LIMIT 1').get()?.hash??'');
    this.db.prepare('INSERT INTO events(id,learner,aggregate_id,kind,body,previous_hash,hash) VALUES(?,?,?,?,?,?,?)').run(value.id,value.learnerId,value.aggregate,value.kind,body,previous,digest(previous+'\n'+body));
  }
  events(learner:string,aggregate?:string):Event[]{
    const rows=aggregate===undefined?this.db.prepare('SELECT body FROM events WHERE learner=? ORDER BY seq').all(learner):this.db.prepare('SELECT body FROM events WHERE learner=? AND aggregate_id=? ORDER BY seq').all(learner,aggregate);
    return rows.map(row=>JSON.parse(String(row.body)) as Event);
  }
  latest<T>(learner:string,aggregate:string):T|undefined{
    const row=this.db.prepare('SELECT body FROM events WHERE learner=? AND aggregate_id=? ORDER BY seq DESC LIMIT 1').get(learner,aggregate);
    return row?(JSON.parse(String(row.body)) as Event).payload as T:undefined;
  }
  async backupTo(path:string):Promise<void>{await backup(this.db,path);}
  close():void{this.db.close();}
}
