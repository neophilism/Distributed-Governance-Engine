import {validateLegalDocument} from '../src/legal-structure.mjs';
import {PRIVATE_CACHE_MAX_BYTES,encodePrivateDraft,decodePrivateDraft,encryptLocalDraftBytes,decryptLocalDraftBytes} from '../src/private-crypto.mjs';

/**
 * Storage only holds authenticated ciphertext. A key must be supplied by a
 * separate verified device-unlock flow; the adapter never serializes a key.
 * Key rotation must use a new epoch and a new cryptographic key.
 */
export function createEncryptedDraftCache(storage,{key,tenantId,workspaceId,documentId,epoch,webCrypto=globalThis.crypto}) {
 if(!storage||['getItem','setItem','removeItem'].some(k=>typeof storage[k]!=='function'))
  throw Error('Encrypted cache requires a storage adapter');
 const scope={tenantId,workspaceId,documentId,epoch};
 if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(tenantId??'') ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(workspaceId??'') ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(documentId??'') ||
    !Number.isSafeInteger(epoch)||epoch<0)throw Error('Invalid encrypted-cache scope');
 const storageKey=['quill-private-cache-v1',tenantId,workspaceId,documentId,String(epoch)]
  .map(encodeURIComponent).join(':');
 function assertDocument(input) {
  const document=validateLegalDocument(input);
  if(document.tenantId!==tenantId||document.id!==documentId||
     document.lifecycle!=='draft'||document.mode!=='collaboration')
   throw Error('Confidential draft identity or mutability mismatch');
  return document;
 }
 return Object.freeze({
  async save(input) {
   const document=assertDocument(input);
   const data=encodePrivateDraft(document);
   if(data.length>PRIVATE_CACHE_MAX_BYTES)return {state:'failed',reason:'Draft exceeds encrypted-cache limit'};
   try {
    const envelope=await encryptLocalDraftBytes(key,data,scope,webCrypto);
    storage.setItem(storageKey,JSON.stringify(envelope));
    return {state:'saved',revision:document.revision};
   } catch {return {state:'failed',reason:'Private draft encryption or storage failed'};}
  },
  async load({minimumRevision=0}={}) {
   if(!Number.isSafeInteger(minimumRevision)||minimumRevision<0)
    throw Error('Invalid minimum trusted revision');
   let value;
   try{value=storage.getItem(storageKey);}
   catch{return {state:'failed',reason:'Private draft storage unavailable'};}
   if(value===null)return {state:'empty'};
   if(typeof value!=='string'||value.length>Math.ceil((PRIVATE_CACHE_MAX_BYTES+16)*4/3)+1024)
    return {state:'corrupt',reason:'Private draft envelope too large'};
   try {
    const document=assertDocument(decodePrivateDraft(
     await decryptLocalDraftBytes(key,JSON.parse(value),scope,webCrypto)));
    if(document.revision<minimumRevision)return {state:'stale',revision:document.revision};
    return {state:'available',document};
   } catch{return {state:'corrupt',reason:'Private draft could not be authenticated'};}
  },
  clear() {
   try{storage.removeItem(storageKey);return {state:'cleared'};}
   catch{return {state:'failed',reason:'Private draft storage unavailable'};}
  }
 });
}
