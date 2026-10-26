import {StudyEngine} from '../src/integration/engine.ts';
import {catalog} from './fixtures.ts';
const [databasePath,mode,requestId]=process.argv.slice(2);
if(!databasePath||!mode)throw new Error('Missing worker arguments');
const engine=new StudyEngine({databasePath,catalog,learnerId:'synthetic-learner'});
if(mode==='issue'){
  console.log(JSON.stringify(engine.issue('s','q-single',requestId??'same-issue')));engine.close();
}else{
  const card=engine.issue('s','q-single','kill-issue');
  engine.hint('s',card.attemptId,'H2','kill-hint');
  if(mode==='uncommitted'){
    engine.store.db.exec('BEGIN IMMEDIATE');
    engine.store.append({learnerId:'synthetic-learner',aggregate:'partial',sessionId:'s',kind:'uncommitted',time:new Date().toISOString(),payload:{partial:true}});
  }
  console.log(JSON.stringify({ready:true,attemptId:card.attemptId}));
  process.stdin.resume();
}
