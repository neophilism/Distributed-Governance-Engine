import assert from 'node:assert/strict';
import {digest,evaluateDecision,merkleBatch,verifyInclusion} from '../src/index.mjs';
let seed=0xdec1de;
const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
for(let iteration=0;iteration<2000;iteration++) {
 const size=rand()%30+1;
 const electorate={id:'e',kind:'frozen',members:Array.from({length:size},(_,i)=>({principalId:'p'+i,weight:String(BigInt(rand())*10000000000000n+1n)}))};
 const policy={id:'p',weighting:'shares',allowEarlyClose:false,opensAt:1,closesAt:10,minYes:'1',quorum:{kind:'count',minimum:'1'},approval:{basis:'decisive',comparison:'gt',numerator:'1',denominator:'2'}};
 const pd=digest('proposal',{iteration});
 const ballots=electorate.members.map(m=>({principalId:m.principalId,choice:['yes','no','abstain'][rand()%3],proposalDigest:pd,electorateId:'e',policyId:'p',policyDigest:digest('policy',policy),electorateDigest:digest('electorate',electorate),castAt:5}));
 const args={mode:'collaboration',policy,electorate,ballots,proposalDigest:pd,now:10};
 const expected=ballots.reduce((a,b,i)=>{a[b.choice]+=BigInt(electorate.members[i].weight);return a;},{yes:0n,no:0n,abstain:0n});
 const r=evaluateDecision(args);
 for(const k of ['yes','no','abstain'])assert.equal(r.weights[k],String(expected[k]));
 assert.equal(r.canAdopt,expected.yes>expected.no);
 assert.equal(evaluateDecision({...args,ballots:[...ballots].reverse()}).status,r.status);
 assert.equal(evaluateDecision({...args,mode:'public-input'}).canAdopt,false);
 if(iteration<100){const ds=ballots.map(b=>digest('ballot',b)),batch=merkleBatch(ds);ds.forEach((d,i)=>assert(verifyInclusion(d,batch.proofs[i],batch.root)));}
}
console.log('Passed 2,000 generated test cases with repeatable inputs (seed 0xdec1de); not a cryptographic audit.');
