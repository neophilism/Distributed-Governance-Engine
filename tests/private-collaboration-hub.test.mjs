import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:https';
import {randomUUID,webcrypto} from 'node:crypto';
import {WebSocket} from 'ws';
import * as Y from 'yjs';
import {attachPrivateCollaborationHub} from '../server/private-collaboration-hub.mjs';
import {sealPrivateYjsUpdate,openPrivateYjsUpdate} from '../src/private-collaboration-crypto.mjs';

const a='A'.repeat(43),b='B'.repeat(43),c='C'.repeat(43),csrf='D'.repeat(43);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,ms=5000){
 const deadline=Date.now()+ms;
 while(Date.now()<deadline){const result=fn();if(result)return result;await sleep(15);}
 throw Error('Timed out waiting for private collaboration');
}
async function fixture(){
 const folder=mkdtempSync(join(tmpdir(),'dge-private-wss-'));
 let server,hub;
 const connected=[];
 try{
  const openssl=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes',
   '-keyout',join(folder,'key.pem'),'-out',join(folder,'cert.pem'),
   '-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1',
   '-days','1'],{stdio:'ignore'});
  if(openssl.status!==0)throw Error('TLS test certificate unavailable');
  server=createServer({key:readFileSync(join(folder,'key.pem')),
   cert:readFileSync(join(folder,'cert.pem')),minVersion:'TLSv1.3'},
   (_req,res)=>{res.statusCode=404;res.end();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='https://127.0.0.1:'+server.address().port;
  const tenantId=randomUUID(),documentId=randomUUID(),deviceA=randomUUID(),deviceB=randomUUID();
  const identities=new Map([
   [a,{deviceId:deviceA,role:'editor'}],
   [b,{deviceId:deviceB,role:'viewer'}]
  ]);
  let epoch=0,appendCount=0;
  const records=[];
  const authorize=(creds,tenant,doc,device,write=false)=>{
   if(creds.origin!==origin||creds.csrfToken!==csrf||
      tenant!==tenantId||doc!==documentId||!identities.has(creds.sessionToken)||
      identities.get(creds.sessionToken).deviceId!==device||
      write&&!['editor','admin','owner'].includes(identities.get(creds.sessionToken).role))
    throw Error('DENIED');
  };
  const ledger={
   async list(creds,tenant,doc,{recipientDeviceId,after=0,limit=50}={}){
    authorize(creds,tenant,doc,recipientDeviceId);
    const found=records.filter(row=>row.epoch===epoch&&row.position>after);
    return {keyEpoch:epoch,items:found.slice(0,limit),
     nextCursor:found.length>limit?found[limit-1].position:null};
   },
   async append(creds,tenant,doc,frame){
    authorize(creds,tenant,doc,frame.senderDeviceId,true);
    if(frame.epoch!==epoch)throw Error('STALE_EPOCH');
    if(frame.version!==1||frame.cipher!=='AES-256-GCM'||
       typeof frame.ciphertext!=='string')throw Error('INVALID_CIPHERTEXT');
    const previous=records.find(row=>row.senderDeviceId===frame.senderDeviceId&&
     row.sequence===frame.sequence&&row.epoch===epoch);
    if(previous){
     if(previous.ciphertext!==frame.ciphertext)throw Error('CONFLICTING_SEQUENCE');
     return {frame:previous,replayed:true};
    }
    const entry={...frame,position:records.length+1};
    records.push(entry);appendCount++;
    return {frame:entry,replayed:false};
   }
  };
  hub=attachPrivateCollaborationHub({server,origin,ledger,maxRooms:2});
  async function connect(token,device,{originHeader=origin}={}){
   const ws=new WebSocket('wss://127.0.0.1:'+server.address().port+
    '/ws/private/'+tenantId+'/'+documentId+'/'+device,
    ['dge-private-v1'],{rejectUnauthorized:false,
     headers:{Origin:originHeader,Cookie:'__Host-dge_session='+token+
      '; __Host-dge_csrf='+csrf}});
   const received=[];
   connected.push(ws);
   ws.on('message',(payload,isBinary)=>{
    if(!isBinary){try{received.push(JSON.parse(payload.toString('utf8')));}catch{}}
   });
   ws.on('error',()=>{});
   await until(()=>ws.readyState===WebSocket.OPEN||ws.readyState===WebSocket.CLOSED);
   return {ws,received};
  }
  return {
   tenantId,documentId,deviceA,deviceB,identities,hub,connect,origin,ledger,server,
   getAppends:()=>appendCount,
   rekey:()=>{epoch++;},
   close:async()=>{
    hub.close();for(const ws of connected)ws.terminate();
    await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
   }
  };
 }finally{rmSync(folder,{recursive:true,force:true});}
}
const frame=(sender,seq=1,epoch=0)=>({
 version:1,cipher:'AES-256-GCM',epoch,senderDeviceId:sender,sequence:seq,
 nonce:webcrypto.getRandomValues(new Uint8Array(12)),
 ciphertext:webcrypto.getRandomValues(new Uint8Array(64))
});
const wire=(device,seq=1,epoch=0)=>{
 const f=frame(device,seq,epoch);
 return {...f,nonce:Buffer.from(f.nonce).toString('base64url'),
  ciphertext:Buffer.from(f.ciphertext).toString('base64url')};
};
test('authorized TLS clients receive ciphertext only, with durable ack and reconnect paging',{timeout:15000},async()=>{
 const fx=await fixture();
 try{
  const author=await fx.connect(a,fx.deviceA),reader=await fx.connect(b,fx.deviceB);
  assert.equal((await until(()=>author.received.find(x=>x.kind==='ready'))).keyEpoch,0);
  await until(()=>reader.received.find(x=>x.kind==='ready'));
  const key=await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const draft=new Y.Doc(),restored=new Y.Doc();
  try{
   draft.getText('legal').insert(0,'Sensitive negotiations');
   const encrypted=await sealPrivateYjsUpdate({
    key,context:{tenantId:fx.tenantId,workspaceId:fx.tenantId,
     documentId:fx.documentId,senderDeviceId:fx.deviceA,epoch:0},
    update:Y.encodeStateAsUpdate(draft),sequence:1,webCrypto:webcrypto
   });
   author.ws.send(JSON.stringify({kind:'update',frame:encrypted}));
   const ack=await until(()=>author.received.find(x=>x.kind==='ack'));
   assert.equal(ack.position,1);assert.equal(ack.replayed,false);
   const delivered=await until(()=>reader.received.find(x=>x.kind==='update'));
   assert.equal(delivered.position,1);
   const opened=await openPrivateYjsUpdate({
    key,context:{tenantId:fx.tenantId,workspaceId:fx.tenantId,
     documentId:fx.documentId,senderDeviceId:fx.deviceA,epoch:0},
    envelope:delivered.frame,webCrypto:webcrypto
   });
   Y.applyUpdate(restored,opened.update);
   assert.equal(restored.getText('legal').toString(),'Sensitive negotiations');
   assert.doesNotMatch(JSON.stringify(reader.received),/Sensitive negotiations/);
   author.ws.send(JSON.stringify({kind:'update',frame:encrypted}));
   await until(()=>author.received.filter(x=>x.kind==='ack').length===2);
   assert.equal(fx.getAppends(),1);
   author.ws.close();reader.ws.close();
   await until(()=>fx.hub.stats().rooms===0);
   const resumed=await fx.connect(b,fx.deviceB);
   await until(()=>resumed.received.find(x=>x.kind==='ready'));
   resumed.ws.send(JSON.stringify({kind:'pull',after:0,limit:5}));
   const history=await until(()=>resumed.received.find(x=>x.kind==='updates'));
   assert.equal(history.items.length,1);assert.equal(history.items[0].frame.ciphertext,encrypted.ciphertext);
   assert.equal(history.nextCursor,null);
  }finally{draft.destroy();restored.destroy();}
 }finally{await fx.close();}
});
test('unauthorized devices and hostile Origin cannot open a private socket',{timeout:15000},async()=>{
 const fx=await fixture();
 try{
  const forged=await fx.connect(a,randomUUID());
  assert.notEqual(forged.ws.readyState,WebSocket.OPEN);
  const stranger=await fx.connect(c,fx.deviceA);
  assert.notEqual(stranger.ws.readyState,WebSocket.OPEN);
  const wrong=await fx.connect(a,fx.deviceA,{originHeader:'https://evil.example'});
  assert.notEqual(wrong.ws.readyState,WebSocket.OPEN);
  assert.equal(fx.hub.stats().rooms,0);
 }finally{await fx.close();}
});
test('viewer cannot write, removed member cannot receive subsequent ciphertext',{timeout:15000},async()=>{
 const fx=await fixture();
 try{
  const author=await fx.connect(a,fx.deviceA),viewer=await fx.connect(b,fx.deviceB);
  await until(()=>author.received.find(x=>x.kind==='ready'));
  await until(()=>viewer.received.find(x=>x.kind==='ready'));
  viewer.ws.send(JSON.stringify({kind:'update',frame:wire(fx.deviceB)}));
  await until(()=>viewer.ws.readyState===WebSocket.CLOSING||viewer.ws.readyState===WebSocket.CLOSED);
  assert.equal(fx.getAppends(),0);
  const again=await fx.connect(b,fx.deviceB);
  await until(()=>again.received.find(x=>x.kind==='ready'));
  fx.identities.delete(b);
  author.ws.send(JSON.stringify({kind:'update',frame:wire(fx.deviceA)}));
  await until(()=>author.received.find(x=>x.kind==='ack'));
  await until(()=>again.ws.readyState===WebSocket.CLOSING||again.ws.readyState===WebSocket.CLOSED);
  assert.equal(again.received.filter(x=>x.kind==='update').length,0);
 }finally{await fx.close();}
});
test('stale epochs and malformed frames fail closed without plaintext fallback',{timeout:15000},async()=>{
 const fx=await fixture();
 try{
  const author=await fx.connect(a,fx.deviceA);
  await until(()=>author.received.find(x=>x.kind==='ready'));
  fx.rekey();
  author.ws.send(JSON.stringify({kind:'update',frame:wire(fx.deviceA,1,0)}));
  await until(()=>author.ws.readyState===WebSocket.CLOSING||author.ws.readyState===WebSocket.CLOSED);
  assert.equal(fx.getAppends(),0);
 }finally{await fx.close();}
});
test('private hub refuses to share a server with the public upgrade handler',async()=>{
 const fx=await fixture();
 try{
  assert.throws(()=>attachPrivateCollaborationHub({
   server:fx.server,origin:fx.origin,ledger:fx.ledger
  }),/Dedicated TLS server/);
 }finally{await fx.close();}
});
