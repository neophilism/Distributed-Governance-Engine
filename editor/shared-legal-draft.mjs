import * as Y from 'yjs';
import {prosemirrorToYDoc,yDocToProsemirror} from 'y-prosemirror';
import {legalToEditor,editorToLegal,editorSchema} from './model.mjs';
import {validateLegalDocument} from '../src/legal-structure.mjs';

/**
 * In-memory Yjs convergence for an explicitly public, authorized collaboration draft.
 * The caller must separately authenticate writers and persist/transport updates.
 * Private content is rejected until reviewed end-to-end encrypted transport exists.
 */
export function createPublicSharedDraft({document,initialState=null,writable=true,
 onLocalUpdate=()=>{},maxUpdateBytes=65536}={}) {
 const base=validateLegalDocument(document);
 if(base.mode!=='collaboration'||base.lifecycle!=='draft'||
    !Number.isSafeInteger(maxUpdateBytes)||maxUpdateBytes<1||maxUpdateBytes>65536||
    typeof onLocalUpdate!=='function'||typeof writable!=='boolean')
  throw Error('Yjs draft requires an authorized public collaboration session');
 let ydoc;
 if(initialState===null) ydoc=prosemirrorToYDoc(legalToEditor(base));
 else {
  if(!(initialState instanceof Uint8Array)||initialState.byteLength===0||
     initialState.byteLength>3000000)throw Error('Invalid initial collaboration update');
  ydoc=new Y.Doc();
  try{Y.applyUpdate(ydoc,initialState);}catch{ydoc.destroy();throw Error('Invalid initial collaboration update');}
 }
 let closed=false;
 const alive=()=>{if(closed)throw Error('Collaboration session closed');};
 function project(value) {
  const state=editorToLegal(yDocToProsemirror(editorSchema,value),base);
  if(state.tenantId!==base.tenantId||state.id!==base.id||
     state.lifecycle!=='draft'||state.mode!=='collaboration')
   throw Error('Collaborative projection violates the document boundary');
  return state;
 }
 function clone() {
  const copy=new Y.Doc();
  Y.applyUpdate(copy,Y.encodeStateAsUpdate(ydoc));
  return copy;
 }
 function prepare(update) {
  if(!(update instanceof Uint8Array)||!update.byteLength||
     update.byteLength>maxUpdateBytes)throw Error('Invalid or oversized collaboration update');
  const temp=clone();
  try {Y.applyUpdate(temp,update);project(temp);}
  catch {throw Error('Collaboration update failed schema validation');}
  finally {temp.destroy();}
 }
 project(ydoc);
 return Object.freeze({
  snapshot(){alive();return project(ydoc);},
  stateVector(){alive();return Y.encodeStateVector(ydoc);},
  encodeState(remoteVector) {
   alive();
   if(remoteVector!==undefined&&!(remoteVector instanceof Uint8Array))
    throw Error('Invalid collaboration state vector');
   const bytes=remoteVector?Y.encodeStateAsUpdate(ydoc,remoteVector):Y.encodeStateAsUpdate(ydoc);
   if(bytes.byteLength>3000000)throw Error('Collaboration state exceeds the export budget');
   return bytes;
  },
  receive(update) {
   alive();prepare(update);
   Y.applyUpdate(ydoc,update,'remote');
   return project(ydoc);
  },
  mutateLocal(edit) {
   alive();
   if(!writable||typeof edit!=='function')throw Error('Collaboration session is read-only');
   const temp=clone();
   let update;
   try {
    const result=edit(temp);
    if(result&&typeof result.then==='function')throw Error('Asynchronous collaboration edits are not supported');
    project(temp);
    update=Y.encodeStateAsUpdate(temp,Y.encodeStateVector(ydoc));
    if(update.byteLength>maxUpdateBytes)throw Error('Collaboration edit exceeds the update budget');
    prepare(update);
   }finally{temp.destroy();}
   Y.applyUpdate(ydoc,update,'local');
   if(update.byteLength>2)onLocalUpdate(update);
   return project(ydoc);
  },
  close(){if(!closed){closed=true;ydoc.destroy();}}
 });
}
