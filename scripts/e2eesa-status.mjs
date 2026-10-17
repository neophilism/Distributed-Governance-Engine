import {createHash} from 'node:crypto';
export const E2EESA_STATUS_PATH='security/e2eesa-status.json';
export const SOURCE_DIGEST_ALGORITHM='git-blob-manifest-sha256-v1';
export const REQUIRED_GATES=['unit','adversarial','fuzz','secret-scan','dependency-scan','static-analysis'];
export const REQUIRED_CONTROLS=['SD-REQUIREMENTS','SD-OWNERS','SD-TOOLS','SD-RELEASE-GATES','SD-ENVIRONMENT','SD-SOURCE-ACCESS','SD-RELEASE-AUTH','SD-ARCHIVE','SD-DESIGN','SD-DESIGN-REVIEW','SD-DEPENDENCIES','SD-SECURE-CODE','SD-BUILD-CONFIG','SD-CODE-REVIEW','SD-TESTING','SD-DEFAULTS','SD-INTAKE','SD-REMEDIATION','SD-ROOT-CAUSE'];
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const path=x=>typeof x==='string'&&x.length>0&&!x.startsWith('/')&&!/[\\:\0]/.test(x)&&x.split('/').every(p=>p&&p!=='.'&&p!=='..');
export function sourceFingerprint(tree){
 if(!tree||tree.truncated||!Array.isArray(tree.tree))throw new Error('Complete source tree unavailable');
 const rows=tree.tree.filter(x=>['blob','commit'].includes(x.type)&&x.path!==E2EESA_STATUS_PATH&&!x.path.startsWith('security/e2eesa-evidence/'));
 for(const r of rows)if(!path(r.path)||!/^[a-f0-9]{40,64}$/.test(r.sha)||!/^\d{6}$/.test(r.mode))throw new Error('Invalid source tree entry');
 rows.sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));
 return createHash('sha256').update(rows.map(r=>r.mode+' '+r.type+' '+r.sha+'\t'+r.path+'\n').join('')).digest('hex');
}
export function parseSecurityStatus(body,repository){
 if(typeof body!=='string'||Buffer.byteLength(body)>65536)throw new Error('Security status exceeds size limit');
 let s;try{s=JSON.parse(body);}catch{throw new Error('Invalid security status JSON');}
 if(!s||s.schemaVersion!==1||s.repository!==repository||!Number.isFinite(Date.parse(s.updatedAt))||
 s.standard?.repository!=='neophilism/End-To-End-Everywhere-Security-Architecture-Standard'||
 !/^[a-f0-9]{40}$/.test(s.standard.commit)||!['development','candidate','production'].includes(s.standard.basis)||
 !path(s.inventory?.path)||typeof s.inventory.reviewed!=='boolean'||s.source?.algorithm!==SOURCE_DIGEST_ALGORITHM||
 !(s.source.digest===null||digest(s.source.digest)))throw new Error('Invalid security status identity, scope or source binding');
 for(const key of ['implementation','testing','independentReview']){
 const stage=s[key];if(typeof stage?.complete!=='boolean'||!Array.isArray(stage.evidence)||!stage.evidence.every(path)||
 !Array.isArray(stage.pending)||!stage.pending.every(p=>typeof p==='string'))throw new Error('Invalid security stage');
 }
 if(!Array.isArray(s.implementation.controls)||!Array.isArray(s.testing.checks)||!Array.isArray(s.independentReview.reviewers)||
 typeof s.independentReview.ownerAccepted!=='boolean')throw new Error('Invalid evidence collections');
 if(s.testing.complete&&!s.implementation.complete||s.independentReview.complete&&!s.testing.complete)throw new Error('Security stages completed out of order');
 return s;
}
export function evaluateSecurityStatus(s,{fingerprint=null,paths=[],now=Date.now(),state='valid'}={}){
 const blank={implemented:false,tested:false,independentReview:false,certificationEligible:false,reasons:[]};
 const fail=reason=>({...blank,reasons:[reason]});
 if(state!=='valid'||!s)return fail(state==='excluded'?'Excluded by repository age':'Security status '+state);
 if(!s.implementation.complete)return fail(s.implementation.pending[0]||'Implementation evidence pending');
 if(!digest(s.source.digest)||s.source.digest!==fingerprint)return fail('Source changed or source binding unavailable');
 const existing=new Set(paths),evidence=list=>Array.isArray(list)&&list.length>0&&list.every(p=>path(p)&&existing.has(p));
 if(!s.inventory.reviewed||!existing.has(s.inventory.path)||!evidence(s.implementation.evidence))return fail('Reviewed component inventory or implementation evidence missing');
 const controls=s.implementation.controls;
 if(controls.length!==REQUIRED_CONTROLS.length||new Set(controls.map(c=>c?.id)).size!==controls.length||
 !REQUIRED_CONTROLS.every(id=>controls.some(c=>c?.id===id&&c.state==='implemented'&&evidence(c.evidence))))return fail('Secure development control implementation evidence incomplete');
 const result={...blank,implemented:true};
 if(!s.testing.complete)return {...result,reasons:[s.testing.pending[0]||'Complete test evidence pending']};
 const fresh=at=>Number.isFinite(Date.parse(at))&&Date.parse(at)<=now&&now-Date.parse(at)<=7*86400000;
 const checks=s.testing.checks;
 if(checks.length!==REQUIRED_GATES.length||new Set(checks.map(c=>c?.kind)).size!==checks.length||
 !REQUIRED_GATES.every(kind=>checks.some(c=>c?.kind===kind&&c.status==='passed'&&c.sourceDigest===fingerprint&&fresh(c.completedAt)&&
 digest(c.toolDigest)&&digest(c.configurationDigest)&&evidence([c.report])))||!evidence(s.testing.evidence))
 return {...result,reasons:['Required tests are missing, failed, stale or bound to different source']};
 result.tested=true;
 const review=s.independentReview;
 if(review.complete&&review.ownerAccepted&&review.sourceDigest===fingerprint&&review.reviewers.length>0&&
 review.reviewers.every(r=>r&&typeof r.name==='string'&&r.name.trim()&&r.independent===true&&r.qualified===true)&&evidence(review.evidence))result.independentReview=true;
 return {...result,reasons:result.independentReview?[]:[review.pending[0]||'Independent expert review pending']};
}
export function securityScopeIncluded(repo){
 if(repo.full_name==='neophilism/FOIA_Bias_Analysis')return true;
 const at=repo.created_at||repo.github_created_at;
 if(!at||!Number.isFinite(new Date(at).getTime()))return null;
 return new Date(at).getUTCFullYear()>=2026;
}
export async function syncSecurityStatus(db,repo,get,head){
 const url='https://github.com/'+repo.full_name+'/blob/'+encodeURIComponent(head?.sha||repo.default_branch)+'/'+E2EESA_STATUS_PATH;
 const save=async(state,s=null,fingerprint=null,error=null)=>{
 await db.query("INSERT INTO repository_security_status(repository_id,state,status_json,source_commit,source_fingerprint,source_url,last_success_at,last_error) VALUES($1,$2,$3::jsonb,$4,$5,$6,CASE WHEN $2='valid' THEN now() END,$7) ON CONFLICT(repository_id) DO UPDATE SET state=excluded.state,status_json=CASE WHEN excluded.state='valid' THEN excluded.status_json ELSE repository_security_status.status_json END,source_commit=excluded.source_commit,source_fingerprint=excluded.source_fingerprint,source_url=excluded.source_url,last_attempt_at=now(),last_success_at=coalesce(excluded.last_success_at,repository_security_status.last_success_at),last_error=excluded.last_error",
 [repo.id,state,s?JSON.stringify(s):null,head?.sha||null,fingerprint,url,error]);return state;
 };
 const included=securityScopeIncluded(repo);
 if(included===false)return save('excluded');
 if(included===null)return save('unavailable',null,null,'Repository age/scope metadata unavailable');
 if(!head?.sha)return save('unavailable',null,null,'Default branch source unavailable');
 let file;try{file=await get('/repos/'+repo.full_name+'/contents/'+E2EESA_STATUS_PATH+'?ref='+head.sha);}
 catch(error){return save(error?.status===404?'missing':'unavailable',null,null,error?.status===404?'Status file missing':'GitHub status read unavailable');}
 let s;try{
 if(file.encoding!=='base64'||typeof file.content!=='string')throw new Error('Unexpected status encoding');
 s=parseSecurityStatus(Buffer.from(file.content.replace(/\s/g,''),'base64').toString('utf8'),repo.full_name);
 }catch(error){return save('invalid',null,null,error instanceof Error?error.message.slice(0,160):'Invalid security evidence');}
 let fingerprint=null;
 if(s.implementation.complete){try{
 const tree=await get('/repos/'+repo.full_name+'/git/trees/'+head.commit.tree.sha+'?recursive=1');
 fingerprint=sourceFingerprint(tree);s.observedSourcePaths=tree.tree.filter(r=>r.type==='blob'&&['100644','100755'].includes(r.mode)).map(r=>r.path);
 }catch{return save('unavailable',null,null,'Source tree verification unavailable');}}
 return save('valid',s,fingerprint);
}

