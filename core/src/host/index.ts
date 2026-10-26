import {readFileSync,lstatSync,mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve,relative,dirname,isAbsolute,join} from 'node:path';
import {StudyEngine} from '../integration/engine.ts';
import {registerApi,type ApiContext} from './api.ts';
export const name='dsh-study-core';
export const inject=['tools','commands'];
export interface Config {databasePath?:string;catalogPath?:string;plansPath?:string;learnerId?:string;enableHumanReview?:boolean}
export function apply(ctx:ApiContext,config:Config={}):void{
  // Same home as the DSH launcher: a non-blank $DSH_HOME, otherwise ~/.dsh (DSH does not export the default).
  const configured=process.env.DSH_HOME?.trim();
  const root=configured?configured:join(homedir(),'.dsh');
  if(!isAbsolute(root))throw new Error('Study Core requires DSH_HOME to be an absolute path');
  const path=resolve(config.databasePath??resolve(root,'study-core/study.db'));
  const rel=relative(resolve(root),path);
  if(!rel||rel.startsWith('..')||isAbsolute(rel))throw new Error('Study database must remain inside explicit DSH_HOME');
  for(let cursor=path;;cursor=dirname(cursor)){
    try{if(lstatSync(cursor).isSymbolicLink())throw new Error('Study storage cannot traverse a symbolic link');}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    if(dirname(cursor)===cursor)break;
  }
  mkdirSync(dirname(path),{recursive:true});
  const catalog=JSON.parse(readFileSync(config.catalogPath??new URL('../data/synthetic.json',import.meta.url),'utf8'));
  const plans=config.plansPath?JSON.parse(readFileSync(config.plansPath,'utf8')):[];
  const engine=new StudyEngine({databasePath:path,catalog,plans,learnerId:config.learnerId??'local-learner'});
  ctx.effect(()=>()=>engine.close());registerApi(ctx,engine,config.enableHumanReview===true);
}
