export const modes=['systematic_teaching','guided_practice','independent_assessment','review','ordinary_qa','research_discussion'] as const;
export type TeachingMode=typeof modes[number];
export function teachingMode(value:unknown):TeachingMode{
  if(!modes.includes(value as TeachingMode))throw new Error('Invalid teaching mode');
  return value as TeachingMode;
}
