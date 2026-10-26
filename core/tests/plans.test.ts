import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.ts';
const plan={courseId:'test-course',title:'Test course',version:1,startDate:'2026-10-19',endDate:'2026-11-17',evidenceStatus:'not_imported',sources:[{path:'test-plan.json',sha256:'a'.repeat(64)}],days:[{day:1,unit:'topic-a',title:'Mechanics',topics:['Force'],tasks:[{id:'t1',kind:'concept',title:'Concept lesson',minutes:30}]}]};
test('imported plan definitions preserve dates without importing learner mastery',async t=>{
  const {engine}=await fixture(undefined,undefined,[plan]);t.after(()=>engine.close());
  assert.equal(engine.plan('test-course').startDate,'2026-10-19');
  assert.equal(engine.plan('test-course').evidenceStatus,'not_imported');
  assert.equal(engine.plan('test-course',1).day?.unit,'topic-a');
  assert.equal(engine.state().attempts.length,0);
  assert.equal(engine.progress('test-course','topic-a').concept.state,'U');
  engine.advanceLesson('s','test-course','topic-a','mathematical_modeling','t1');
  assert.equal(engine.progress('test-course','topic-a').concept.state,'U');
});
test('plan revision is immutable and learner status fields are refused',async t=>{
  const {engine,databasePath}=await fixture(undefined,undefined,[plan]);engine.close();
  await assert.rejects(()=>fixture(databasePath,undefined,[{...plan,title:'Changed'}]),/immutable|version/i);
  await assert.rejects(()=>fixture(undefined,undefined,[{...plan,mastered:true}]),/field/i);
});

test('plan-only lesson stages restore across restart without importing learner scores',async t=>{
  const {engine,databasePath}=await fixture(undefined,undefined,[plan]);
  engine.advanceLesson('first-session','test-course','topic-a','mathematical_modeling','teach');
  engine.close();
  const resumed=await fixture(databasePath,undefined,[plan]);t.after(()=>resumed.engine.close());
  const course=resumed.engine.state().courses.find(c=>c.courseId==='test-course');
  assert.ok(course,'Plan-only course is missing from authoritative state');
  const topic=course.topics.find(t=>t.topicId==='topic-a');
  assert.equal(topic?.lesson.stage,'mathematical_modeling');
  assert.equal(topic?.lesson.exposureOnly,true);
  assert.equal(topic?.evidence.concept.state,'U');
  assert.equal(resumed.engine.state().plans.find(p=>p.courseId==='test-course')?.evidenceStatus,'not_imported');
  assert.equal(resumed.engine.state().attempts.length,0);
});
