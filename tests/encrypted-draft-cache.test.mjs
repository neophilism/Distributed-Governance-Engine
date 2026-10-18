import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createLegalDocument,publicInputEdition} from '../src/legal-structure.mjs';
import {generateEphemeralCacheKey,encryptLocalDraftBytes,decryptLocalDraftBytes} from '../src/private-crypto.mjs';
import {createEncryptedDraftCache} from '../editor/encrypted-draft-cache.mjs';

const memory=()=>{const map=new Map();return {map,getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
const options=key=>({key,tenantId:'tenant',workspaceId:'workspace',documentId:'doc',epoch:7,webCrypto:webcrypto});
const doc=()=>createLegalDocument({id:'doc',tenantId:'tenant',title:'Confidential draft'});

test('confidential recovery stores only ciphertext and authenticates exact content',async()=>{
 const key=await generateEphemeralCacheKey(webcrypto);
 assert.equal(key.extractable,false);
 const storage=memory(),cache=createEncryptedDraftCache(storage,options(key));
 const document=doc();
 assert.equal((await cache.save(document)).state,'saved');
 const serialized=[...storage.map.values()][0];
 assert.doesNotMatch(serialized,/Confidential draft|schemaVersion|content|paragraph/);
 assert.deepEqual((await cache.load()).document,document);
 assert.equal((await cache.load({minimumRevision:2})).state,'stale');
 assert.equal(cache.clear().state,'cleared');
 assert.equal((await cache.load()).state,'empty');
});
test('tampering, wrong key, tenant, document, workspace or membership epoch cannot decrypt',async()=>{
 const key=await generateEphemeralCacheKey(webcrypto),other=await generateEphemeralCacheKey(webcrypto);
 const storage=memory(),cache=createEncryptedDraftCache(storage,options(key));await cache.save(doc());
 assert.equal((await createEncryptedDraftCache(storage,options(other)).load()).state,'corrupt');
 const recordKey=[...storage.map.keys()][0],record=JSON.parse(storage.getItem(recordKey));
 const changed={...record,ciphertext:(record.ciphertext[0]==='A'?'B':'A')+record.ciphertext.slice(1)};
 storage.setItem(recordKey,JSON.stringify(changed));
 assert.equal((await cache.load()).state,'corrupt');
 storage.setItem(recordKey,JSON.stringify(record));
 const bytes=new TextEncoder().encode('private text'),scope={tenantId:'tenant',workspaceId:'workspace',documentId:'doc',epoch:7};
 const envelope=await encryptLocalDraftBytes(key,bytes,scope,webcrypto);
 assert.deepEqual(await decryptLocalDraftBytes(key,envelope,scope,webcrypto),bytes);
 for(const altered of [{...scope,tenantId:'other'},{...scope,documentId:'other'},
  {...scope,workspaceId:'other'},{...scope,epoch:8}])
  await assert.rejects(decryptLocalDraftBytes(key,envelope,altered,webcrypto),/authentication/);
 await assert.rejects(decryptLocalDraftBytes(other,envelope,scope,webcrypto),/authentication/);
});
test('immutable editions, wrong document, oversized drafts and unavailable storage fail closed',async()=>{
 const key=await generateEphemeralCacheKey(webcrypto),storage=memory(),cache=createEncryptedDraftCache(storage,options(key));
 assert.throws(()=>createEncryptedDraftCache(storage,{...options(key),epoch:-1}));
 await assert.rejects(Promise.resolve().then(()=>cache.save(publicInputEdition(doc()))),/mutability/);
 await assert.rejects(Promise.resolve().then(()=>cache.save({...doc(),id:'other'})),/mutability/);
 const wrong=structuredClone(doc());wrong.content[0].inlines[0].text='a'.repeat(3000001);
 await assert.rejects(Promise.resolve().then(()=>cache.save(wrong)));
 storage.setItem=()=>{throw Error('quota');};
 assert.equal((await cache.save(doc())).state,'failed');
 storage.getItem=()=>{throw Error('offline');};
 assert.equal((await cache.load()).state,'failed');
});
test('non-extractable key required and malformed envelopes fail closed',async()=>{
 const key=await generateEphemeralCacheKey(webcrypto);
 const scope={tenantId:'t',workspaceId:'w',documentId:'d',epoch:0};
 const bytes=new TextEncoder().encode('hello');
 await assert.rejects(encryptLocalDraftBytes({},bytes,scope,webcrypto),/non-extractable/);
 const sealed=await encryptLocalDraftBytes(key,bytes,scope,webcrypto);
 for(const envelope of [{...sealed,version:2},{...sealed,nonce:'a'},
  {...sealed,extra:'plaintext'},{...sealed,ciphertext:'AAAA!'}])
  await assert.rejects(decryptLocalDraftBytes(key,envelope,scope,webcrypto));
 const storage=memory(),cache=createEncryptedDraftCache(storage,options(key));
 await assert.rejects(cache.load({minimumRevision:-1}),/revision/);
});
