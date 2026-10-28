import {dimensions,promptKey,type Question,type Dimension} from '../assessment/question.ts';
import {capability,type Attempt,type Capability} from '../assessment/attempt.ts';
export interface DimensionEvidence {state:Capability;attemptIds:string[]}
export function deriveProgress(items:{attempt:Attempt;question:Question}[]):Record<Dimension,DimensionEvidence>{
  const empty=():DimensionEvidence=>({state:'U',attemptIds:[]});
  const result:Record<Dimension,DimensionEvidence>={concept:empty(),modeling:empty(),derivation:empty(),calculation:empty(),transfer:empty()};
  for(const dimension of dimensions){
    const records=items.filter(i=>i.question.dimensions.includes(dimension)&&i.attempt.grade).sort((a,b)=>Date.parse(a.attempt.review?.at??a.attempt.submittedAt??a.attempt.issuedAt)-Date.parse(b.attempt.review?.at??b.attempt.submittedAt??b.attempt.issuedAt));
    const supported=records.filter(i=>capability(i.attempt,i.question)!=='U');
    result[dimension].attemptIds=supported.map(i=>i.attempt.attemptId);
    const latest=supported.at(-1);if(!latest)continue;
    result[dimension].state=capability(latest.attempt,latest.question);
    if(result[dimension].state==='P'){
      const last=latest.attempt;
      // A different item: another question with a different prompt, so a copied or re-authored prompt does not count (D-015).
      const earlier=supported.slice(0,-1).some(i=>capability(i.attempt,i.question)==='P'&&i.question.id!==latest.question.id&&promptKey(i.question.prompt)!==promptKey(latest.question.prompt)&&i.question.familyId===latest.question.familyId&&Date.parse(last.issuedAt)-Date.parse(i.attempt.submittedAt??i.attempt.issuedAt)>=24*60*60*1000);
      if(earlier)result[dimension].state='R';
    }
  }
  return result;
}
