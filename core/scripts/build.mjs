import {build} from 'esbuild';
import {mkdir,readFile,stat} from 'node:fs/promises';
await mkdir('lib',{recursive:true});
await build({entryPoints:['src/host/index.ts'],outfile:'lib/index.js',bundle:true,platform:'node',format:'esm',target:'node24',external:['node:*']});
await build({entryPoints:['src/agent/index.ts'],outfile:'lib/agent.js',bundle:true,platform:'node',format:'esm',target:'node24',external:['node:*']});
await build({entryPoints:['src/client/index.tsx'],outfile:'lib/client.js',bundle:true,platform:'browser',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime'],define:{'process.env.NODE_ENV':'"production"'},banner:{js:'window.__ModuleLoader__.load({id:"dsh-study-core",factory:(require)=>{var module={exports:{}};var exports=module.exports;'},footer:{js:'return module.exports;}});'}});
for(const file of ['lib/index.js','lib/client.js']){
  const source=await readFile(file,'utf8');if(/eval\(|new Function\(|dangerouslySetInnerHTML|innerHTML\s*=/.test(source))throw new Error('Forbidden executable HTML surface');
  console.log(file+': '+(await stat(file)).size+' bytes');
}
