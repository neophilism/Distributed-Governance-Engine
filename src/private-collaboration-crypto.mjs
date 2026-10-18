/**
 * DCE-003 / DCE-008 — encrypted Yjs update frames for authorized clients.
 *
 * This is a fail-closed transport ENVELOPE, not a group key protocol.
 * A separate, reviewed device-enrollment/MLS implementation must securely
 * distribute non-extractable epoch keys and authenticate device membership.
 * Never place an epoch key or plaintext Yjs update on an application server.
 */
export const PRIVATE_UPDATE_MAX_BYTES = 32768;
export const PRIVATE_UPDATE_VERSION = 1;
const CIPHER = 'AES-256-GCM';
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const encoder = new TextEncoder();
const FIELDS = ['cipher','ciphertext','epoch','nonce','senderDeviceId','sequence','version'];

function scope(value) {
 if (!value || typeof value !== 'object' || Array.isArray(value) ||
     !idPattern.test(value.tenantId ?? '') ||
     !idPattern.test(value.workspaceId ?? '') ||
     !idPattern.test(value.documentId ?? '') ||
     !idPattern.test(value.senderDeviceId ?? '') ||
     !Number.isSafeInteger(value.epoch) || value.epoch < 0 ||
     value.epoch > 2147483647) throw Error('Invalid private collaboration scope');
 return value;
}
function sequence(value) {
 if (!Number.isSafeInteger(value) || value < 1 || value > 4294967295)
  throw Error('Invalid device update sequence');
 return value;
}
function requireKey(key, usage) {
 if (!key || key.type !== 'secret' || key.extractable !== false ||
     key.algorithm?.name !== 'AES-GCM' || key.algorithm?.length !== 256 ||
     !key.usages?.includes(usage))
  throw Error('A non-extractable AES-256-GCM epoch key is required');
}
function aad(context, counter) {
 return encoder.encode(JSON.stringify([
  'dge-private-yjs-update-v1', CIPHER, context.tenantId, context.workspaceId,
  context.documentId, context.epoch, context.senderDeviceId, counter
 ]));
}
function base64url(bytes) {
 let output = '';
 for (let i = 0; i < bytes.length; i += 8192)
  output += String.fromCharCode(...bytes.subarray(i, i + 8192));
 return btoa(output).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function unbase64url(value, limit) {
 if (typeof value !== 'string' || value.length < 1 ||
     value.length > Math.ceil(limit * 4 / 3) + 8 ||
     !/^[A-Za-z0-9_-]+$/.test(value))
  throw Error('Invalid private update wire encoding');
 let bytes;
 try {
  bytes = Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+
   '='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));
 } catch {throw Error('Invalid private update wire encoding');}
 if (bytes.length > limit || base64url(bytes) !== value)
  throw Error('Invalid private update wire encoding');
 return bytes;
}
function validateFrame(frame) {
 if (!frame || typeof frame !== 'object' || Array.isArray(frame) ||
     Object.keys(frame).sort().join(',') !== FIELDS.join(',') ||
     frame.version !== PRIVATE_UPDATE_VERSION || frame.cipher !== CIPHER ||
     !idPattern.test(frame.senderDeviceId ?? '') ||
     !Number.isSafeInteger(frame.epoch) || frame.epoch < 0 ||
     frame.epoch > 2147483647)
  throw Error('Unsupported private collaboration frame');
 sequence(frame.sequence);
 const nonce = unbase64url(frame.nonce,12);
 const ciphertext = unbase64url(frame.ciphertext,PRIVATE_UPDATE_MAX_BYTES + 16);
 if (nonce.length !== 12 || ciphertext.length < 17)
  throw Error('Invalid private collaboration frame size');
 return {nonce,ciphertext};
}

/**
 * Encrypt a CRDT binary update with a fresh 96-bit nonce and authenticated
 * document/device/epoch/sequence context. Caller must ensure a durable unique
 * sequence per device and rotate keys according to reviewed group policy.
 */
export async function sealPrivateYjsUpdate({
 key, context, update, sequence: counter, webCrypto = globalThis.crypto
}) {
 const trusted = scope(context);
 sequence(counter);
 requireKey(key,'encrypt');
 if (!(update instanceof Uint8Array) || update.length < 1 ||
     update.length > PRIVATE_UPDATE_MAX_BYTES)
  throw Error('Invalid private Yjs update size');
 if (!webCrypto?.getRandomValues || !webCrypto?.subtle?.encrypt)
  throw Error('Secure WebCrypto required');
 const nonce = webCrypto.getRandomValues(new Uint8Array(12));
 const ciphertext = new Uint8Array(await webCrypto.subtle.encrypt({
  name:'AES-GCM',iv:nonce,additionalData:aad(trusted,counter),tagLength:128
 },key,update));
 return Object.freeze({
  version:PRIVATE_UPDATE_VERSION,cipher:CIPHER,epoch:trusted.epoch,
  senderDeviceId:trusted.senderDeviceId,sequence:counter,
  nonce:base64url(nonce),ciphertext:base64url(ciphertext)
 });
}

/**
 * Decrypt only for a device identity trusted independently of the untrusted
 * wire frame. The caller MUST enforce authorization and atomically dedupe
 * senderDeviceId/epoch/sequence before applying the returned Yjs update.
 */
export async function openPrivateYjsUpdate({
 key,context,envelope,webCrypto=globalThis.crypto
}) {
 const trusted=scope(context);
 requireKey(key,'decrypt');
 const {nonce,ciphertext}=validateFrame(envelope);
 if (envelope.epoch !== trusted.epoch ||
     envelope.senderDeviceId !== trusted.senderDeviceId)
  throw Error('Private sender or key epoch changed');
 if (!webCrypto?.subtle?.decrypt) throw Error('Secure WebCrypto required');
 let plaintext;
 try {
  plaintext=await webCrypto.subtle.decrypt({
   name:'AES-GCM',iv:nonce,additionalData:aad(trusted,envelope.sequence),
   tagLength:128
  },key,ciphertext);
 } catch {throw Error('Private collaboration authentication failed');}
 const update=new Uint8Array(plaintext);
 if (!update.length || update.length>PRIVATE_UPDATE_MAX_BYTES)
  throw Error('Invalid decrypted private update');
 return Object.freeze({
  update,
  sequence:envelope.sequence,
  senderDeviceId:trusted.senderDeviceId,
  epoch:trusted.epoch,
  // This is a replay-detection key, not an authenticated server receipt.
  messageId:trusted.senderDeviceId+':'+trusted.epoch+':'+envelope.sequence
 });
}
