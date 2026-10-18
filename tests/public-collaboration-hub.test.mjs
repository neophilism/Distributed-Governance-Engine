import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:https';
import {randomUUID} from 'node:crypto';
import {WebSocket} from 'ws';
import * as Y from 'yjs';
import {createLegalDocument} from '../src/legal-structure.mjs';
import {createPublicSharedDraft} from '../editor/shared-legal-draft.mjs';
import {attachPublicCollaborationHub} from '../server/public-collaboration-hub.mjs';

const sessionA='A'.repeat(43),sessionB='B'.repeat(43),sessionC='D'.repeat(43);
const csrf='C'.repeat(43);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,ms=5000) {
 const stop=Date.now()+ms;
 while(Date.now()<stop){const v=fn();if(v)return v;await sleep(15);}
 throw Error('Timed out waiting for collaboration state');
}
function firstText(ydoc) {
 function scan(node){
  if(node instanceof Y.XmlText)return node;
  for(const child of node.toArray?.()??[]) {const text=scan(child);if(text)return text;}
  return null;
 }
 return scan(ydoc.getXmlFragment('prosemirror'));
}
async function fixture() {
 const temp=mkdtempSync(join(tmpdir(),'dge-wss-test-'));
 try {
  const result=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes',
    '-keyout',join(temp,'key.pem'),'-out',join(temp,'cert.pem'),
    '-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1',
    '-days','1'],{stdio:'ignore'});
  if(result.status!==0)throw Error('TLS test setup failed');
  const server=createServer({key:readFileSync(join(temp,'key.pem')),
   cert:readFileSync(join(temp,'cert.pem')),minVersion:'TLSv1.3'},
   (req,res)=>{res.statusCode=404;res.end();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='https://127.0.0.1:'+server.address().port;
  const tenantId=randomUUID(),documentId=randomUUID();
  let document=structuredClone(createLegalDocument({id:documentId,tenantId,title:'Public project'}));
  document.content[0].inlines=[{kind:'text',text:'Seed'}];
  let version=1,saveCount=0,visibility='public';
  const roles=new Map([[sessionA,'editor'],[sessionB,'viewer'],[sessionC,'editor']]);
  const check=(credentials,write=false)=>{
   if(credentials.origin!==origin||credentials.csrfToken!==csrf||!roles.has(credentials.sessionToken))throw Error('ACCESS_DENIED');
   if(write&&!['editor','admin','owner'].includes(roles.get(credentials.sessionToken)))throw Error('ACCESS_DENIED');
   return roles.get(credentials.sessionToken);
  };
  const documents={
   async read(credentials,tenant,doc) {
    const role=check(credentials);
    if(tenant!==tenantId||doc!==documentId)throw Error('WRONG_DOCUMENT');
    return {document:structuredClone(document),viewerRole:role,version,visibility};
   },
   async save(credentials,tenant,doc,command) {
    check(credentials,true);
    if(tenant!==tenantId||doc!==documentId||version!==command.expectedVersion)throw Error('VERSION_CONFLICT');
    if(command.document.revision!==document.revision+1)throw Error('REVISION_NOT_INCREASED');
    if(command.document.mode!=='collaboration'||command.document.lifecycle!=='draft')throw Error('SOURCE_FROZEN');
    document=structuredClone(command.document);version++;saveCount++;
    return {document:structuredClone(document),version,visibility};
   }
  };
  const hub=attachPublicCollaborationHub({server,origin,documents,maxRooms:2});
  const sockets=[];
  async function connect(token,{originHeader=origin}={}) {
   const ws=new WebSocket('wss://127.0.0.1:'+server.address().port+'/ws/public/'+tenantId+'/'+documentId,
    ['dge-public-v1'],{rejectUnauthorized:false,headers:{
     Origin:originHeader,Cookie:'__Host-dge_session='+token+'; __Host-dge_csrf='+csrf
    }});
   sockets.push(ws);
   const frames=[];
   ws.on('message',(message,isBinary)=>{if(isBinary)frames.push(new Uint8Array(message));});
   ws.on('error',()=>{});
   await until(()=>ws.readyState===WebSocket.OPEN||ws.readyState===WebSocket.CLOSED);
   return {ws,frames};
  }
  return {
   connect,tenantId,documentId,roles,hub,
   freeze:()=>{visibility='private';},
   getSaveCount:()=>saveCount,
   getDocument:()=>document,
   close:async()=>{
    hub.close();for(const ws of sockets)ws.terminate();
    await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
   }
  };
 }finally{rmSync(temp,{recursive:true,force:true});}
}

test('public TLS WebSocket room commits one authorized Yjs edit and broadcasts to a read-only viewer',{timeout:15000},async()=>{
 const fx=await fixture();
 try {
  const author=await fx.connect(sessionA),viewer=await fx.connect(sessionB);
  const a=await until(()=>author.frames.find(frame=>frame[0]===1));
  const b=await until(()=>viewer.frames.find(frame=>frame[0]===1));
  assert.equal(fx.hub.stats().connections,2);
  const writer=createPublicSharedDraft({document:fx.getDocument(),classification:'public',initialState:a.slice(1),
   onLocalUpdate:update=>author.ws.send(Buffer.concat([Buffer.from([2]),Buffer.from(update)]))});
  writer.mutateLocal(y=>firstText(y).insert(0,'Added '));
  await until(()=>fx.getSaveCount()===1);
  const relayed=await until(()=>viewer.frames.find(frame=>frame[0]===2));
  const replica=createPublicSharedDraft({document:fx.getDocument(),classification:'public',initialState:b.slice(1)});
  replica.receive(relayed.slice(1));
  assert.match(replica.snapshot().content[0].inlines[0].text,/Added/);
  assert.equal(fx.getDocument().revision,1);
  writer.close();replica.close();
 }finally{await fx.close();}
});
test('writer demotion and unrelated origin block collaboration messages and upgrades',{timeout:15000},async()=>{
 const fx=await fixture();
 try {
  const author=await fx.connect(sessionA);
  await until(()=>author.frames.find(frame=>frame[0]===1));
  fx.roles.set(sessionA,'viewer');
  author.ws.send(Buffer.from([2,1,1]),{binary:true});
  await until(()=>author.ws.readyState===WebSocket.CLOSING||author.ws.readyState===WebSocket.CLOSED);
  assert.equal(fx.getSaveCount(),0);
  const foreign=await fx.connect(sessionC,{originHeader:'https://attacker.example'});
  assert.notEqual(foreign.ws.readyState,WebSocket.OPEN);
  assert.equal(fx.getSaveCount(),0);
 }finally{await fx.close();}
});
test('private source is not admitted to public collaboration and no fallback relay exists',{timeout:15000},async()=>{
 const fx=await fixture();
 try {
  fx.freeze();
  const client=await fx.connect(sessionA);
  assert.notEqual(client.ws.readyState,WebSocket.OPEN);
  assert.equal(fx.hub.stats().rooms,0);
 }finally{await fx.close();}
});
