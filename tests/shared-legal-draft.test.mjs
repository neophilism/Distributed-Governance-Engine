import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {createLegalDocument,publicInputEdition} from '../src/legal-structure.mjs';
import {createPublicSharedDraft} from '../editor/shared-legal-draft.mjs';

const draft=()=>{const d=structuredClone(createLegalDocument({id:'doc',tenantId:'workspace',title:'Shared sample'}));d.content[0].inlines=[{kind:'text',text:'Seed'}];return d;};
function firstText(ydoc){
 function walk(node){
  if(node instanceof Y.XmlText)return node;
  for(const child of node.toArray()) {const item=walk(child);if(item)return item;}
  return null;
 }
 const result=walk(ydoc.getXmlFragment('prosemirror'));
 if(!result)throw Error('Missing shared text');
 return result;
}
function textOf(session){return session.snapshot().content[0].inlines.map(x=>x.text??'').join('');}
test('authenticated public Yjs states converge across concurrent edits, retries and reconnect',()=>{
 const source=draft(),leftUpdates=[],rightUpdates=[];
 const left=createPublicSharedDraft({document:source,onLocalUpdate:u=>leftUpdates.push(u)});
 const right=createPublicSharedDraft({document:source,initialState:left.encodeState(),onLocalUpdate:u=>rightUpdates.push(u)});
 left.mutateLocal(doc=>firstText(doc).insert(0,'LEFT '));
 right.mutateLocal(doc=>firstText(doc).insert(0,'RIGHT '));
 assert.equal(leftUpdates.length,1);assert.equal(rightUpdates.length,1);
 left.receive(rightUpdates[0]);right.receive(leftUpdates[0]);
 assert.equal(textOf(left),textOf(right));
 assert.match(textOf(left),/LEFT/);assert.match(textOf(left),/RIGHT/);
 const once=textOf(left);left.receive(rightUpdates[0]);assert.equal(textOf(left),once);
 const latest=createPublicSharedDraft({document:source,initialState:left.encodeState()});
 assert.equal(textOf(latest),once);
 assert.equal(right.encodeState(left.stateVector()).byteLength<=2,true);
 left.close();right.close();latest.close();
});
test('read-only viewers receive deltas but cannot originate edits',()=>{
 const doc=draft(),writer=createPublicSharedDraft({document:doc});
 const viewer=createPublicSharedDraft({document:doc,initialState:writer.encodeState(),writable:false});
 assert.throws(()=>viewer.mutateLocal(d=>firstText(d).insert(0,'FORGED')),/read-only/);
 const update=writer.encodeState();
 writer.mutateLocal(d=>firstText(d).insert(0,'New '));
 viewer.receive(writer.encodeState(Y.encodeStateVectorFromUpdate(update)));
 assert.equal(textOf(writer),textOf(viewer));
});
test('invalid, oversized, untrusted or immutable collaboration inputs are refused without mutation',()=>{
 const doc=draft(),session=createPublicSharedDraft({document:doc});
 const before=textOf(session);
 assert.throws(()=>createPublicSharedDraft({document:publicInputEdition(doc)}),/public collaboration/);
 assert.throws(()=>session.receive(new Uint8Array(65537)),/oversized/);
 assert.throws(()=>session.receive(new Uint8Array([1,2,3])),/schema validation/);
 assert.throws(()=>session.mutateLocal(d=>firstText(d).insert(0,'A'.repeat(3000001))),/schema validation|legal text|exceeds/);
 assert.equal(textOf(session),before);
 session.close();assert.throws(()=>session.snapshot(),/closed/);
});
