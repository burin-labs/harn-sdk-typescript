import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync,spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
const root=process.cwd();
const bin=join(root,'node_modules/.bin/harn-typescript-codegen');
const raw=await readFile('pathological.ir.json','utf8');
const generate=spawnSync(bin,[],{input:'{"schema_version":"harn-codegen-request/1.0","role":"both","ir":'+raw+'}',encoding:'utf8',timeout:30000,maxBuffer:64*1024*1024});
assert.equal(generate.status,0,generate.stderr);
const response=JSON.parse(generate.stdout);
assert.equal(response.schema_version,'harn-codegen-response/1.0');
assert.deepEqual(response.identity,JSON.parse(raw).identity);
assert.equal(response.artifacts.length,5);
await mkdir('generated',{recursive:true});
for(const artifact of response.artifacts){assert(/^[a-z]+\.ts$/.test(artifact.path));await writeFile(join('generated',artifact.path),artifact.content);}
await writeFile('worker.ts',`import {defineHandlers,serve} from './generated/server.js';
import {ApplicationFailure} from '@burin-labs/harn';
serve(defineHandlers({echo:({input})=>input,mutate:({input})=>input,reject:()=>new ApplicationFailure({enum:'Failure' as const,variant:'Rejected' as const,fields:['declared'] as const}),scheduled:({input})=>input}),{maxConcurrency:2});\n`);
await writeFile('tsconfig.json',JSON.stringify({compilerOptions:{target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',strict:true,exactOptionalPropertyTypes:true,skipLibCheck:true,outDir:'app'},include:['generated/*.ts','worker.ts']}));
const compile=spawnSync(join(root,'node_modules/.bin/tsc'),['-p','tsconfig.json'],{encoding:'utf8',timeout:30000});
assert.equal(compile.status,0,compile.stdout+compile.stderr);
const worker=spawn(process.execPath,['app/worker.js'],{cwd:root,stdio:['pipe','pipe','pipe']});
let buffered='',stderr='';const answers=new Map(),waiters=new Map();
worker.stdout.setEncoding('utf8');worker.stderr.setEncoding('utf8');worker.stderr.on('data',chunk=>stderr+=chunk);
const parse=text=>JSON.parse(text,(_key,value,context)=>typeof value==='number'&&/^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/.test(context.source??'')?BigInt(context.source):value);
worker.stdout.on('data',chunk=>{buffered+=chunk;let newline;while((newline=buffered.indexOf('\n'))>=0){const text=buffered.slice(0,newline);buffered=buffered.slice(newline+1);const value=parse(text);if(waiters.has(value.id)){waiters.get(value.id)(value);waiters.delete(value.id);}else answers.set(value.id,value);}});
const meta='"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"packed-proof","version":"1"},"io.modelcontextprotocol/clientCapabilities":{}}';
async function request(id,method,params=''){
 const answer=answers.has(id)?Promise.resolve(answers.get(id)):new Promise(resolve=>waiters.set(id,resolve));
 worker.stdin.write('{"jsonrpc":"2.0","id":'+(typeof id==='bigint'?String(id):JSON.stringify(id))+',"method":'+JSON.stringify(method)+',"params":{'+(params?params+',':'')+meta+'}}\n');
 return await Promise.race([answer,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('protocol response timed out: '+method)),5000);timer.unref();})]);
}
try {
 const discover=await request(1n,'server/discover');assert(!discover.error);assert.deepEqual(discover.result._meta['com.harnlang/nativeBinding'].identity,response.identity);assert.equal(discover.result._meta['com.harnlang/nativeBinding'].max_concurrency,2n);
 const tools=await request('1','tools/list');assert(!tools.error);assert.deepEqual(tools.result.tools,parse(raw).mcp_tools);
 const payload=(await readFile('pathological.input.json','utf8')).trim();
 const echo=await request(9223372036854775807n,'tools/call','"name":"echo","arguments":{"input":'+payload+'}');
 assert(!echo.error,JSON.stringify(echo.error));assert.deepEqual(echo.result.structuredContent,parse(payload));
 worker.stdin.end();
 const [code,signal]=await once(worker,'exit');assert.equal(code,0,stderr);assert.equal(signal,null);
 const report={packed_install:true,sibling_checkout_required:false,artifacts:response.artifacts.length,strict_generated_compile:true,native_profile_verified:true,opaque_catalog_equal:true,exact_rich_values:true,numeric_string_ids_distinct:true,clean_eof_exit:true,identity:response.identity,pending:waiters.size,failing:[]};
 assert.equal(report.pending,0);await writeFile('report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(worker.exitCode===null)worker.kill('SIGKILL');}
