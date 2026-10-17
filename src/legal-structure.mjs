import {canonicalize,identifier,invariant} from './integrity-values.mjs';
import {legalLabel,FEDERAL_HIERARCHY} from './numbering.mjs';

export const LEGAL_SCHEMA_VERSION=2;
export const LEGAL_LIMITS=Object.freeze({nodes:10000,depth:16,bytes:3000000,text:1000000});
const SUPPORTED_SCHEMA_VERSIONS=new Set([1,2]);
const INLINE_MARKS=new Set(['bold','italic','underline','strike']);
const CHILDREN={
 section:new Set(['section','paragraph','list','table','definition','exhibit']),
 list:new Set(['list-item']),
 'list-item':new Set(['paragraph','list','table']),
 table:new Set(['table-row']),
 'table-row':new Set(['table-cell']),
 'table-cell':new Set(['paragraph','list']),
 exhibit:new Set(['section','paragraph','list','table','definition'])
};
const ROOT_KINDS=new Set(['section','paragraph','list','table','definition','exhibit','footnote']);
function safeRecord(obj) {
 invariant(obj&&typeof obj==='object'&&!Array.isArray(obj)&&(Object.getPrototypeOf(obj)===Object.prototype||Object.getPrototypeOf(obj)===null),'Expected a plain record');
 invariant(Object.getOwnPropertySymbols(obj).length===0,'Symbol keys are forbidden');
 for(const key of Object.getOwnPropertyNames(obj)) {
  const descriptor=Object.getOwnPropertyDescriptor(obj,key);
  invariant(descriptor.enumerable&&Object.hasOwn(descriptor,'value'),'Unknown or unsafe field: '+key);
 }
}
function fields(obj,allowed,required=[]) {
 safeRecord(obj);
 for(const key of Object.keys(obj))invariant(allowed.includes(key),'Unknown field: '+key);
 for(const key of required)invariant(Object.hasOwn(obj,key),'Missing field: '+key);
}
function text(value,max=LEGAL_LIMITS.text) {
 invariant(typeof value==='string'&&value.length<=max,'Invalid or oversized legal text');
 canonicalize(value);return value;
}
function denseArray(value,max) {
 invariant(Array.isArray(value)&&value.length<=max&&Object.keys(value).length===value.length&&Object.keys(value).every((key,i)=>key===String(i)),'Invalid bounded dense array');
 invariant(Object.getOwnPropertySymbols(value).length===0&&Object.keys(value).every(key=>Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value')),'Unsafe array entries');
}
function freeze(value) {if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
export function normalizeExternalUrl(value) {
 text(value,2048);let url;
 try{url=new URL(value);}catch{invariant(false,'Invalid external URL');}
 invariant(url.protocol==='https:'&&url.hostname&&url.username===''&&url.password==='','External URLs must use HTTPS without user information');
 return url.href;
}
function validateInlines(inlines,refs,schemaVersion) {
 denseArray(inlines,10000);
 for(const run of inlines) {
  safeRecord(run);
  const allowed=schemaVersion>=2?['text','reference','footnote-reference','link','citation']:['text','reference','footnote-reference'];
  invariant(run&&allowed.includes(run.kind),'Unknown inline kind');
  if(run.kind==='text') {
   fields(run,['kind','text','marks'],['kind','text']);text(run.text);
   if(run.marks!==undefined){denseArray(run.marks,4);invariant(run.marks.every(m=>INLINE_MARKS.has(m))&&new Set(run.marks).size===run.marks.length,'Invalid text marks');}
  } else if(['reference','footnote-reference'].includes(run.kind)) {
   fields(run,['kind','targetId','label'],['kind','targetId']);identifier(run.targetId);if(run.label!==undefined)text(run.label,1000);refs.push(run);
  } else {
   fields(run,['kind','targetUrl','label','title'],['kind','targetUrl','label']);
   invariant(normalizeExternalUrl(run.targetUrl)===run.targetUrl,'External URLs must use canonical HTTPS form');text(run.label,1000);invariant(run.label.length>0,'External inline label is required');if(run.title!==undefined)text(run.title,1000);
  }
 }
}

/** Validate structure independently from presentation and return frozen, detached data. */
export function validateLegalDocument(input,{forFinalization=false}={}) {
 fields(input,['schemaVersion','id','tenantId','mode','lifecycle','revision','metadata','content','provenance','schemaMigration'],['schemaVersion','id','tenantId','mode','lifecycle','revision','metadata','content']);
 invariant(SUPPORTED_SCHEMA_VERSIONS.has(input.schemaVersion),'Unsupported legal schema version');identifier(input.id);identifier(input.tenantId);
 invariant(['collaboration','public-input'].includes(input.mode),'Invalid legal document mode');
 invariant(['draft','published','adopted','signed'].includes(input.lifecycle),'Invalid document lifecycle');
 invariant(Number.isSafeInteger(input.revision)&&input.revision>=0,'Invalid legal revision');
 fields(input.metadata,['title','locale','numberingProfile'],['title','locale','numberingProfile']);text(input.metadata.title,1000);
 invariant(typeof input.metadata.locale==='string'&&/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(input.metadata.locale),'Invalid document locale');
 invariant(['us-federal-v1','decimal-v1'].includes(input.metadata.numberingProfile),'Unsupported numbering profile');
 if(input.provenance!==undefined){fields(input.provenance,['fromSchema','sourceDigest'],['fromSchema','sourceDigest']);invariant(input.provenance.fromSchema==='foundation-blocks-v0'&&/^[a-f0-9]{64}$/.test(input.provenance.sourceDigest),'Invalid migration provenance');}
 if(input.schemaMigration!==undefined){fields(input.schemaMigration,['fromVersion','toVersion','sourceDigest'],['fromVersion','toVersion','sourceDigest']);invariant(input.schemaVersion===2&&input.schemaMigration.fromVersion===1&&input.schemaMigration.toVersion===2&&/^[a-f0-9]{64}$/.test(input.schemaMigration.sourceDigest),'Invalid schema migration evidence');}
 const ids=new Map([[input.id,{kind:'document'}]]),refs=[];
 let count=0;
 function visit(node,depth,sectionDepth=0) {
  invariant(depth<=LEGAL_LIMITS.depth&&++count<=LEGAL_LIMITS.nodes,'Legal document structural limit exceeded');
  safeRecord(node);
  if(node.kind==='section'){sectionDepth++;invariant(sectionDepth<=(input.metadata.numberingProfile==='us-federal-v1'?FEDERAL_HIERARCHY.length:16),'Legal numbering depth limit exceeded');}
  invariant(node&&typeof node.kind==='string','Missing legal node kind');
  identifier(node.id);invariant(!ids.has(node.id),'Duplicate legal node ID');ids.set(node.id,node);
  if(['paragraph','footnote','definition'].includes(node.kind)) {
   const allowed=['kind','id','inlines'];if(node.kind==='definition')allowed.push('term');
   fields(node,allowed,['kind','id','inlines',...(node.kind==='definition'?['term']:[])]);
   if(node.kind==='definition')text(node.term,1000);validateInlines(node.inlines,refs,input.schemaVersion);
  } else {
   invariant(Object.hasOwn(CHILDREN,node.kind),'Unsupported legal node kind');
   const allowed=['kind','id','children'];if(node.kind==='section'||node.kind==='exhibit')allowed.push('title');if(node.kind==='list')allowed.push('style');
   fields(node,allowed,['kind','id','children',...(['section','exhibit'].includes(node.kind)?['title']:[]),...(node.kind==='list'?['style']:[])]);
   if(node.title!==undefined)text(node.title,1000);
   if(node.kind==='list')invariant(['decimal','lower-alpha','upper-alpha','lower-roman','upper-roman','bullet'].includes(node.style),'Unknown list style');
   denseArray(node.children,LEGAL_LIMITS.nodes);invariant(node.children.length>0,'Empty structural container');
   for(const child of node.children){safeRecord(child);invariant(CHILDREN[node.kind].has(child.kind),'Invalid child of '+node.kind);visit(child,depth+1,sectionDepth);}
   if(node.kind==='table'){const widths=node.children.map(row=>row.children.length);invariant(widths.every(n=>n===widths[0]),'Ragged legal table');}
  }
 }
 denseArray(input.content,LEGAL_LIMITS.nodes);invariant(input.content.length>0,'Empty legal document');
 for(const node of input.content){safeRecord(node);invariant(ROOT_KINDS.has(node.kind),'Invalid top-level legal node');visit(node,1);}
 for(const ref of refs){const target=ids.get(ref.targetId);if(forFinalization||input.lifecycle!=='draft')invariant(target,'Unresolved cross-reference');if(target&&ref.kind==='footnote-reference')invariant(target.kind==='footnote','Footnote reference points to a non-footnote');}
 invariant(new TextEncoder().encode(canonicalize(input)).byteLength<=LEGAL_LIMITS.bytes,'Legal document byte limit exceeded');
 return freeze(structuredClone(input));
}


export function documentIssues(document) {
 const doc=validateLegalDocument(document),ids=new Set([doc.id]),references=[];
 function visit(node){ids.add(node.id);for(const run of node.inlines??[])if(['reference','footnote-reference'].includes(run.kind))references.push({sourceId:node.id,...run});for(const child of node.children??[])visit(child);}
 doc.content.forEach(visit);
 return references.filter(r=>!ids.has(r.targetId)).map(r=>({code:'UNRESOLVED_REFERENCE',sourceId:r.sourceId,targetId:r.targetId}));
}
export function createLegalDocument({id,tenantId,title,locale='en-US',mode='collaboration'}) {
 return validateLegalDocument({schemaVersion:LEGAL_SCHEMA_VERSION,id,tenantId,mode,lifecycle:'draft',revision:0,metadata:{title,locale,numberingProfile:'us-federal-v1'},content:[{kind:'paragraph',id:id+':p1',inlines:[{kind:'text',text:''}]}]});
}

function requireDraft(document) {invariant(document.lifecycle==='draft'&&document.mode==='collaboration','Only a collaboration draft may be edited directly');}
export function moveLegalNode(document,nodeId,newParentId,index) {
 const doc=validateLegalDocument(document);requireDraft(doc);identifier(nodeId);identifier(newParentId);
 invariant(Number.isSafeInteger(index)&&index>=0,'Invalid move position');
 const next=structuredClone(doc),parents=new Map(),nodes=new Map([[next.id,next]]);
 function scan(children,parent){for(const node of children){nodes.set(node.id,node);parents.set(node.id,parent);scan(node.children??[],node);}}
 scan(next.content,next);const node=nodes.get(nodeId),target=nodes.get(newParentId);
 invariant(node&&node!==next&&target,'Unknown move source or destination');
 for(let p=target;p;p=parents.get(p.id))invariant(p!==node,'Cannot move a node into its descendant');
 const parent=parents.get(nodeId),oldChildren=parent===next?parent.content:parent.children;
 const children=target===next?target.content:target.children;
 invariant(Array.isArray(children),'Move destination cannot contain blocks');
 oldChildren.splice(oldChildren.indexOf(node),1);invariant(index<=children.length,'Move position exceeds destination');children.splice(index,0,node);next.revision++;
 return validateLegalDocument(next);
}
export function finalizeLegalDocument(document,lifecycle='adopted') {
 const doc=validateLegalDocument(document,{forFinalization:true});requireDraft(doc);invariant(['published','adopted'].includes(lifecycle),'Execution signing requires the signing protocol');
 return validateLegalDocument({...structuredClone(doc),revision:doc.revision+1,lifecycle},{forFinalization:true});
}
export function publicInputEdition(document) {
 const doc=validateLegalDocument(document,{forFinalization:true});invariant(doc.lifecycle!=='signed','Signed editions require an explicit publication/export protocol');
 return validateLegalDocument({...structuredClone(doc),mode:'public-input',lifecycle:'published',revision:doc.revision+1},{forFinalization:true});
}
export function legalOutline(document) {
 const doc=validateLegalDocument(document),result=[];
 const profile=doc.metadata.numberingProfile==='us-federal-v1'?FEDERAL_HIERARCHY:Array(16).fill('decimal');
 function walk(children,depth){let ordinal=0;for(const node of children){if(node.kind==='section'){ordinal++;invariant(depth<profile.length,'Numbering hierarchy exhausted');result.push({id:node.id,title:node.title,label:legalLabel(ordinal,depth,profile),depth});walk(node.children,depth+1);}else if(node.children)walk(node.children,depth);}}
 walk(doc.content,0);return result;
}
export function legalPlainText(document) {
 const doc=validateLegalDocument(document),labels=new Map(legalOutline(doc).map(x=>[x.id,x.label]));
 const inline=r=>r.kind==='text'?r.text:['link','citation'].includes(r.kind)?r.label+' <'+r.targetUrl+'>':r.label??labels.get(r.targetId)??'['+r.targetId+']';
 function render(node){if(node.inlines)return (node.term?node.term+'—':'')+node.inlines.map(inline).join('');return (node.title?(labels.get(node.id)??'EXHIBIT')+' '+node.title+'\n':'')+node.children.map(render).join(node.kind==='table-row'?'\t':'\n');}
 return doc.content.map(render).join('\n\n');
}
