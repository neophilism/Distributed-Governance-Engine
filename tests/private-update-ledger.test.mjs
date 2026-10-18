import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,webcrypto} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import * as Y from 'yjs';
import {createIdentityStore,applyIdentityMigrations} from '../server/identity-store.mjs';
import {createPrivateDocumentStore} from '../server/private-document-store.mjs';
import {createPrivateUpdateLedger} from '../server/private-update-ledger.mjs';
import {createPrivateUpdateRoutes} from '../server/private-update-http.mjs';
import {createAccountHandler} from '../server/account-http.mjs';
import {sealPrivateYjsUpdate,openPrivateYjsUpdate} from '../src/private-collaboration-crypto.mjs';
const origin='https://quill.example';
let db,identity,owner,viewer,outsider,tenantId,documentId,deviceId,ledger,privateDocs;
const transaction=fn=>db.transaction(async tx=>{await tx.exec('SET LOCAL ROLE dge_identity_runtime');return fn(tx);});
const issue=async()=>({...await identity.establishSession({
 issuer:'https://provider.example',subject:randomUUID(),authenticatedAt:Date.now()
}),origin});
const opaqueSnapshot=epoch=>({version:1,cipher:'AES-256-GCM',keyEpoch:epoch,
 nonce:randomBytes(12).toString('base64url'),ciphertext:randomBytes(51).toString('base64url')});
const wire=(sequence=1,epoch=0,other={})=>({
 version:1,cipher:'AES-256-GCM',epoch,senderDeviceId:deviceId,sequence,
 nonce:randomBytes(12).toString('base64url'),ciphertext:randomBytes(28).toString('base64url'),
 ...other
});
before(async()=>{db=await PGlite.create();await applyIdentityMigrations(fn=>db.transaction(fn));});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec('TRUNCATE dge_identity.accounts,dge_identity.tenants,dge_identity.login_challenges CASCADE');
 identity=createIdentityStore({transaction,origin,sessionKey:randomBytes(32),stateKey:randomBytes(32)});
 owner=await issue();viewer=await issue();outsider=await issue();
 ({tenantId}=await identity.createTenant(owner));documentId=randomUUID();deviceId=randomUUID();
 const invite=await identity.invite(owner,tenantId,viewer.accountId,'viewer');
 await identity.acceptInvitation(viewer,tenantId,invite.invitationToken);
 privateDocs=createPrivateDocumentStore({identity,authorizeDevice:async()=>true,authorizeEpochAdvance:async()=>true});
 await privateDocs.create(owner,tenantId,{documentId,commandId:randomUUID(),envelope:opaqueSnapshot(0)});
 const allowed=({actor,credentials,senderDeviceId})=>senderDeviceId===deviceId&&
  ((actor.accountId===owner.accountId&&credentials.sessionToken===owner.sessionToken)||
   (actor.accountId===viewer.accountId&&credentials.sessionToken===viewer.sessionToken));
 ledger=createPrivateUpdateLedger({identity,authorizeDevice:allowed});
});
test('private ledger cannot be constructed without trusted device authorization',()=>{
 assert.throws(()=>createPrivateUpdateLedger({identity}),/verified device/);
 assert.throws(()=>createPrivateUpdateLedger({identity,authorizeDevice:'yes'}),/verified device/);
});
test('encrypted Yjs update persists and decrypts only with group key on authorized recipient',async()=>{
 const key=await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 const y=new Y.Doc();
 try {
  y.getText('legal').insert(0,'Not for server operators');
  const update=Y.encodeStateAsUpdate(y);
  const envelope=await sealPrivateYjsUpdate({
   key,context:{tenantId,workspaceId:tenantId,documentId,senderDeviceId:deviceId,epoch:0},
   update,sequence:1,webCrypto:webcrypto
  });
  const saved=await ledger.append(owner,tenantId,documentId,envelope);
  assert.equal(saved.replayed,false);assert.equal(saved.frame.position,1);
  const received=await ledger.list(viewer,tenantId,documentId,{recipientDeviceId:deviceId});
  assert.equal(received.keyEpoch,0);assert.equal(received.items.length,1);
  const decrypted=await openPrivateYjsUpdate({
   key,context:{tenantId,workspaceId:tenantId,documentId,senderDeviceId:deviceId,epoch:0},
   envelope:received.items[0],webCrypto:webcrypto
  }).catch(()=>null);
  // The receiver uses only the authenticated envelope fields; the server adds a
  // storage cursor that must not be presented as part of the crypto frame.
  assert.equal(decrypted,null);
  const {position,...cryptoFrame}=received.items[0];
  const opened=await openPrivateYjsUpdate({
   key,context:{tenantId,workspaceId:tenantId,documentId,senderDeviceId:deviceId,epoch:0},
   envelope:cryptoFrame,webCrypto:webcrypto
  });
  const replica=new Y.Doc();try{
   Y.applyUpdate(replica,opened.update);
   assert.equal(replica.getText('legal').toString(),'Not for server operators');
  }finally{replica.destroy();}
  const raw=JSON.stringify((await db.query('SELECT * FROM dge_private.update_frames')).rows);
  assert.doesNotMatch(raw,/Not for server operators/);
  assert.equal((await ledger.list(owner,tenantId,documentId,{recipientDeviceId:deviceId})).items[0].ciphertext,envelope.ciphertext);
 }finally{y.destroy();}
});
test('identical sender sequence is replayed once; changed ciphertext is rejected',async()=>{
 const value=wire(12),first=await ledger.append(owner,tenantId,documentId,value),
  replay=await ledger.append(owner,tenantId,documentId,value);
 assert.equal(first.frame.position,1);
 assert.equal(replay.replayed,true);
 assert.equal(replay.frame.position,1);
 await assert.rejects(ledger.append(owner,tenantId,documentId,{
  ...value,ciphertext:randomBytes(28).toString('base64url')
 }),/PRIVATE_SEQUENCE_REUSED/);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM dge_private.update_frames')).rows[0].n,1);
});
test('stale epoch, unauthorized device, nonmember and viewer writes fail closed',async()=>{
 await assert.rejects(ledger.append(viewer,tenantId,documentId,wire()),/ACCESS_DENIED|STEP_UP_REQUIRED/);
 await assert.rejects(ledger.append(outsider,tenantId,documentId,wire()));
 await assert.rejects(ledger.list(outsider,tenantId,documentId,{recipientDeviceId:deviceId}));
 await assert.rejects(ledger.append(owner,tenantId,documentId,wire(1,0,{senderDeviceId:randomUUID()})),/PRIVATE_DEVICE_NOT_AUTHORIZED/);
 await assert.rejects(ledger.list(viewer,tenantId,documentId,{recipientDeviceId:randomUUID()}),/PRIVATE_DEVICE_NOT_AUTHORIZED/);
 await ledger.append(owner,tenantId,documentId,wire(1));
 await privateDocs.save(owner,tenantId,documentId,{
  commandId:randomUUID(),expectedVersion:1,envelope:opaqueSnapshot(1)
 });
 await assert.rejects(ledger.append(owner,tenantId,documentId,wire(2,0)),/PRIVATE_EPOCH_CHANGED/);
 const current=await ledger.list(owner,tenantId,documentId,{recipientDeviceId:deviceId});
 assert.equal(current.keyEpoch,1);assert.equal(current.items.length,0);
 await ledger.append(owner,tenantId,documentId,wire(1,1));
 assert.deepEqual((await ledger.list(viewer,tenantId,documentId,{recipientDeviceId:deviceId})).items.map(x=>x.epoch),[1]);
 await identity.changeMember(owner,tenantId,viewer.accountId,null);
 await assert.rejects(ledger.list(viewer,tenantId,documentId,{recipientDeviceId:deviceId}));
});
test('malformed, oversized, plaintext and wrong-scope updates are rejected',async()=>{
 for(const invalid of [
  {...wire(),document:{text:'private'}},
  {...wire(),cipher:'none'},
  {...wire(),epoch:-1},
  {...wire(),epoch:1},
  {...wire(),senderDeviceId:'forged'},
  {...wire(),sequence:0},
  {...wire(),nonce:'abc'},
  {...wire(),ciphertext:'not+base64/'},
  {...wire(),ciphertext:randomBytes(32785).toString('base64url')}
 ])await assert.rejects(ledger.append(owner,tenantId,documentId,invalid));
 await assert.rejects(ledger.append(owner,randomUUID(),documentId,wire()));
 await assert.rejects(ledger.list(owner,tenantId,documentId,{recipientDeviceId:deviceId,limit:101}));
 await assert.rejects(ledger.list(owner,tenantId,documentId,{recipientDeviceId:deviceId,after:-1}));
});
test('bounded cursor pagination and current epoch history are deterministic',async()=>{
 for(let i=1;i<=4;i++)await ledger.append(owner,tenantId,documentId,wire(i));
 const a=await ledger.list(owner,tenantId,documentId,{recipientDeviceId:deviceId,limit:2});
 assert.deepEqual(a.items.map(x=>x.position),[1,2]);assert.equal(a.nextCursor,2);
 const b=await ledger.list(owner,tenantId,documentId,{recipientDeviceId:deviceId,after:a.nextCursor,limit:2});
 assert.deepEqual(b.items.map(x=>x.position),[3,4]);assert.equal(b.nextCursor,null);
});
test('ciphertext tampering is detected; ordinary SQL role cannot rewrite history',async()=>{
 await ledger.append(owner,tenantId,documentId,wire());
 await db.query('UPDATE dge_private.update_frames SET ciphertext=$1 WHERE tenant_id=$2 AND document_id=$3',
  [randomBytes(28),tenantId,documentId]);
 await assert.rejects(ledger.list(owner,tenantId,documentId,{recipientDeviceId:deviceId}),/PRIVATE_FRAME_INTEGRITY_ERROR/);
 await transaction(async tx=>{
  await tx.query("SELECT set_config('dge.tenant_id',$1,true)",[tenantId]);
  await assert.rejects(tx.query('DELETE FROM dge_private.update_frames'),/permission denied/);
 });
});
test('budget failure leaves no half-written updates',async()=>{
 const limited=createPrivateUpdateLedger({identity,authorizeDevice:async()=>true,maxStoredBytes:1});
 await assert.rejects(limited.append(owner,tenantId,documentId,wire()),/PRIVATE_STORAGE_LIMIT_REACHED/);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM dge_private.update_frames')).rows[0].n,0);
});

test('optional HTTP route rejects plaintext and wrong origin; authorized reader sees ciphertext only',async()=>{
 const handler=createAccountHandler({store:identity,origin,login:{},
  extensions:[createPrivateUpdateRoutes({ledger})]});
 const path='/api/workspaces/'+tenantId+'/private-documents/'+documentId+'/updates';
 const send=(method,path,who,body)=>handler(new Request(origin+path,{
  method,
  headers:{
   ...(who?{cookie:'__Host-dge_session='+who.sessionToken,origin:who.origin,'x-dge-csrf':who.csrfToken}:{}),
   ...(body?{'content-type':'application/json'}:{})
  },
  ...(body?{body:JSON.stringify(body)}:{})
 }),{peerAddress:'127.0.0.1'});
 const rejected=await send('POST',path,owner,{...wire(),plaintext:'SENSITIVE'});
 assert.equal(rejected.status,400);
 const accepted=await send('POST',path,owner,wire());
 assert.equal(accepted.status,200);
 assert.equal((await accepted.json()).frame.position,1);
 const list=await send('GET',path+'?recipientDeviceId='+deviceId,viewer);
 assert.equal(list.status,200);
 const result=await list.json();
 assert.equal(result.items.length,1);
 assert.equal(typeof result.items[0].ciphertext,'string');
 assert.equal(Object.hasOwn(result.items[0],'plaintext'),false);
 const wrong=await send('POST',path,{...owner,origin:'https://evil.example'},wire(2));
 assert.notEqual(wrong.status,200);
 const unknownQuery=await send('GET',path+'?recipientDeviceId='+deviceId+'&other=forged',viewer);
 assert.equal(unknownQuery.status,400);
});
