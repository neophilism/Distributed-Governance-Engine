import {build} from 'esbuild';import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await build({entryPoints:['web/app.jsx'],bundle:true,format:'esm',platform:'browser',target:['es2022'],outdir:'dist',entryNames:'app',minify:true,legalComments:'eof',sourcemap:true});
await copyFile('web/index.html','dist/index.html');
console.log('Built shared Quill editor preview. No deployed-service claim.');
