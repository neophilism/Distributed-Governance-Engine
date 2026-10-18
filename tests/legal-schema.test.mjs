import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLegalDocument,createLegalDocument,legalDocumentDigest,documentIssues,legalReferenceAnalysis,previewLegalNodeMove,migrateLegacyRevision,migrateLegalDocumentV1,moveLegalNode,finalizeLegalDocument,publicInputEdition,legalOutline,legalPlainText,previewLegalNumbering,applyLegalNumberingRules,indentLegalSection,outdentLegalSection} from '../src/legal-schema.mjs';
const paragraph=(id,text)=>({kind:'paragraph',id,inlines:[{kind:'text',text}]});
const fixture=()=>({...structuredClone(createLegalDocument({id:'doc',tenantId:'org',title:'A reporting act'})),content:[{kind:'section',id:'s1',title:'Reporting',children:[paragraph('p1','The agency shall report annually.'),{kind:'section',id:'s1a',title:'Publication',children:[paragraph('p2','Reports shall be public.')]}]},{kind:'section',id:'s2',title:'Effective date',children:[{kind:'paragraph',id:'p3',inlines:[{kind:'text',text:'See '},{kind:'reference',targetId:'s1a'}]}]}]});
test('valid legal data is detached, deeply frozen and identified independently from numbering',()=>{const input=fixture(),doc=validateLegalDocument(input);assert(Object.isFrozen(doc.content[0].children));input.metadata.title='changed';assert.equal(doc.metadata.title,'A reporting act');});
test('unsupported schema, unsafe fields, duplicate IDs and illegal child types fail',()=>{
 for(const mutate of [d=>d.schemaVersion=3,d=>d.extra=true,d=>d.content[1].id='s1',d=>d.content[0].children[0].kind='table-row']){const d=fixture();mutate(d);assert.throws(()=>validateLegalDocument(d));}
 const d=fixture();Object.defineProperty(d,'revision',{get(){throw Error('Getter must not run');},enumerable:true});assert.throws(()=>validateLegalDocument(d),/unsafe/);
});
test('schema v2 stores canonical HTTPS links and citations while v1 remains closed',()=>{
 const d=fixture();d.content[0].children[0].inlines=[{kind:'link',targetUrl:'https://example.gov/report',label:'annual report'},{kind:'text',text:' '},{kind:'citation',targetUrl:'https://law.example/statute#s1',label:'12 U.S.C. 34',title:'Source'}];
 assert.match(legalPlainText(validateLegalDocument(d)),/annual report <https:\/\/example.gov\/report>/);
 assert.deepEqual(documentIssues(d),[]);
 const enriched=structuredClone(d);enriched.content[0].children[0].inlines[2].citationMetadata={publisher:'Office of the Law Revision Counsel',publishedOn:'2026-10-17',pinpoint:'§ 34(a)',accessedOn:'2026-10-18'};const validated=validateLegalDocument(enriched);assert.match(legalPlainText(validated),/Office of the Law Revision Counsel; 2026-10-17; § 34\(a\); 2026-10-18/);
 for(const metadata of [{}, {publishedOn:'2026-02-30'}, {pinpoint:''}, {publisher:'Agency',extra:'unsafe'}]){const x=structuredClone(enriched);x.content[0].children[0].inlines[2].citationMetadata=metadata;assert.throws(()=>validateLegalDocument(x),/citation|Citation|Unknown/);}
 const linkMetadata=structuredClone(enriched);linkMetadata.content[0].children[0].inlines[0].citationMetadata={publisher:'Forbidden'};assert.throws(()=>validateLegalDocument(linkMetadata),/Only citations/);
 for(const targetUrl of ['javascript:alert(1)','http://example.gov','https://user:secret@example.gov/']){const x=structuredClone(d);x.content[0].children[0].inlines[0].targetUrl=targetUrl;assert.throws(()=>validateLegalDocument(x),/URL|HTTPS/);}
 const old=fixture();old.schemaVersion=1;const upgraded=migrateLegalDocumentV1(old);assert.equal(upgraded.schemaVersion,2);assert.equal(upgraded.schemaMigration.sourceDigest,legalDocumentDigest(old));assert.deepEqual(upgraded.content,old.content);assert.throws(()=>migrateLegalDocumentV1(upgraded));
 const forbidden=structuredClone(old);forbidden.content[0].children[0].inlines=[{kind:'link',targetUrl:'https://example.gov/',label:'source'}];assert.throws(()=>validateLegalDocument(forbidden),/inline kind/);
});
test('markup is stored as text and unsupported marks cannot activate HTML',()=>{
 const d=fixture();d.content[0].children[0].inlines[0].text='<script>alert(1)</script>';assert.match(legalPlainText(d),/<script>/);
 d.content[0].children[0].inlines[0].marks=['javascript'];assert.throws(()=>validateLegalDocument(d),/marks/);
});
test('legal references follow IDs when sections move and labels change',()=>{
 const d=fixture(),next=moveLegalNode(d,'s1a','s2',1);
 assert.equal(legalOutline(next).find(x=>x.id==='s1a').label,'(a)');assert.equal(documentIssues(next).length,0);assert.equal(d.revision,0);assert.equal(next.revision,1);
 assert.equal(next.content[1].children[0].inlines[1].targetId,'s1a');
});
test('outline reflects the jurisdiction profile while preserving stable IDs',()=>{
 const d=fixture();assert.deepEqual(legalOutline(d).map(x=>[x.id,x.label]),[['s1','SEC. 1.'],['s1a','(a)'],['s2','SEC. 2.']]);
 d.metadata.numberingProfile='decimal-v1';assert.deepEqual(legalOutline(d).map(x=>x.label),['(1)','(1)','(2)']);
});
test('moves reject cycles, invalid destinations, ranges and illegal nesting',()=>{
 for(const [id,parent,index]of [['s1','s1a',0],['s1','p1',0],['s1','doc',8],['missing','doc',0],['s1','doc',-1]])assert.throws(()=>moveLegalNode(fixture(),id,parent,index));
});
test('a draft can display broken reference warnings but cannot finalize them',()=>{
 const d=fixture();d.content[1].children[0].inlines[1].targetId='missing';assert.equal(documentIssues(d)[0].code,'UNRESOLVED_REFERENCE');assert.throws(()=>finalizeLegalDocument(d),/Unresolved/);
 d.lifecycle='adopted';assert.throws(()=>validateLegalDocument(d),/Unresolved/);
});
test('footnote references require actual footnote targets',()=>{
 const d=fixture();d.content[1].children[0].inlines[1]={kind:'footnote-reference',targetId:'s1'};assert.throws(()=>validateLegalDocument(d),/non-footnote/);
 d.content.push({kind:'footnote',id:'fn',inlines:[{kind:'text',text:'A source'}]});d.content[1].children[0].inlines[1].targetId='fn';assert.equal(documentIssues(d).length,0);
});
test('published, adopted, signed and public-input editions cannot be directly edited',()=>{
 for(const lifecycle of ['published','adopted','signed'])assert.throws(()=>moveLegalNode({...fixture(),lifecycle},'s1','doc',0),/draft/);
 const feedback=publicInputEdition(fixture());assert.equal(feedback.mode,'public-input');assert.equal(feedback.lifecycle,'published');assert.throws(()=>moveLegalNode(feedback,'s1','doc',0));
 assert.throws(()=>finalizeLegalDocument(fixture(),'signed'),/signing protocol/);
});
test('finalization produces a new frozen edition without changing its source',()=>{
 const d=fixture(),f=finalizeLegalDocument(d);assert.equal(f.lifecycle,'adopted');assert.equal(f.revision,1);assert.equal(d.lifecycle,'draft');assert(Object.isFrozen(f));
});
test('legacy migration preserves block IDs, text, revision and source provenance',()=>{
 const old={id:'old',tenantId:'org',mode:'collaboration',revision:7,blocks:[{id:'clause-1',text:'Exact é wording'}]};
 const a=migrateLegacyRevision(old,{title:'Imported'}),b=migrateLegacyRevision(old,{title:'Imported'});assert.equal(a.content[0].id,'clause-1');assert.equal(a.content[0].inlines[0].text,old.blocks[0].text);assert.equal(a.revision,7);assert.equal(legalDocumentDigest(a),legalDocumentDigest(b));assert.equal(a.provenance.sourceDigest.length,64);
 assert.throws(()=>migrateLegacyRevision({...old,lifecycle:'signed'},{title:'Imported'}));
});
test('hashes bind title, text, mode and version without normalizing Unicode',()=>{
 const d=fixture(),hash=legalDocumentDigest(d);for(const mutate of [x=>x.metadata.title='Other',x=>x.content[0].children[0].inlines[0].text='Other',x=>x.mode='public-input']){const x=structuredClone(d);mutate(x);assert.notEqual(legalDocumentDigest(x),hash);}
});
test('bounded parser rejects sparse arrays and excessive nesting',()=>{
 const d=fixture();d.content=Array(1);assert.throws(()=>validateLegalDocument(d));
 const x=fixture();let node=x.content[0];for(let i=0;i<20;i++){const child={kind:'section',id:'deep'+i,title:'Nested',children:[paragraph('deep-p'+i,'Text')]};node.children=[child];node=child;}assert.throws(()=>validateLegalDocument(x),/limit/);
});
test('tables validate rectangular shape and cell content',()=>{
 const d=fixture();const cell=id=>({kind:'table-cell',id,children:[paragraph(id+'p','Cell')]});d.content.push({kind:'table',id:'table',children:[{kind:'table-row',id:'row1',children:[cell('a'),cell('b')]},{kind:'table-row',id:'row2',children:[cell('c'),cell('d')]}]});validateLegalDocument(d);d.content.at(-1).children[1].children.pop();assert.throws(()=>validateLegalDocument(d),/Ragged/);
});
test('unsafe child accessors are rejected without executing them',()=>{
 const d=fixture();let executed=false;Object.defineProperty(d.content[0].children[0],'kind',{get(){executed=true;return 'paragraph';},enumerable:true});assert.throws(()=>validateLegalDocument(d),/unsafe/);assert.equal(executed,false);
});
test('numbering limits reject a hierarchy that its configured renderer cannot label',()=>{
 const d=fixture();let node=d.content[0];for(let i=0;i<6;i++){const child={kind:'section',id:'n'+i,title:'Nested',children:[paragraph('np'+i,'Text')]};node.children=[child];node=child;}assert.throws(()=>validateLegalDocument(d),/numbering depth/);
});

test('jurisdiction profiles and reserved start positions preview without changing document',()=>{
 const d=fixture();
 const rules=[{parentId:'doc',startAt:27,reserved:[28]},{parentId:'s1',startAt:2,reserved:[3]}];
 const preview=previewLegalNumbering(d,rules);
 assert.deepEqual(preview.after.map(x=>x.label),['SEC. 27.','(b)','SEC. 29.']);
 assert.equal(preview.changed.length,3);
 assert.deepEqual(preview.affectedReferences,[{sourceId:'p3',targetId:'s1a',from:'(a)',to:'(b)'}]);
 assert.equal(d.metadata.numberingRules,undefined);
 const updated=applyLegalNumberingRules(d,rules);
 assert.equal(updated.revision,d.revision+1);
 assert.equal(updated.content[0].id,d.content[0].id);
 assert.deepEqual(legalOutline(updated),preview.after);
 const corporate=structuredClone(d);corporate.metadata.numberingProfile='corporate-v1';
 assert.deepEqual(legalOutline(corporate).map(x=>x.label),['(I)','(A)','(II)']);
});
test('malformed numbering rules reject rather than silently changing ordinals',()=>{
 const d=fixture();
 for(const rules of [
  [{parentId:'missing'}],
  [{parentId:'p1'}],
  [{parentId:'doc',startAt:0}],
  [{parentId:'doc',reserved:[3,2]}],
  [{parentId:'doc',reserved:[2,2]}],
  [{parentId:'doc',startAt:1000001}],
  [{parentId:'doc'},{parentId:'doc'}]
 ])assert.throws(()=>previewLegalNumbering(d,rules));
 const locked=publicInputEdition(d);
 assert.throws(()=>applyLegalNumberingRules(locked,[{parentId:'doc'}]),/draft/);
 const limited=structuredClone(d);limited.metadata.numberingProfile='corporate-v1';
 assert.throws(()=>previewLegalNumbering(limited,[{parentId:'doc',startAt:4000}]),/Roman/);
});
test('section indent and outdent preserve IDs and reject unsuitable moves',()=>{
 const d=fixture();
 assert.throws(()=>indentLegalSection(d,'s1'));
 const nested=indentLegalSection(d,'s2');
 assert.equal(nested.content[0].children.at(-1).id,'s2');
 assert.deepEqual(legalOutline(nested).map(x=>x.label),['SEC. 1.','(a)','(b)']);
 const flat=outdentLegalSection(nested,'s2');
 assert.equal(flat.content[1].id,'s2');
 assert.equal(flat.content[1].children[0].inlines[1].targetId,'s1a');
 assert.throws(()=>outdentLegalSection(d,'s1'));
 assert.throws(()=>indentLegalSection(publicInputEdition(d),'s2'));
});

test('defined terms report duplicate, empty and cyclic definitions before finalization',()=>{
 const d=fixture();
 d.content.push(
  {kind:'definition',id:'def-a',term:'Agency',inlines:[{kind:'text',text:'See '},{kind:'reference',targetId:'def-b'}]},
  {kind:'definition',id:'def-b',term:'agency',inlines:[{kind:'reference',targetId:'def-a'}]},
  {kind:'definition',id:'def-c',term:'Unrelated',inlines:[{kind:'reference',targetId:'def-b'}]},
  {kind:'definition',id:'def-d',term:' ',inlines:[{kind:'text',text:'TBD'}]}
 );
 const analysis=legalReferenceAnalysis(d);
 assert.equal(analysis.definitionCount,4);
 assert.deepEqual(analysis.issues.filter(i=>i.code==='CYCLIC_DEFINITION').map(i=>i.sourceId),['def-a','def-b']);
 assert.deepEqual(analysis.issues.filter(i=>i.code==='AMBIGUOUS_DEFINED_TERM').map(i=>i.sourceId),['def-b']);
 assert.deepEqual(analysis.issues.filter(i=>i.code==='EMPTY_DEFINED_TERM').map(i=>i.sourceId),['def-d']);
 assert.equal(analysis.backlinks.get('def-b').length,2);
 assert.throws(()=>finalizeLegalDocument(d),/definitions/);
 assert.throws(()=>publicInputEdition(d),/reference issues/);
});
test('moving a section previews renamed targets and all affected semantic references',()=>{
 const d=fixture(),before=JSON.stringify(d);
 const result=previewLegalNodeMove(d,'s1a','doc',2);
 assert.deepEqual(result.renamed,[{id:'s1a',from:'(a)',to:'SEC. 3.'}]);
 assert.deepEqual(result.affectedReferences,[{sourceId:'p3',targetId:'s1a',from:'(a)',to:'SEC. 3.'}]);
 assert.deepEqual(result.issues,[]);
 assert.equal(JSON.stringify(d),before);
 assert.throws(()=>previewLegalNodeMove(d,'s1','s1a',0),/descendant/);
});
test('unresolved reference diagnostics preserve stable target IDs through relocation',()=>{
 const d=fixture();d.content[1].children[0].inlines[1].targetId='deleted-section';
 const analysis=legalReferenceAnalysis(d);
 assert.deepEqual(analysis.issues,[{code:'UNRESOLVED_REFERENCE',sourceId:'p3',targetId:'deleted-section'}]);
 assert.throws(()=>finalizeLegalDocument(d),/Unresolved/);
});
