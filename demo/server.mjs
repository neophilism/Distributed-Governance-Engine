import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const routes=new Map([['/',['index.html','text/html; charset=utf-8']],['/app.js',['app.js','text/javascript; charset=utf-8']],['/style.css',['style.css','text/css; charset=utf-8']]]);
export function createDemoServer() {
 return createServer(async(req,res)=>{
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{'allow':'GET, HEAD'});return res.end();}
  const route=routes.get(req.url);
  if(!route){res.writeHead(404);return res.end('Not found');}
  try {
   const bytes=await readFile(new URL(route[0],import.meta.url));
   res.writeHead(200,{'content-type':route[1],'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"});
   res.end(req.method==='HEAD'?undefined:bytes);
  }catch{res.writeHead(500);res.end('Demonstration asset unavailable');}
 });
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 const server=createDemoServer();server.listen(4173,'127.0.0.1',()=>console.log('Local design demonstration: http://127.0.0.1:4173 — sample data only; no persistence or external actions.'));
}
