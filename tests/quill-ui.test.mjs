import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

test('the built React interface mounts both brands, freezes public-input text and opens/closes the anchored tour',async()=>{
 const output=await build({entryPoints:['web/app.jsx'],bundle:true,write:false,outdir:'unused',platform:'browser',format:'iife',target:'es2022',define:{'process.env.NODE_ENV':'"production"'}});
 const script=output.outputFiles.find(x=>x.path.endsWith('.js')).text;
 const dom=new JSDOM('<html data-quill-product="civic"><body><div id="root"></div></body></html>',{url:'https://preview.example.test',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(window){window.structuredClone=value=>window.JSON.parse(window.JSON.stringify(value));window.TextEncoder=TextEncoder;window.HTMLElement.prototype.scrollIntoView=function(){};}});
 const waitFor=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('Expected UI state did not appear');};
 try{
  dom.window.eval(script);const document=dom.window.document;
  await waitFor(()=>document.querySelector('.ProseMirror'));
  assert.match(document.querySelector('.brand').textContent,/CivicQuill/);assert.match(document.querySelector('.ProseMirror').textContent,/SEC\. 1\./);
  const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
  button('Preview a fixed public-input edition').click();await waitFor(()=>document.querySelector('.ProseMirror').getAttribute('contenteditable')==='false');assert.equal(button('Bold').disabled,true);assert.match(document.querySelector('.edition').textContent,/Public-input/);
  button('CharterQuill').click();await waitFor(()=>document.querySelector('.brand').textContent.includes('CharterQuill'));await waitFor(()=>document.querySelector('.ProseMirror').getAttribute('contenteditable')==='true');assert.match(document.querySelector('h1').textContent,/Resolution/);
  button('Take a tour').click();await waitFor(()=>document.querySelector('.tour'));assert.match(document.querySelector('.tour').textContent,/STEP 1 OF 6/);assert(document.querySelector('.tour-target'));
  dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape'}));await waitFor(()=>!document.querySelector('.tour'));
 }finally{dom.window.close();}
});
