import {digest,identifier,invariant,validDigest} from './integrity.mjs';
import {evaluateDecision} from './governance.mjs';

export function revisionDigest(document) {
  identifier(document.id); identifier(document.tenantId);
  invariant(['collaboration','public-input'].includes(document.mode),'Invalid mode');
  invariant(Number.isSafeInteger(document.revision)&&document.revision>=0,'Invalid revision');
  invariant(Array.isArray(document.blocks)&&document.blocks.length>0&&document.blocks.length<=10000,'Invalid blocks');
  const ids=new Set();
  for(const b of document.blocks) {
    identifier(b.id); invariant(!ids.has(b.id),'Duplicate block ID'); ids.add(b.id);
    invariant(typeof b.text==='string'&&b.text.length<=1000000,'Invalid block text');
  }
  return digest('document-revision',document);
}
export function proposalDigest(proposal) {
  identifier(proposal.id); identifier(proposal.documentId); identifier(proposal.tenantId); identifier(proposal.blockId);
  validDigest(proposal.baseDigest);
  invariant(Number.isSafeInteger(proposal.start)&&Number.isSafeInteger(proposal.end)&&proposal.start>=0&&proposal.end>=proposal.start,'Invalid replacement range');
  invariant(typeof proposal.quote==='string'&&typeof proposal.replacement==='string'&&proposal.replacement.length<=1000000,'Invalid replacement text');
  return digest('proposal',proposal);
}
/** Reference resolver, not an authenticated transaction service or signed decision certificate. */
export function resolveProposal({document,proposal,policy,electorate,ballots,now}) {
  const currentDigest=revisionDigest(document),pd=proposalDigest(proposal);
  invariant(proposal.documentId===document.id&&proposal.tenantId===document.tenantId,'Proposal belongs to another document or tenant');
  const decision=evaluateDecision({mode:document.mode,policy,electorate,ballots,proposalDigest:pd,now});
  if(!decision.canAdopt) return {document:structuredClone(document),decision};
  invariant(proposal.baseDigest===currentDigest,'Stale base revision: requires conflict review and a new vote');
  const index=document.blocks.findIndex(b=>b.id===proposal.blockId);
  invariant(index>=0,'Missing target block');
  const text=document.blocks[index].text;
  invariant(proposal.end<=text.length&&text.slice(proposal.start,proposal.end)===proposal.quote,'Anchor quote mismatch');
  // Development offsets use UTF-16 code units and must not split a surrogate pair.
  const boundary=i=>i===0||i===text.length||!(text.charCodeAt(i)>=0xDC00&&text.charCodeAt(i)<=0xDFFF&&text.charCodeAt(i-1)>=0xD800&&text.charCodeAt(i-1)<=0xDBFF);
  invariant(boundary(proposal.start)&&boundary(proposal.end),'Range splits a Unicode surrogate pair');
  const next=structuredClone(document);
  next.blocks[index].text=text.slice(0,proposal.start)+proposal.replacement+text.slice(proposal.end);
  next.revision+=1;
  next.previousDigest=currentDigest;
  next.lastDecisionDigest=digest('decision-reference',decision);
  revisionDigest(next);
  return {document:next,decision};
}
