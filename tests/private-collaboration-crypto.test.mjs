import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import * as Y from 'yjs';
import {
 PRIVATE_UPDATE_MAX_BYTES,sealPrivateYjsUpdate,openPrivateYjsUpdate
} from '../src/private-collaboration-crypto.mjs';

const scope=()=>({
 tenantId:'tenant-1',workspaceId:'workspace-1',documentId:'document-1',
 senderDeviceId:'device-1',epoch:7
});
const key=()=>webcrypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
const bytes=()=>new Uint8Array([3,7,11,19,29]);
const seal=(secret,context=scope(),counter=1,update=bytes())=>
 sealPrivateYjsUpdate({key:secret,context,sequence:counter,update,webCrypto:webcrypto});
const open=(secret,envelope,context=scope())=>
 openPrivateYjsUpdate({key:secret,context,envelope,webCrypto:webcrypto});

test('authenticated binary Yjs update can be applied by a second authorized device',async()=>{
 const shared=await key(),writer=new Y.Doc(),reader=new Y.Doc();
 try{
  writer.getText('legal').insert(0,'Non-public statutory draft');
  const update=Y.encodeStateAsUpdate(writer);
  const envelope=await seal(shared,scope(),11,update);
  const wire=JSON.stringify(envelope);
  assert.doesNotMatch(wire,/Non-public statutory draft|tenant-1|workspace-1|document-1/);
  assert.equal(Object.keys(envelope).length,7);
  assert.equal(envelope.cipher,'AES-256-GCM');
  assert.equal(envelope.senderDeviceId,'device-1');
  const opened=await open(shared,JSON.parse(wire));
  Y.applyUpdate(reader,opened.update);
  assert.equal(reader.getText('legal').toString(),'Non-public statutory draft');
  assert.equal(opened.messageId,'device-1:7:11');
  Y.applyUpdate(reader,opened.update);
  assert.equal(reader.getText('legal').toString(),'Non-public statutory draft');
 }finally{writer.destroy();reader.destroy();}
});
test('wrong tenant, workspace, document, epoch and sender identity all fail closed',async()=>{
 const shared=await key(),envelope=await seal(shared);
 for(const change of [
  {tenantId:'other-tenant'},{workspaceId:'other-workspace'},
  {documentId:'other-document'},{epoch:8},{senderDeviceId:'forged-device'}
 ])await assert.rejects(open(shared,envelope,{...scope(),...change}));
 assert.deepEqual((await open(shared,envelope)).update,bytes());
});
test('wrong key and authentic-looking ciphertext, nonce or sequence modifications fail',async()=>{
 const shared=await key(),other=await key(),envelope=await seal(shared);
 await assert.rejects(open(other,envelope),/authentication failed/);
 const mutate=(field,value)=>({...envelope,[field]:value});
 const validAlter=value=>(value[0]==='A'?'B':'A')+value.slice(1);
 await assert.rejects(open(shared,mutate('ciphertext',validAlter(envelope.ciphertext))),/authentication failed/);
 await assert.rejects(open(shared,mutate('nonce',validAlter(envelope.nonce))),/authentication failed/);
 await assert.rejects(open(shared,mutate('sequence',2)),/authentication failed/);
 for(const invalid of [
  {...envelope,extra:'do-not-accept'},
  {version:2,...envelope,version:2},
  mutate('cipher','plaintext'),
  mutate('nonce','../unsafe'),
  mutate('ciphertext','not+base64/'),
  mutate('ciphertext',''),
  mutate('ciphertext','YQ'),
  mutate('sequence',0),
  mutate('senderDeviceId','other')
 ])await assert.rejects(open(shared,invalid));
});
test('keys must be non-extractable and context and inputs bounded',async()=>{
 const shared=await key();
 const extractable=await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
 await assert.rejects(seal(extractable),/non-extractable/);
 for(const invalid of [
  new Uint8Array(),new Uint8Array(PRIVATE_UPDATE_MAX_BYTES+1),'plaintext'
 ])await assert.rejects(seal(shared,scope(),1,invalid));
 for(const invalidContext of [
  {...scope(),tenantId:'https://wrong'},
  {...scope(),documentId:''},
  {...scope(),epoch:-1},
  {...scope(),epoch:Number.MAX_SAFE_INTEGER},
  {...scope(),senderDeviceId:'not/a/device'}
 ])await assert.rejects(seal(shared,invalidContext));
 for(const invalidSequence of [0,-1,1.5,4294967296,NaN])
  await assert.rejects(seal(shared,scope(),invalidSequence));
 assert.equal((await seal(shared,scope(),1,new Uint8Array(PRIVATE_UPDATE_MAX_BYTES))).cipher,'AES-256-GCM');
});
test('nonces differ for the same payload; no plaintext fallback for bad encryption',async()=>{
 const shared=await key(),first=await seal(shared),second=await seal(shared);
 assert.notEqual(first.nonce,second.nonce);
 assert.notEqual(first.ciphertext,second.ciphertext);
 const noCrypto={getRandomValues:webcrypto.getRandomValues.bind(webcrypto)};
 await assert.rejects(sealPrivateYjsUpdate({key:shared,context:scope(),sequence:2,update:bytes(),webCrypto:noCrypto}),/WebCrypto/);
 const decrypted=await open(shared,first);
 assert.deepEqual(decrypted.update,bytes());
 assert(Object.isFrozen(first));
});
test('message ids support required caller-managed atomic replay protection',async()=>{
 const shared=await key(),envelope=await seal(shared);
 const seen=new Set(),applyOnce=async()=>{
  const opened=await open(shared,envelope);
  if(seen.has(opened.messageId))return false;
  seen.add(opened.messageId);
  return true;
 };
 assert.equal(await applyOnce(),true);
 assert.equal(await applyOnce(),false);
 // The cryptographic frame alone does not enforce replay protection or durable deduplication.
});
