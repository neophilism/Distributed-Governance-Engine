import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createIdentityStore,applyIdentityMigrations} from '../server/identity-store.mjs';
import {createPrivateDocumentStore} from '../server/private-document-store.mjs';
import {createPrivateDocumentRoutes} from '../server/private-document-http.mjs';
import {createAccountHandler} from '../server/account-http.mjs';

const origin='https://quill.example';
let db,identity,privateDocs,owner,viewer,outsider,tenantId;
const transaction=fn=>db.transaction(async tx=>{await tx.exec('SET LOCAL ROLE dge_identity_runtime');return fn(tx);});
const envelope=(epoch=0)=>({
 version:1,cipher:'AES-256-GCM',keyEpoch:epoch,
 nonce:randomBytes(12).toString('base64url'),ciphertext:randomBytes(52).toString('base64url')
});
const issue=async(subject=randomUUID())=>({...await identity.establishSession({
 issuer:'https://provider.example',subject,authenticatedAt:Date.now()
}),origin});
const payload=()=>({documentId:randomUUID(),commandId:randomUUID(),envelope:envelope()});
before(async()=>{db=await PGlite.create();await applyIdentityMigrations(fn=>db.transaction(fn));});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec('TRUNCATE dge_identity.accounts,dge_identity.tenants,dge_identity.login_challenges CASCADE');
 identity=createIdentityStore({transaction,origin,sessionKey:randomBytes(32),stateKey:randomBytes(32)});
 privateDocs=createPrivateDocumentStore({identity,authorizeDevice:async()=>true});
 owner=await issue();viewer=await issue();outsider=await issue();
 ({tenantId}=await identity.createTenant(owner));
 const invite=await identity.invite(owner,tenantId,viewer.accountId,'viewer');
 await identity.acceptInvitation(viewer,tenantId,invite.invitationToken);
});
test('a real server cannot instantiate a private store without a device authority',()=>{
 assert.throws(()=>createPrivateDocumentStore({identity}),/Verified private device/);
 assert.throws(()=>createPrivateDocumentStore({identity,authorizeDevice:true}),/Verified private device/);
});
test('the private authorization adapter receives verified account and session context, never body-asserted authority',async()=>{
 const captured=[];
 const gate=createPrivateDocumentStore({identity,authorizeDevice:async evidence=>{
  captured.push(evidence);
  return evidence.actor.accountId===owner.accountId &&
   evidence.credentials.sessionToken===owner.sessionToken;
 }});
 const item=payload();
 await gate.create(owner,tenantId,item);
 await gate.read(owner,tenantId,item.documentId);
 assert.equal(captured.length,2);
 assert.deepEqual(captured.map(e=>e.operation),['create','read']);
 assert(captured.every(e=>e.tenantId===tenantId&&e.documentId===item.documentId));
 await assert.rejects(gate.read(viewer,tenantId,item.documentId),/PRIVATE_DEVICE_NOT_AUTHORIZED/);
});
test('private create, read and save persist only ciphertext and exact immutable versions',async()=>{
 const item=payload(),created=await privateDocs.create(owner,tenantId,item);
 assert.equal(created.visibility,'private');
 assert.equal(created.version,1);
 assert.equal(created.documentId,item.documentId);
 assert.equal(created.ciphertext,item.envelope.ciphertext);
 const read=await createPrivateDocumentStore({identity,authorizeDevice:async()=>true}).read(viewer,tenantId,item.documentId);
 assert.deepEqual(read,created);
 const next=envelope();
 const saved=await privateDocs.save(owner,tenantId,item.documentId,{
  commandId:randomUUID(),expectedVersion:1,envelope:next
 });
 assert.equal(saved.version,2);
 assert.equal(saved.previousDigest,created.digest);
 assert.deepEqual((await privateDocs.read(owner,tenantId,item.documentId)),saved);
 const raw=JSON.stringify((await db.query('SELECT * FROM dge_private.versions')).rows);
 assert.doesNotMatch(raw,/document JSON|Secret legal document|private key/);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM dge_private.versions')).rows[0].n,2);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM dge_private.documents')).rows[0].n,1);
});
test('private bodies refuse plaintext, extra metadata, invalid encodings and bad key epochs',async()=>{
 for(const input of [
  {...payload(),document:{title:'PRIVATE'}},
  {...payload(),envelope:{...envelope(),title:'Private title'}},
  {...payload(),envelope:{...envelope(),cipher:'none'}},
  {...payload(),envelope:{...envelope(),keyEpoch:-1}},
  {...payload(),envelope:{...envelope(),nonce:'ab'}},
  {...payload(),envelope:{...envelope(),ciphertext:'not+canonical/' }},
  {...payload(),envelope:{...envelope(),ciphertext:'AQ'}},
 ])await assert.rejects(privateDocs.create(owner,tenantId,input));
});
test('command ids are idempotent and conflict on changed payload',async()=>{
 const item=payload(),created=await privateDocs.create(owner,tenantId,item);
 assert.deepEqual(await privateDocs.create(owner,tenantId,item),created);
 await assert.rejects(privateDocs.create(owner,tenantId,{...item,envelope:envelope()}),/COMMAND_REUSED/);
 const n=(await db.query('SELECT count(*)::int AS n FROM dge_private.versions')).rows[0].n;
 assert.equal(n,1);
 await assert.rejects(privateDocs.save(owner,tenantId,item.documentId,{
  commandId:randomUUID(),expectedVersion:3,envelope:envelope()
 }),/PRIVATE_VERSION_CONFLICT/);
});
test('tenant/member role revocation and mandatory device authorization protect private content',async()=>{
 const item=payload();await privateDocs.create(owner,tenantId,item);
 await assert.rejects(privateDocs.read(outsider,tenantId,item.documentId));
 await assert.rejects(privateDocs.save(viewer,tenantId,item.documentId,{
  commandId:randomUUID(),expectedVersion:1,envelope:envelope()
 }));
 const denied=createPrivateDocumentStore({identity,authorizeDevice:async()=>false});
 await assert.rejects(denied.read(owner,tenantId,item.documentId),/PRIVATE_DEVICE_NOT_AUTHORIZED/);
 await identity.changeMember(owner,tenantId,viewer.accountId,null);
 await assert.rejects(privateDocs.read(viewer,tenantId,item.documentId));
});
test('epoch change requires independent trusted rekey approval; storage limits roll back atomically',async()=>{
 const item=payload();await privateDocs.create(owner,tenantId,item);
 await assert.rejects(privateDocs.save(owner,tenantId,item.documentId,{
  commandId:randomUUID(),expectedVersion:1,envelope:envelope(1)
 }),/PRIVATE_REKEY_REQUIRED/);
 const allowRekey=createPrivateDocumentStore({identity,authorizeDevice:async()=>true,authorizeEpochAdvance:async()=>true});
 const upgraded=await allowRekey.save(owner,tenantId,item.documentId,{
  commandId:randomUUID(),expectedVersion:1,envelope:envelope(1)
 });
 assert.equal(upgraded.keyEpoch,1);
 await assert.rejects(allowRekey.save(owner,tenantId,item.documentId,{
  commandId:randomUUID(),expectedVersion:2,envelope:envelope(0)
 }),/PRIVATE_REKEY_REQUIRED/);
 const limited=createPrivateDocumentStore({identity,authorizeDevice:async()=>true,maxStoredBytes:10});
 await assert.rejects(limited.create(owner,tenantId,payload()),/STORAGE_LIMIT/);
});
test('tampered ciphertext, forged nonce or broken version digest is detected before read',async()=>{
 const item=payload();await privateDocs.create(owner,tenantId,item);
 await db.query('UPDATE dge_private.versions SET ciphertext=$1 WHERE tenant_id=$2 AND document_id=$3',
  [randomBytes(52),tenantId,item.documentId]);
 await assert.rejects(privateDocs.read(owner,tenantId,item.documentId),/PRIVATE_INTEGRITY_ERROR/);
});
test('HTTP private endpoints reject plaintext and enforce cookie/origin before returning any private bytes',async()=>{
 const handler=createAccountHandler({store:identity,login:{},origin,
  extensions:[createPrivateDocumentRoutes({documents:privateDocs})]});
 const item=payload(),url=origin+'/api/workspaces/'+tenantId+'/private-documents';
 const req=(body,auth=owner)=>new Request(url,{
  method:'POST',headers:{
   cookie:'__Host-dge_session='+auth.sessionToken,
   origin:auth.origin,'x-dge-csrf':auth.csrfToken,
   'content-type':'application/json'
  },body:JSON.stringify(body)
 });
 const denied=await handler(req({...item,document:{kind:'private',text:'sensitive'}}),{peerAddress:'127.0.0.1'});
 assert.equal(denied.status,400);
 const saved=await handler(req(item),{peerAddress:'127.0.0.1'});
 assert.equal(saved.status,200);
 const json=await saved.json();assert.equal(json.visibility,'private');
 assert.equal(JSON.stringify(json).includes('sensitive'),false);
 const wrongOrigin=await handler(req(payload(),{...owner,origin:'https://wrong.example'}),{peerAddress:'127.0.0.1'});
 assert.notEqual(wrongOrigin.status,200);
});
