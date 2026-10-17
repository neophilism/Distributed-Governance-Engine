import {digest,proposalDigest,revisionDigest} from '../src/index.mjs';
export const document={id:'doc-1',tenantId:'org-1',mode:'collaboration',revision:0,blocks:[{id:'clause-1',text:'The agency shall report annually.'}]};
export const proposal={id:'proposal-1',documentId:document.id,tenantId:document.tenantId,baseDigest:revisionDigest(document),blockId:'clause-1',start:24,end:32,quote:'annually',replacement:'quarterly'};
export const policy={id:'policy-1',weighting:'equal',allowEarlyClose:false,opensAt:1000,closesAt:2000,minYes:'1',quorum:{kind:'count',minimum:'3'},approval:{basis:'decisive',comparison:'gt',numerator:'1',denominator:'2'}};
export const electorate={id:'electorate-1',kind:'frozen',members:['alice','bob','chris'].map(principalId=>({principalId,weight:'1'}))};
export function ballot(principalId,choice,overrides={}) {
 const p=overrides.policy??policy,e=overrides.electorate??electorate,pr=overrides.proposal??proposal;
 return {principalId,choice,proposalDigest:proposalDigest(pr),policyId:p.id,electorateId:e.id,policyDigest:digest('policy',p),electorateDigest:digest('electorate',e),castAt:1500};
}
export function input(overrides={}) {
 const p=overrides.policy??policy,e=overrides.electorate??electorate,pr=overrides.proposal??proposal;
 return {mode:'collaboration',document,proposal:pr,policy:p,electorate:e,proposalDigest:proposalDigest(pr),now:2000,ballots:[ballot('alice','yes',{policy:p,electorate:e,proposal:pr}),ballot('bob','yes',{policy:p,electorate:e,proposal:pr}),ballot('chris','no',{policy:p,electorate:e,proposal:pr})],...overrides};
}
