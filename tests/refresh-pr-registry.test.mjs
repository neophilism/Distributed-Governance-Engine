import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {reconcilePrSnapshots,fetchGithubPulls,refreshPrRegistry} from '../scripts/refresh-pr-registry.mjs';
import {parsePrRegistry} from '../registry/pr-contract.mjs';
const registry=JSON.parse(await readFile(new URL('../registry/prs.json',import.meta.url),'utf8'));
const observation='2026-10-18T21:28:58Z';
const pr=(n=30)=>({
 id:4950000000+n,number:n,title:'DCE-003: Contributor snapshot',state:'closed',
 draft:false,html_url:'https://github.com/'+registry.repository+'/pull/'+n,
 created_at:'2026-10-18T21:25:00Z',updated_at:'2026-10-18T21:28:00Z',
 merged_at:'2026-10-18T21:28:00Z',closed_at:'2026-10-18T21:28:00Z',
 head:{sha:'a'.repeat(40)},base:{ref:'main'},merge_commit_sha:'b'.repeat(40)
});
test('reconciliation uses verified GitHub IDs but never infers completed units',()=>{
 const before=structuredClone(registry),result=reconcilePrSnapshots(before,[pr()],observation);
 assert.equal(result.pullRequests[0].id,4950000030);
 assert.equal(result.pullRequests[0].number,30);
 assert.equal(result.observedAt,observation);
 assert.deepEqual(result.units,before.units);
 assert.deepEqual(before,registry);
 assert.equal(parsePrRegistry(JSON.stringify(result),registry.repository).pullRequests.length,1);
});
test('foreign, duplicate, malformed and contradictory snapshots are rejected',()=>{
 const malformed=[
  {...pr(),id:0},
  {...pr(),html_url:'https://github.com/attacker/other/pull/30'},
  {...pr(),head:{sha:'branch'}},
  {...pr(),state:'open',merged_at:'2026-10-18T21:28:00Z'},
  {...pr(),draft:'false'},
  {...pr(),base:{ref:'unknown'}},
 ];
 for(const entry of malformed)assert.throws(()=>reconcilePrSnapshots(registry,[entry],observation));
 assert.throws(()=>reconcilePrSnapshots(registry,[pr(),pr()],observation));
});
test('GitHub listing pages and token are bounded, and failures do not become empty snapshots',async()=>{
 let calls=0;
 const request=async(_url,init)=>{
  assert.match(init.headers.authorization,/^Bearer TEST$/);
  calls++;
  return{ok:true,json:async()=>calls===1?Array.from({length:100},(_,i)=>pr(i+1)):[]};
 };
 const result=await fetchGithubPulls(registry.repository,{token:'TEST',request});
 assert.equal(result.length,100);
 assert.equal(calls,2);
 await assert.rejects(fetchGithubPulls(registry.repository,{token:'TEST',request:async()=>({ok:false,status:503})}),/503/);
 await assert.rejects(fetchGithubPulls(registry.repository,{token:'TEST',request:async()=>({ok:true,json:async()=>({items:[]})})}),/page/);
 await assert.rejects(fetchGithubPulls(registry.repository,{token:''}),/token/);
});
test('refresh is read-only by default and atomically writes validated real observations when requested',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dge-pr-registry-'));
 const path=join(dir,'prs.json');
 try{
  await writeFile(path,JSON.stringify(registry));
  const request=async()=>({ok:true,json:async()=>[pr()]});
  const report=await refreshPrRegistry({path,token:'TEST',request,observedAt:observation});
  assert.equal(report.written,false);
  assert.equal(JSON.parse(await readFile(path,'utf8')).pullRequests.length,registry.pullRequests.length);
  const saved=await refreshPrRegistry({path,token:'TEST',request,observedAt:observation,write:true});
  assert.equal(saved.written,true);
  assert.equal(JSON.parse(await readFile(path,'utf8')).pullRequests[0].id,4950000030);
 }finally{await rm(dir,{recursive:true,force:true});}
});
