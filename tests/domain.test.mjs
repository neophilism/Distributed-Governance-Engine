import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateDecision,resolveProposal,revisionDigest,proposalDigest,digest,canonicalize,integer,legalLabel,FEDERAL_HIERARCHY,merkleBatch,verifyInclusion} from '../src/index.mjs';
import {input,policy,electorate,document,proposal,ballot} from './fixtures.mjs';

test('a majority of a quorum applies precisely the voted language and preserves the source object',()=>{
 const x=input();const before=JSON.stringify(x);const r=resolveProposal(x);
 assert.equal(r.decision.status,'passed');assert.equal(r.document.blocks[0].text,'The agency shall report quarterly.');
 assert.equal(r.document.revision,1);assert.equal(r.document.previousDigest,revisionDigest(document));assert.equal(JSON.stringify(x),before);
});
test('public input never changes a document or reports an adoption threshold',()=>{
 const doc={...document,mode:'public-input'};const pr={...proposal,baseDigest:revisionDigest(doc)};
 const r=resolveProposal(input({document:doc,proposal:pr}));
 assert.equal(r.decision.status,'advisory');assert.equal(r.decision.canAdopt,false);assert.equal(r.decision.approvalMet,null);assert.deepEqual(r.document,doc);
});
test('a provisional threshold is not final before the published deadline',()=>{
 assert.equal(evaluateDecision(input({now:1999})).status,'open');
 assert.equal(evaluateDecision(input({now:2000})).status,'passed');
});
test('early closure requires an explicit policy choice',()=>{
 const p={...policy,allowEarlyClose:true};assert.equal(evaluateDecision(input({policy:p,now:1600})).status,'passed');
});
test('quorum and strict majority are independent',()=>{
 const bs=[ballot('alice','yes'),ballot('bob','no')];
 const r=evaluateDecision(input({ballots:bs}));assert.equal(r.quorumMet,false);assert.equal(r.approvalMet,false);assert.equal(r.status,'failed');
});
test('abstentions count for quorum and have an explicit approval denominator',()=>{
 const bs=[ballot('alice','yes'),ballot('bob','abstain'),ballot('chris','abstain')];
 assert.equal(evaluateDecision(input({ballots:bs})).status,'passed');
 const p={...policy,approval:{...policy.approval,basis:'participating'}};
 assert.equal(evaluateDecision(input({policy:p,ballots:['yes','abstain','abstain'].map((c,i)=>ballot(electorate.members[i].principalId,c,{policy:p}))})).status,'failed');
});
test('an empty turnout cannot pass',()=>{assert.equal(evaluateDecision(input({ballots:[]})).status,'failed');});
test('exact supermajority may include equality but strict majority rejects a tie',()=>{
 const p={...policy,approval:{basis:'eligible',comparison:'gte',numerator:'2',denominator:'3'}};
 assert.equal(evaluateDecision(input({policy:p})).status,'passed');
 const q={...p,approval:{...p.approval,comparison:'gt'}};assert.equal(evaluateDecision(input({policy:q})).status,'failed');
});
test('weights beyond Number precision retain their exact value',()=>{
 const p={...policy,weighting:'shares',quorum:{kind:'fraction-weight',numerator:'1',denominator:'1'}};
 const e={...electorate,members:[{principalId:'alice',weight:'9007199254740993'},{principalId:'bob',weight:'9007199254740992'}]};
 const r=evaluateDecision(input({policy:p,electorate:e,ballots:[ballot('alice','yes',{policy:p,electorate:e}),ballot('bob','no',{policy:p,electorate:e})]}));
 assert.equal(r.status,'passed');assert.equal(r.weights.eligible,'18014398509481985');
});
test('fractional headcount quorum is calculated without rounding',()=>{
 const p={...policy,quorum:{kind:'fraction-count',numerator:'2',denominator:'3'}};
 assert.equal(evaluateDecision(input({policy:p,ballots:[ballot('alice','yes',{policy:p}),ballot('bob','yes',{policy:p})]})).quorumMet,true);
});
test('duplicate or ineligible voters fail closed',()=>{
 assert.throws(()=>evaluateDecision(input({ballots:[ballot('alice','yes'),ballot('alice','yes')]})),/Duplicate/);
 assert.throws(()=>evaluateDecision(input({ballots:[ballot('outsider','yes')]})),/Ineligible/);
});
test('client supplied weight and changed ballot bindings fail closed',()=>{
 for(const change of [{weight:'999'},{policyId:'other'},{policyDigest:'0'.repeat(64)},{electorateDigest:'0'.repeat(64)},{proposalDigest:'0'.repeat(64)}]) assert.throws(()=>evaluateDecision(input({ballots:[{...ballot('alice','yes'),...change}]})));
});
test('changing a policy or electorate under the same ID invalidates old ballots',()=>{
 assert.throws(()=>evaluateDecision(input({policy:{...policy,minYes:'2'},ballots:[ballot('alice','yes')]})),/binding/);
 assert.throws(()=>evaluateDecision(input({electorate:{...electorate,members:electorate.members.slice(0,2)},ballots:[ballot('alice','yes')]})),/binding/);
});
test('out-of-window and future ballots are rejected',()=>{
 for(const castAt of [999,2000,3000]) assert.throws(()=>evaluateDecision(input({ballots:[{...ballot('alice','yes'),castAt}]})),/window/);
 assert.throws(()=>evaluateDecision(input({now:1400,ballots:[ballot('alice','yes')]})),/window/);
});
test('equal-person voting cannot hide weighted credentials',()=>{
 const e={...electorate,members:[{principalId:'alice',weight:'2'}]};assert.throws(()=>evaluateDecision(input({electorate:e,ballots:[]})),/Equal/);
});
test('unsupported open-electorate handling is explicit',()=>{assert.throws(()=>evaluateDecision(input({electorate:{...electorate,kind:'open'}})),/frozen/);});
test('stale content, repeated application and foreign tenants cannot adopt',()=>{
 const x=input(),first=resolveProposal(x).document;
 assert.throws(()=>resolveProposal({...x,document:first}),/Stale/);
 assert.throws(()=>resolveProposal({...x,document:{...document,tenantId:'other'}}),/another/);
 assert.throws(()=>resolveProposal({...x,document:{...document,id:'other'}}),/another/);
});
test('a changed proposal requires new ballots even if its ID is unchanged',()=>{
 assert.throws(()=>resolveProposal(input({proposal:{...proposal,replacement:'monthly'},ballots:input().ballots})),/binding/);
});
test('an ambiguous or forged selection cannot be applied',()=>{
 const pr={...proposal,quote:'wrong'};assert.throws(()=>resolveProposal(input({proposal:pr})),/quote/);
});
test('Unicode boundaries cannot cut an emoji in half',()=>{
 const doc={...document,blocks:[{id:'clause-1',text:'A😀B'}]};const pr={...proposal,baseDigest:revisionDigest(doc),start:1,end:2,quote:'\ud83d',replacement:''};
 assert.throws(()=>resolveProposal(input({document:doc,proposal:pr})),/Unicode/);
});
test('legal labels use the correct US hierarchy and explicit alternative profiles',()=>{
 assert.deepEqual(FEDERAL_HIERARCHY.map((_,depth)=>legalLabel(1,depth)),['SEC. 1.','(a)','(1)','(A)','(i)','(I)']);
 assert.equal(legalLabel(27,1),'(aa)');assert.equal(legalLabel(49,4),'(xlix)');assert.equal(legalLabel(1,0,['decimal']),'(1)');
 assert.throws(()=>legalLabel(0,0));assert.throws(()=>legalLabel(4000,4));assert.throws(()=>legalLabel(1,6));
});
test('canonical serialization is order independent and hashes have explicit domains',()=>{
 assert.equal(canonicalize({b:2,a:1}),'{"a":1,"b":2}');
 assert.equal(digest('document',{a:1,b:2}),digest('document',{b:2,a:1}));assert.notEqual(digest('document',{a:1}),digest('proposal',{a:1}));
 assert.notEqual(digest('document',{a:'é'}),digest('document',{a:'e\u0301'}));
});
test('unsupported canonical values, cycles, accessors and sparse arrays fail',()=>{
 const circular={};circular.self=circular;
 for(const x of [undefined,NaN,Infinity,1.5,-0,1n,new Date(),circular,[,],{a:undefined},'\ud800',Object.defineProperty({},'a',{get(){throw new Error('not read');},enumerable:true})]) assert.throws(()=>canonicalize(x));
});
test('integer strings reject lossy, signed and noncanonical representations',()=>{
 for(const x of [1,1.5,'01','-1','+1','1.0','1e3',' 1','', '1'.repeat(79)]) assert.throws(()=>integer(x));
 assert.equal(integer('9007199254740993'),9007199254740993n);
});
test('every Merkle inclusion proof verifies including odd and empty batches',()=>{
 for(const n of [0,1,2,3,9]) {const ds=Array.from({length:n},(_,i)=>digest('leaf',{i}));const batch=merkleBatch(ds);assert.equal(batch.count,n);ds.forEach((d,i)=>assert.equal(verifyInclusion(d,batch.proofs[i],batch.root),true));}
});
test('modified leaves, proof sides, missing proof steps and roots fail verification',()=>{
 const ds=[0,1,2].map(i=>digest('leaf',{i})),batch=merkleBatch(ds),p=batch.proofs[0];
 assert.equal(verifyInclusion(digest('leaf',{i:9}),p,batch.root),false);
 assert.equal(verifyInclusion(ds[0],{...p,path:p.path.slice(1)},batch.root),false);
 assert.equal(verifyInclusion(ds[0],{...p,path:p.path.map(x=>({...x,side:'left'}))},batch.root),false);
 assert.equal(verifyInclusion(ds[0],p,'f'.repeat(64)),false);
 assert.equal(verifyInclusion(ds[0],{...p,count:4},batch.root),false);
 assert.notEqual(batch.root,merkleBatch([...ds,ds[2]]).root);
});
test('decorated sparse arrays and accessor entries cannot change canonical interpretation',()=>{
 const a=Array(1);a.extra=1;assert.throws(()=>canonicalize(a));
 const b=[1];Object.defineProperty(b,'0',{get(){throw new Error('Getter must not execute');},enumerable:true});assert.throws(()=>canonicalize(b),/Accessor/);
 const c=[1];c[Symbol('s')]=1;assert.throws(()=>canonicalize(c),/Symbol/);
});
