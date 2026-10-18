/**
 * Reconcile registry snapshots against actual GitHub REST pull request records.
 * No PR ID or merge status is synthesized from titles, commits or branch names.
 * Work-unit completion is intentionally NOT inferred from snapshot state.
 */
import {readFile,writeFile,rename} from 'node:fs/promises';
import {parsePrRegistry} from '../registry/pr-contract.mjs';
import {pathToFileURL} from 'node:url';
const SHA=/^[a-f0-9]{40}$/i,ID=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const stamp=()=>new Date().toISOString().replace(/\.\d{3}Z$/,'Z');

export function reconcilePrSnapshots(document,pulls,observedAt) {
 if(!Array.isArray(pulls)||pulls.length>2500||
    typeof observedAt!=='string')throw Error('Invalid GitHub observation');
 const records=[],seen=new Set();
 for(const pr of pulls) {
  if(!pr||!Number.isSafeInteger(pr.id)||pr.id<1||
     !Number.isSafeInteger(pr.number)||pr.number<1||seen.has(pr.number)||
     !['open','closed'].includes(pr.state)||typeof pr.draft!=='boolean'||
     typeof pr.title!=='string'||!pr.title.trim()||
     pr.html_url!=='https://github.com/'+document.repository+'/pull/'+pr.number||
     !SHA.test(pr.head?.sha??'')||!['main','development'].includes(pr.base?.ref)||
     (pr.merged_at!==null&&pr.state!=='closed'))
   throw Error('Invalid, foreign or duplicate GitHub PR');
  seen.add(pr.number);
  records.push({
   id:pr.id,number:pr.number,title:pr.title,state:pr.state,
   url:pr.html_url,createdAt:pr.created_at,updatedAt:pr.updated_at,
   mergedAt:pr.merged_at,closedAt:pr.closed_at,draft:pr.draft,
   headSha:pr.head.sha,baseRef:pr.base.ref,mergeCommitSha:pr.merge_commit_sha
  });
 }
 records.sort((a,b)=>a.number-b.number);
 const updated={...document,observedAt,pullRequests:records};
 parsePrRegistry(JSON.stringify(updated),document.repository);
 // Never allow a partial snapshot to look like an authoritative complete list.
 return updated;
}

export async function fetchGithubPulls(repository,{token,request=fetch}={}) {
 if(!ID.test(repository)||!token||typeof request!=='function')throw Error('GitHub token and repository required');
 const all=[];
 for(let page=1;page<=26;page++){
  const url='https://api.github.com/repos/'+repository+'/pulls?state=all&per_page=100&page='+page;
  const response=await request(url,{redirect:'error',headers:{
   authorization:'Bearer '+token,accept:'application/vnd.github+json',
   'x-github-api-version':'2022-11-28'
  }});
  if(!response.ok)throw Error('GitHub PR listing failed: HTTP '+response.status);
  const batch=await response.json();
  if(!Array.isArray(batch)||batch.length>100)throw Error('Invalid GitHub PR page');
  if(page===26&&batch.length)throw Error('GitHub PR listing pagination exceeded limit');
  all.push(...batch);
  if(batch.length<100)return all;
 }
 throw Error('GitHub PR listing incomplete');
}

export async function refreshPrRegistry({path=new URL('../registry/prs.json',import.meta.url),token,request=fetch,write=false,observedAt=stamp()}={}) {
 const original=JSON.parse(await readFile(path,'utf8'));
 const pulls=await fetchGithubPulls(original.repository,{token,request});
 const updated=reconcilePrSnapshots(original,pulls,observedAt);
 if(write) {
  const target=path instanceof URL?path.pathname:path;
  const temporary=target+'.reconcile-'+process.pid+'.tmp';
  await writeFile(temporary,JSON.stringify(updated,null,2)+'\n',{flag:'wx',mode:0o600});
  await rename(temporary,target);
 }
 return Object.freeze({
  repository:updated.repository,observedAt:updated.observedAt,
  observed:updated.pullRequests.length,
  previouslyRecorded:original.pullRequests.length,
  written:write,
  // Neither count measures finished roadmap work units.
  mappedUnits:updated.units.filter(u=>u.prs.length>0).length
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const write=process.argv.slice(2).includes('--write');
  if(process.argv.slice(2).some(arg=>arg!=='--write'))throw Error('Only --write is supported');
  const result=await refreshPrRegistry({token:process.env.GITHUB_TOKEN??process.env.GH_TOKEN,write});
  console.log(JSON.stringify(result));
 }catch(e){console.error('PR registry reconciliation stopped: '+e.message);process.exitCode=1;}
}
