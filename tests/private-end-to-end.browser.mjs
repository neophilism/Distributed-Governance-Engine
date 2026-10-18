/**
 * Real TLS 1.3 -> signed-in OIDC session -> private frame ledger -> PostgreSQL
 * -> authorized second browser connection -> client-only Yjs decryption.
 *
 * Device authorization is a deliberately synthetic test adapter, never an MLS
 * implementation or an acceptable production authenticator.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,webcrypto} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:https';
import {PGlite} from '@electric-sql/pglite';
import {WebSocket} from 'ws';
import * as Y from 'yjs';
import {applyIdentityMigrations,createIdentityStore} from '../server/identity-store.mjs';
import {createPrivateDocumentStore} from '../server/private-document-store.mjs';
import {createPrivateUpdateLedger} from '../server/private-update-ledger.mjs';
import {attachPrivateCollaborationHub} from '../server/private-collaboration-hub.mjs';
import {sealPrivateYjsUpdate,openPrivateYjsUpdate} from '../src/private-collaboration-crypto.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,timeout=8000){
 const end=Date.now()+timeout;
 while(Date.now()<end){const value=fn();if(value)return value;await sleep(20);}
 throw Error('Timeout in encrypted collaborative integration test');
}
test('two authenticated clients exchange only ciphertext, persist and revoke access at the database boundary',{timeout:30000},async()=>{
 const db=await PGlite.create();
 const tmp=mkdtempSync(join(tmpdir(),'dge-private-integrated-'));
 let server,hub,writer,reader,restored;
 const transaction=fn=>db.transaction(async tx=>{
  await tx.exec('SET LOCAL ROLE dge_identity_runtime');return fn(tx);
 });
 try{
  await applyIdentityMigrations(fn=>db.transaction(fn));
  const openssl=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes',
   '-keyout',join(tmp,'key.pem'),'-out',join(tmp,'cert.pem'),
   '-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1',
   '-days','1'],{stdio:'ignore'});
  assert.equal(openssl.status,0,'TLS test certificate creation');
  server=createServer({key:readFileSync(join(tmp,'key.pem')),
   cert:readFileSync(join(tmp,'cert.pem')),minVersion:'TLSv1.3'},
   (_request,response)=>{response.statusCode=404;response.end();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='https://127.0.0.1:'+server.address().port;
  const identity=createIdentityStore({
   transaction,origin,sessionKey:randomBytes(32),stateKey:randomBytes(32)
  });
  const login=async()=>({
   ...await identity.establishSession({
    issuer:'https://provider.example',subject:randomUUID(),authenticatedAt:Date.now()
   }),origin
  });
  const owner=await login(),viewer=await login();
  const {tenantId}=await identity.createTenant(owner);
  const invite=await identity.invite(owner,tenantId,viewer.accountId,'viewer');
  await identity.acceptInvitation(viewer,tenantId,invite.invitationToken);
  const documentId=randomUUID(),writerDevice=randomUUID(),viewerDevice=randomUUID();
  const access=({actor,credentials,senderDeviceId,operation})=>{
   const issuer=actor.accountId===owner.accountId&&credentials.sessionToken===owner.sessionToken;
   const recipient=actor.accountId===viewer.accountId&&credentials.sessionToken===viewer.sessionToken;
   if(operation==='append')return issuer&&senderDeviceId===writerDevice;
   if(operation==='list')return issuer&&senderDeviceId===writerDevice||
    recipient&&senderDeviceId===viewerDevice;
   return issuer||recipient;
  };
  const privateDocuments=createPrivateDocumentStore({identity,authorizeDevice:access});
  await privateDocuments.create(owner,tenantId,{
   documentId,commandId:randomUUID(),envelope:{
    version:1,cipher:'AES-256-GCM',keyEpoch:0,
    nonce:randomBytes(12).toString('base64url'),
    ciphertext:randomBytes(80).toString('base64url')
   }
  });
  const ledger=createPrivateUpdateLedger({identity,authorizeDevice:access});
  hub=attachPrivateCollaborationHub({server,origin,ledger,maxRooms:2});
  const opened=[];
  async function connect(user,device){
   const ws=new WebSocket('wss://127.0.0.1:'+server.address().port+
    '/ws/private/'+tenantId+'/'+documentId+'/'+device,['dge-private-v1'],
    {rejectUnauthorized:false,headers:{
     Origin:origin,Cookie:'__Host-dge_session='+user.sessionToken+
      '; __Host-dge_csrf='+user.csrfToken
    }});
   const incoming=[];opened.push(ws);ws.on('error',()=>{});
   ws.on('message',(buffer,isBinary)=>{
    if(!isBinary)try{incoming.push(JSON.parse(buffer.toString('utf8')));}catch{}
   });
   await until(()=>ws.readyState===WebSocket.OPEN||ws.readyState===WebSocket.CLOSED);
   assert.equal(ws.readyState,WebSocket.OPEN);
   await until(()=>incoming.some(item=>item.kind==='ready'));
   return {ws,incoming};
  }
  writer=await connect(owner,writerDevice);
  reader=await connect(viewer,viewerDevice);
  const groupKey=await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const source=new Y.Doc(),receiver=new Y.Doc();
  try{
   source.getText('document').insert(0,'Top secret joint resolution');
   const frame=await sealPrivateYjsUpdate({
    key:groupKey,context:{tenantId,workspaceId:tenantId,documentId,
     senderDeviceId:writerDevice,epoch:0},
    update:Y.encodeStateAsUpdate(source),sequence:1,webCrypto:webcrypto
   });
   writer.ws.send(JSON.stringify({kind:'update',frame}));
   const acknowledgement=await until(()=>writer.incoming.find(x=>x.kind==='ack'));
   assert.equal(acknowledgement.position,1);
   const delivered=await until(()=>reader.incoming.find(x=>x.kind==='update'));
   assert.equal(delivered.position,1);
   const decrypted=await openPrivateYjsUpdate({
    key:groupKey,context:{tenantId,workspaceId:tenantId,documentId,
     senderDeviceId:writerDevice,epoch:0},
    envelope:delivered.frame,webCrypto:webcrypto
   });
   Y.applyUpdate(receiver,decrypted.update);
   assert.equal(receiver.getText('document').toString(),'Top secret joint resolution');
   assert.doesNotMatch(JSON.stringify(reader.incoming),/Top secret joint resolution/);
   const allVersions=JSON.stringify((await db.query('SELECT * FROM dge_private.update_frames')).rows);
   assert.doesNotMatch(allVersions,/Top secret joint resolution/);
   // Remove only the viewer. An already-open socket must not receive the
   // next update even if it still holds an old valid session token.
   await identity.changeMember(owner,tenantId,viewer.accountId,null);
   source.getText('document').insert(0,'Updated ');
   const second=await sealPrivateYjsUpdate({
    key:groupKey,context:{tenantId,workspaceId:tenantId,documentId,
     senderDeviceId:writerDevice,epoch:0},
    update:Y.encodeStateAsUpdate(source),sequence:2,webCrypto:webcrypto
   });
   writer.ws.send(JSON.stringify({kind:'update',frame:second}));
   await until(()=>writer.incoming.filter(x=>x.kind==='ack').length===2);
   await until(()=>reader.ws.readyState===WebSocket.CLOSING||
    reader.ws.readyState===WebSocket.CLOSED);
   assert.equal(reader.incoming.filter(x=>x.kind==='update').length,1);
   assert.equal((await db.query('SELECT count(*)::int AS n FROM dge_private.update_frames')).rows[0].n,2);
   // The writer can recover both ciphertext updates from PostgreSQL after reconnect.
   writer.ws.close();
   restored=await connect(owner,writerDevice);
   restored.ws.send(JSON.stringify({kind:'pull',after:0,limit:10}));
   const pulled=await until(()=>restored.incoming.find(x=>x.kind==='updates'));
   assert.deepEqual(pulled.items.map(x=>x.position),[1,2]);
   assert(pulled.items.every(x=>typeof x.frame.ciphertext==='string'));
  }finally{source.destroy();receiver.destroy();}
 }finally{
  hub?.close();
  for(const ws of [writer?.ws,reader?.ws,restored?.ws])ws?.terminate();
  if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  rmSync(tmp,{recursive:true,force:true});
  await db.close();
 }
});
