import test from 'node:test';
import assert from 'node:assert/strict';
import {TextSelection} from 'prosemirror-state';
import {createLegalDocument,publicInputEdition} from '../src/legal-structure.mjs';
import {createLegalEditorState,applyLegalTransaction,editorToLegal,commands} from '../editor/model.mjs';
import {findTextMatches,findNextText,replaceFoundText} from '../editor/search.mjs';

const document=(inlines=[{kind:'text',text:'The agency shall report annually. Report annually.'}])=>({...structuredClone(createLegalDocument({id:'search',tenantId:'public-demo',title:'Test'})),content:[{kind:'paragraph',id:'p1',inlines}]});
test('literal search spans formatting runs and preserves original text positions',()=>{
  const doc=document([{kind:'text',text:'Annual',marks:['bold']},{kind:'text',text:' report. annual report.'}]),state=createLegalEditorState(doc);
  const result=findTextMatches(state,'annual report');assert.equal(result.matches.length,2);
  assert.deepEqual(result.matches.map(m=>state.doc.textBetween(m.from,m.to)),['Annual report','annual report']);assert.equal(findTextMatches(state,'annual report',{caseSensitive:true}).matches.length,1);
});
test('search treats regex punctuation as literal and never searches across references or blocks',()=>{
  const doc=document([{kind:'text',text:'Find .*[x] a'},{kind:'reference',targetId:'p1',label:'b'},{kind:'text',text:'c'}]);doc.content.push({kind:'paragraph',id:'p2',inlines:[{kind:'text',text:'d'}]});const state=createLegalEditorState(doc);
  assert.equal(findTextMatches(state,'.*[x]').matches.length,1);for(const query of ['abc','ac','cd'])assert.equal(findTextMatches(state,query).matches.length,0);
});
test('Unicode matching uses editor offsets without splitting surrogate pairs',()=>{
  const state=createLegalEditorState(document([{kind:'text',text:'😀 Äpfel 😀 äpfel'}]));const result=findTextMatches(state,'äpfel');assert.equal(result.matches.length,2);
  assert.deepEqual(result.matches.map(m=>state.doc.textBetween(m.from,m.to)),['Äpfel','äpfel']);assert.equal(findTextMatches(state,'😀').matches.length,2);
});
test('find-next wraps and selection-only transactions do not change revision',()=>{
  const doc=document();let state=createLegalEditorState(doc),current=doc;
  const dispatch=tr=>{const next=applyLegalTransaction(state,tr,current);state=next.state;current=next.document;};
  findNextText('annually')(state,dispatch);const first=state.selection.from;findNextText('annually')(state,dispatch);assert.ok(state.selection.from>first);findNextText('annually')(state,dispatch);assert.equal(state.selection.from,first);assert.equal(current.revision,0);
});
test('replace selected rejects stale/unmatched selections rather than editing a different match',()=>{
  let state=createLegalEditorState(document());assert.equal(replaceFoundText('annually','monthly')(state),false);
  findNextText('annually')(state,tr=>{state=state.apply(tr);});
  state=state.apply(state.tr.insertText('changed',state.selection.from,state.selection.to));assert.equal(replaceFoundText('annually','monthly')(state),false);
});
test('replace-all is one document revision and one undo operation, with stable IDs and literal replacement',()=>{
  const original=document();let current=original,state=createLegalEditorState(current);
  const dispatch=tr=>{const result=applyLegalTransaction(state,tr,current);state=result.state;current=result.document;};
  assert.equal(replaceFoundText('annually','$& <monthly>',{all:true})(state,dispatch),true);
  assert.equal(current.revision,1);assert.equal(current.content[0].id,'p1');assert.equal(state.doc.textContent,'The agency shall report $& <monthly>. Report $& <monthly>.');
  commands.undo(state,dispatch);assert.deepEqual(current.content,original.content);commands.redo(state,dispatch);assert.match(state.doc.textContent,/<monthly>/);
});
test('an empty replacement deletes text and leaves the paragraph identity intact',()=>{
  const doc=document([{kind:'text',text:'Delete me'}]);let state=createLegalEditorState(doc);replaceFoundText('Delete me','',{all:true})(state,tr=>{state=state.apply(tr);});
  const next=editorToLegal(state.doc,doc);assert.equal(next.content[0].id,'p1');assert.deepEqual(next.content[0].inlines,[]);
});
test('search remains available in public-input while direct replacements are rejected',()=>{
  const locked=publicInputEdition(document());let state=createLegalEditorState(locked);findNextText('annually')(state,tr=>{state=state.apply(tr);});assert.equal(state.selection.empty,false);
  replaceFoundText('annually','FORGED',{all:true})(state,tr=>{const result=applyLegalTransaction(state,tr,locked);assert.equal(result.changed,false);assert.deepEqual(result.document,locked);});
});
test('search and replace are bounded and refuse a truncated replace-all',()=>{
  const doc=document([{kind:'text',text:'a '.repeat(1001)}]),state=createLegalEditorState(doc);
  const result=findTextMatches(state,'a');assert.equal(result.matches.length,1000);assert.equal(result.truncated,true);assert.equal(replaceFoundText('a','b',{all:true})(state),false);
  assert.throws(()=>findTextMatches(state,'x'.repeat(257)));assert.throws(()=>findTextMatches(state,'\ud800'));assert.equal(replaceFoundText('a','\ud800')(state),false);
  const hundred=createLegalEditorState(document([{kind:'text',text:'a '.repeat(101)}]));assert.equal(replaceFoundText('a','z'.repeat(10000),{all:true})(hundred),false);
});
