import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import * as Y from 'yjs';
import {createLegalDocument} from '../src/legal-structure.mjs';
import {createPublicSharedDraft} from '../editor/shared-legal-draft.mjs';
import {mountPublicRealtimeEditor} from '../editor/realtime-editor.mjs';

const tenant='123e4567-e89b-42d3-a456-426614174000';
const docId='223e4567-e89b-42d3-a456-426614174000';
const base=()=>{const d=structuredClone(createLegalDocument({id:docId,tenantId:tenant,title:'Public collaboration'}));d.content[0].inlines=[{kind:'text',text:'Seed'}];return d;};
const frame=(kind,update)=>{const bytes=new Uint8Array(update.length+1);bytes[0]=kind;bytes.set(update,1);return bytes;};
class FakeSocket {
 static sessions=[];
 constructor(url,protocol) {
  this.url=url;this.protocol=protocol;this.readyState=0;this.listeners=new Map();this.sent=[];
  FakeSocket.sessions.push(this);
  queueMicrotask(()=>{
   if(this.readyState!==0)return;
   this.readyState=1;
   this.fire('message',{data:frame(1,FakeSocket.snapshot)});
  });
 }
 addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(fn);}
 removeEventListener(name,fn){this.listeners.get(name)?.delete(fn);}
 fire(name,event){for(const fn of this.listeners.get(name)??[])fn(event);}
 send(data){this.sent.push(new Uint8Array(data));}
 close(){this.readyState=3;this.fire('close',{});}
}
function setupDom() {
 const dom=new JSDOM('<div id="editor"></div>',{url:'https://example.test/'});
 const names=['window','document','Node','HTMLElement','MutationObserver','navigator','getComputedStyle'];
 const previous=new Map(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 for(const name of names)Object.defineProperty(globalThis,name,{value:name==='getComputedStyle'?
  dom.window.getComputedStyle.bind(dom.window):dom.window[name],configurable:true,writable:true});
 return {host:dom.window.document.getElementById('editor'),close(){
  for(const [name,descriptor] of previous) {
   if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];
  }
  dom.window.close();
 }};
}
test('live editor mounts shared ProseMirror document and sends bounded Yjs deltas over WSS',{timeout:10000},async()=>{
 const dom=setupDom();
 const seed=createPublicSharedDraft({document:base(),classification:'public'});
 FakeSocket.snapshot=seed.encodeState();
 let editor;
 try {
  const updates=[],states=[];
  editor=await mountPublicRealtimeEditor(dom.host,base(),{classification:'public',origin:'https://example.test',
   WebSocketCtor:FakeSocket,onChange:doc=>updates.push(doc),onStatus:s=>states.push(s)});
  assert.match(editor.view.dom.textContent,/Seed/);
  assert.equal(FakeSocket.sessions.at(-1).url,'wss://example.test/ws/public/'+tenant+'/'+docId);
  editor.view.dispatch(editor.view.state.tr.insertText('Local ',1));
  await new Promise(resolve=>setTimeout(resolve,0));
  const sent=FakeSocket.sessions.at(-1).sent.filter(message=>message[0]===2);
  assert.ok(sent.length,'an accepted local ProseMirror update is transmitted');
  assert.match(editor.getDocument().content[0].inlines[0].text,/Local/);
  assert.ok(updates.length>0);
  assert.match(states.at(-1),/connected/);
 }finally{editor?.destroy();seed.close();dom.close();}
});
test('readonly, private and lost-connection editing fail closed',{timeout:10000},async()=>{
 const dom=setupDom(),seed=createPublicSharedDraft({document:base(),classification:'public'});
 FakeSocket.snapshot=seed.encodeState();
 let editor;
 try {
  await assert.rejects(mountPublicRealtimeEditor(dom.host,base(),{classification:'private',
   origin:'https://example.test',WebSocketCtor:FakeSocket}),/public collaboration/);
  editor=await mountPublicRealtimeEditor(dom.host,base(),{classification:'public',
   origin:'https://example.test',WebSocketCtor:FakeSocket,readOnly:true});
  assert.equal(editor.command(()=>true),false);
  const socket=FakeSocket.sessions.at(-1);
  assert.equal(socket.sent.length,0);
  socket.close();
  assert.equal(editor.command(()=>true),false);
 }finally{editor?.destroy();seed.close();dom.close();}
});
