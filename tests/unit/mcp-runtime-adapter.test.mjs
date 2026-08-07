import test from 'node:test'; import assert from 'node:assert/strict';
import { createMcpRuntimeAdapter } from '../../apps/control-plane-executor/src/runtime/mcp-runtime-adapter.mjs';

test('adapter create and conflict patch ownership', async () => {
  const calls=[]; const a=createMcpRuntimeAdapter({apiBase:'https://k',token:'t',runtimeImage:'img',runtimeImageDigest:'sha256:abc',fetchImpl:async(url,init)=>{calls.push({url,init}); if(init.method==='POST') return {status:409,ok:false}; if(init.method==='GET') return {status:200,json:async()=>({metadata:{labels:{'in-falcone.io/tenant':'t','in-falcone.io/mcp-server':'s'},resourceVersion:'9'}})}; return {status:200,ok:true};}});
  await a.apply({tenantId:'t',workspaceId:'w',serverId:'s'}); assert.equal(calls[0].init.method,'POST'); assert.match(calls[0].init.body,/sha256:abc/); assert.equal(calls[2].init.method,'PATCH');
});
test('adapter refuses foreign conflict and fails closed', async()=>{const a=createMcpRuntimeAdapter({apiBase:'https://k',token:'t',runtimeImage:'img',fetchImpl:async(url,init)=>init.method==='POST'?{status:409,ok:false}:{status:200,json:async()=>({metadata:{labels:{}}})}}); await assert.rejects(()=>a.apply({tenantId:'t',serverId:'s'})); await assert.rejects(()=>createMcpRuntimeAdapter({}).apply({tenantId:'t',serverId:'s'}));});
test('adapter invoke safe success and non2xx', async()=>{let fail=false; const a=createMcpRuntimeAdapter({fetchImpl:async()=>fail?{ok:false,status:503}:{ok:true,json:async()=>({content:[]})}}); assert.deepEqual(await a.invoke({tenantId:'t',serverId:'s',tool:'x',args:{}}),{content:[]}); fail=true; assert.equal((await a.invoke({tenantId:'t',serverId:'s',tool:'x',args:{}})).isError,true);});
