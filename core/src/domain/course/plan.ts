import {record,fields,text,finite} from '../../shared/validation.ts';
export interface PlanDay {day:number;unit:string;title:string;topics:string[];tasks:{id:string;kind:string;title:string;minutes:number}[]}
export interface CoursePlan {courseId:string;title:string;version:number;startDate:string;endDate:string;evidenceStatus:'not_imported';sources:{path:string;sha256:string}[];days:PlanDay[]}
export function parsePlans(value:unknown):CoursePlan[]{
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>100)throw new Error('Invalid course plans');
  const ids=new Set<string>();
  return value.map(raw=>{
    const p=record(raw);fields(p,['courseId','title','version','startDate','endDate','evidenceStatus','sources','days']);
    text(p.courseId,'course ID');text(p.title,'course title',1000);
    if(ids.has(String(p.courseId)))throw new Error('Duplicate course plan');ids.add(String(p.courseId));
    if(!Number.isSafeInteger(p.version)||Number(p.version)<1)throw new Error('Invalid plan version');
    for(const key of ['startDate','endDate'])if(typeof p[key]!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(String(p[key]))||!Number.isFinite(Date.parse(String(p[key]))))throw new Error('Invalid fixed plan date');
    if(String(p.endDate)<String(p.startDate))throw new Error('Invalid plan date order');
    if(p.evidenceStatus!=='not_imported')throw new Error('Plan definitions cannot import learner evidence');
    if(!Array.isArray(p.sources)||!p.sources.length||p.sources.length>10)throw new Error('Plan provenance is required');
    for(const source of p.sources){const s=record(source);fields(s,['path','sha256']);text(s.path,'source path',2000);if(typeof s.sha256!=='string'||!/^[0-9a-f]{64}$/i.test(s.sha256))throw new Error('Invalid source hash');}
    if(!Array.isArray(p.days)||!p.days.length||p.days.length>366)throw new Error('Invalid plan days');
    const days=new Set<number>();
    for(const day of p.days){
      const d=record(day);fields(d,['day','unit','title','topics','tasks']);
      if(!Number.isSafeInteger(d.day)||Number(d.day)<1||days.has(Number(d.day)))throw new Error('Invalid/duplicate plan day');days.add(Number(d.day));
      text(d.unit,'topic ID');text(d.title,'day title',1000);
      if(!Array.isArray(d.topics)||d.topics.length>100)throw new Error('Invalid topics');for(const topic of d.topics)text(topic,'topic',2000);
      if(!Array.isArray(d.tasks)||d.tasks.length>30)throw new Error('Invalid teaching tasks');
      for(const task of d.tasks){const item=record(task);fields(item,['id','kind','title','minutes']);text(item.id,'task ID');text(item.kind,'task kind');text(item.title,'task title',1000);const minutes=finite(item.minutes,'minutes');if(minutes<0||minutes>1440)throw new Error('Invalid task duration');}
    }
    return JSON.parse(JSON.stringify(p)) as CoursePlan;
  });
}
