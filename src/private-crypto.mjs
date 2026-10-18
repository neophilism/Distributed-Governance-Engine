/**
 * Local-only, authenticated encryption for confidential draft recovery.
 * This is NOT MLS, multi-device key distribution, or a network E2EE protocol.
 * The caller owns the non-extractable key and must independently verify device authority.
 */
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', {fatal: true});
export const PRIVATE_CACHE_MAX_BYTES = 3000000;
const ENVELOPE_FIELDS = ['version','cipher','nonce','ciphertext'];
const HEX_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;

function requireKey(key,usage) {
 if(!key || key.type!=='secret' || key.algorithm?.name!=='AES-GCM' ||
    key.algorithm?.length!==256 || key.extractable!==false || !key.usages?.includes(usage))
  throw Error('A non-extractable AES-256-GCM key with the requested usage is required');
}
function requireContext(context) {
 if(!context || typeof context!=='object' || Array.isArray(context) ||
    !HEX_ID.test(context.tenantId??'') || !HEX_ID.test(context.documentId??'') ||
    !HEX_ID.test(context.workspaceId??'') || !Number.isSafeInteger(context.epoch) ||
    context.epoch<0) throw Error('Invalid private-cache scope or key epoch');
 return enc.encode(JSON.stringify(['dge-private-cache-aad-v1', context.tenantId,
  context.workspaceId, context.documentId, context.epoch]));
}
function base64url(bytes) {
 let binary='';
 for(let i=0;i<bytes.length;i+=8192)
  binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
 return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function unbase64url(value,maxBytes) {
 if(typeof value!=='string'||!value.length||value.length>Math.ceil(maxBytes*4/3)+8||
    !/^[A-Za-z0-9_-]+$/.test(value))throw Error('Invalid private-cache envelope encoding');
 let result;
 try {result=Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+
   '='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));}
 catch {throw Error('Invalid private-cache envelope encoding');}
 if(result.length>maxBytes||base64url(result)!==value)throw Error('Invalid private-cache envelope encoding');
 return result;
}
export async function generateEphemeralCacheKey(webCrypto=globalThis.crypto) {
 if(!webCrypto?.subtle?.generateKey)throw Error('Secure WebCrypto is unavailable');
 return webCrypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function encryptLocalDraftBytes(key,bytes,context,webCrypto=globalThis.crypto) {
 requireKey(key,'encrypt');
 const aad=requireContext(context);
 if(!(bytes instanceof Uint8Array)||bytes.length===0||bytes.length>PRIVATE_CACHE_MAX_BYTES)
  throw Error('Invalid private-cache payload length');
 if(!webCrypto?.getRandomValues||!webCrypto?.subtle?.encrypt)throw Error('Secure WebCrypto is unavailable');
 const nonce=webCrypto.getRandomValues(new Uint8Array(12));
 const encrypted=await webCrypto.subtle.encrypt(
  {name:'AES-GCM',iv:nonce,additionalData:aad,tagLength:128},key,bytes);
 return Object.freeze({version:1,cipher:'AES-256-GCM',nonce:base64url(nonce),
  ciphertext:base64url(new Uint8Array(encrypted))});
}
export async function decryptLocalDraftBytes(key,envelope,context,webCrypto=globalThis.crypto) {
 requireKey(key,'decrypt');
 const aad=requireContext(context);
 if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)||
    Object.keys(envelope).length!==ENVELOPE_FIELDS.length||
    !ENVELOPE_FIELDS.every(field=>Object.hasOwn(envelope,field))||
    envelope.version!==1||envelope.cipher!=='AES-256-GCM')
  throw Error('Unsupported private-cache envelope');
 const nonce=unbase64url(envelope.nonce,12);
 const encrypted=unbase64url(envelope.ciphertext,PRIVATE_CACHE_MAX_BYTES+16);
 if(nonce.length!==12||encrypted.length<17)throw Error('Invalid private-cache envelope length');
 if(!webCrypto?.subtle?.decrypt)throw Error('Secure WebCrypto is unavailable');
 let plaintext;
 try {plaintext=await webCrypto.subtle.decrypt(
  {name:'AES-GCM',iv:nonce,additionalData:aad,tagLength:128},key,encrypted);}
 catch {throw Error('Private-cache authentication failed');}
 const bytes=new Uint8Array(plaintext);
 if(!bytes.length||bytes.length>PRIVATE_CACHE_MAX_BYTES)
  throw Error('Invalid decrypted private-cache length');
 return bytes;
}
export const encodePrivateDraft = document => enc.encode(JSON.stringify(document));
export const decodePrivateDraft = bytes => JSON.parse(dec.decode(bytes));
