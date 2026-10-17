import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoServer} from '../demo/server.mjs';
test('loopback demonstrator serves only intended assets and never mutates server state',async t=>{
 const server=createDemoServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port;
 const page=await fetch(base);assert.equal(page.status,200);assert.match(await page.text(),/SAMPLE DATA/);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 for(const path of ['/app.js','/style.css'])assert.equal((await fetch(base+path)).status,200);
 assert.equal((await fetch(base+'/../package.json')).status,404);assert.equal((await fetch(base,{method:'POST',body:'x'})).status,405);
});
