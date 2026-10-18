import {createHash} from 'node:crypto';
import {PrivateDocumentError} from './private-document-store.mjs';

/**
 * Durable encrypted Yjs frame ledger.
 * The server never parses/decrypts a Yjs payload and cannot authorize itself:
 * a separately reviewed device/MLS authorizer is required for EVERY read/write.
 */
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const MAX_UPDATE_BYTES=32784;
const WRITERS=['owner','admin','editor'];
function demand(value,code,status=400){
 if(!value)throw new PrivateDocumentError(code,status);
}
function strictRecord(value,required) {
 demand(value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.getPrototypeOf(value)===Object.prototype&&
  Object.getOwnPropertySymbols(value).length===0&&
  Object.keys(value).sort().join(',')===required.slice().sort().join(',')&&
  Object.keys(value).every(key=>{
   const descriptor=Object.getOwnPropertyDescriptor(value,key);
   return descriptor?.enumerable===true&&Object.hasOwn(descriptor,'value');
  }),'INVALID_PRIVATE_FRAME');
}
function bytes(value,minimum,maximum){
 demand(typeof value==='string'&&value.length>=1&&
  value.length<=Math.ceil(maximum*4/3)+8&&
  /^[A-Za-z0-9_-]+$/.test(value),'INVALID_PRIVATE_FRAME');
 const buffer=Buffer.from(value,'base64url');
 demand(buffer.length>=minimum&&buffer.length<=maximum&&
  buffer.toString('base64url')===value,'INVALID_PRIVATE_FRAME');
 return buffer;
}
function source(frame){
 strictRecord(frame,['version','cipher','epoch','senderDeviceId','sequence','nonce','ciphertext']);
 demand(frame.version===1&&frame.cipher==='AES-256-GCM'&&
  Number.isSafeInteger(frame.epoch)&&frame.epoch>=0&&frame.epoch<=1000000&&
  UUID.test(frame.senderDeviceId)&&Number.isSafeInteger(frame.sequence)&&
  frame.sequence>=1&&frame.sequence<=4294967295,'INVALID_PRIVATE_FRAME');
 return {epoch:frame.epoch,senderDeviceId:frame.senderDeviceId,sequence:frame.sequence,
  nonce:bytes(frame.nonce,12,12),ciphertext:bytes(frame.ciphertext,17,MAX_UPDATE_BYTES)};
}
const canonical=(frame)=>[
 frame.epoch,frame.senderDeviceId,frame.sequence,
 frame.nonce.toString('base64url'),frame.ciphertext.toString('base64url')
];
function digest(tenantId,documentId,position,frame){
 return createHash('sha256').update('dge-encrypted-yjs-frame-v1\0')
  .update(JSON.stringify([tenantId,documentId,position,...canonical(frame)]))
  .digest('hex');
}
function result(row,tenantId,documentId){
 const frame={epoch:row.epoch,senderDeviceId:row.sender_device_id,
  sequence:Number(row.sender_sequence),nonce:Buffer.from(row.nonce),
  ciphertext:Buffer.from(row.ciphertext)};
 demand(row.digest===digest(tenantId,documentId,Number(row.position),frame),
  'PRIVATE_FRAME_INTEGRITY_ERROR',503);
 return Object.freeze({
  position:Number(row.position),version:1,cipher:'AES-256-GCM',
  epoch:frame.epoch,senderDeviceId:frame.senderDeviceId,sequence:frame.sequence,
  nonce:frame.nonce.toString('base64url'),ciphertext:frame.ciphertext.toString('base64url')
 });
}
/**
 * Per-session key authority is not inferred from a claimed device ID. Production
 * must inject a verified device authorization function linked to session, member
 * and cryptographic epoch, or the store cannot be constructed.
 */
export function createPrivateUpdateLedger({
 identity,authorizeDevice,clock=Date.now,maxUpdatesPerDocument=100000,
 maxStoredBytes=30000000
}={}) {
 if(typeof identity?.withTenant!=='function'||typeof authorizeDevice!=='function')
  throw Error('Private frame ledger requires verified device authority');
 if(!Number.isSafeInteger(maxUpdatesPerDocument)||maxUpdatesPerDocument<1||maxUpdatesPerDocument>1000000||
    !Number.isSafeInteger(maxStoredBytes)||maxStoredBytes<1||maxStoredBytes>1000000000)
  throw Error('Invalid private frame ledger bounds');
 const at=()=>{const n=clock();demand(Number.isSafeInteger(n)&&n>=0,'INVALID_CLOCK');return new Date(n);};
 async function verify(db,actor,credentials,tenantId,documentId,keyEpoch,deviceId,operation){
  const authorized=await authorizeDevice({db,actor,credentials,tenantId,documentId,
   keyEpoch,senderDeviceId:deviceId,operation});
  demand(authorized===true,'PRIVATE_DEVICE_NOT_AUTHORIZED',403);
 }
 const context=(credentials,tenantId,write,fn)=>{
  demand(UUID.test(tenantId),'INVALID_WORKSPACE');
  return identity.withTenant(credentials,tenantId,{write,roles:write?WRITERS:undefined},fn);
 };
 const document=(db,tenantId,documentId,write)=>db.query(
  'SELECT version,key_epoch FROM dge_private.documents WHERE tenant_id=$1 AND id=$2'+
  (write?' FOR UPDATE':''),[tenantId,documentId]);
 return Object.freeze({
  async append(credentials,tenantId,documentId,envelope){
   demand(UUID.test(documentId),'INVALID_DOCUMENT_ID');
   const frame=source(envelope);
   return context(credentials,tenantId,true,async(db,actor)=>{
    const row=(await document(db,tenantId,documentId,true)).rows[0];
    demand(row,'PRIVATE_DOCUMENT_NOT_FOUND',404);
    demand(frame.epoch===row.key_epoch,'PRIVATE_EPOCH_CHANGED',409);
    await verify(db,actor,credentials,tenantId,documentId,frame.epoch,frame.senderDeviceId,'append');
    const replay=(await db.query(
     'SELECT * FROM dge_private.update_frames WHERE tenant_id=$1 AND document_id=$2 AND epoch=$3 AND sender_device_id=$4 AND sender_sequence=$5',
     [tenantId,documentId,frame.epoch,frame.senderDeviceId,frame.sequence]
    )).rows[0];
    if(replay){
     const prior=result(replay,tenantId,documentId);
     demand(prior.nonce===frame.nonce.toString('base64url')&&
      prior.ciphertext===frame.ciphertext.toString('base64url'),'PRIVATE_SEQUENCE_REUSED',409);
     return {frame:prior,replayed:true};
    }
    const max=(await db.query(
     'SELECT COALESCE(max(position),0)::text AS n FROM dge_private.update_frames WHERE tenant_id=$1 AND document_id=$2',
     [tenantId,documentId]
    )).rows[0].n;
    const position=Number(max)+1;
    demand(Number.isSafeInteger(position)&&position<=maxUpdatesPerDocument,'PRIVATE_UPDATE_LIMIT_REACHED',429);
    const bytesUsed=frame.nonce.length+frame.ciphertext.length;
    await db.query('INSERT INTO dge_private.usage(tenant_id,stored_bytes) VALUES($1,0) ON CONFLICT DO NOTHING',[tenantId]);
    demand((await db.query(
     'UPDATE dge_private.usage SET stored_bytes=stored_bytes+$2 WHERE tenant_id=$1 AND stored_bytes+$2<=$3 RETURNING stored_bytes',
     [tenantId,bytesUsed,maxStoredBytes]
    )).rows.length===1,'PRIVATE_STORAGE_LIMIT_REACHED',429);
    const signature=digest(tenantId,documentId,position,frame);
    await db.query(
     'INSERT INTO dge_private.update_frames(tenant_id,document_id,position,epoch,sender_device_id,sender_sequence,nonce,ciphertext,digest,actor_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
     [tenantId,documentId,position,frame.epoch,frame.senderDeviceId,frame.sequence,
      frame.nonce,frame.ciphertext,signature,actor.accountId,at()]
    );
    return {frame:result({position,epoch:frame.epoch,sender_device_id:frame.senderDeviceId,
     sender_sequence:frame.sequence,nonce:frame.nonce,ciphertext:frame.ciphertext,digest:signature},
    tenantId,documentId),replayed:false};
   });
  },
  async list(credentials,tenantId,documentId,{recipientDeviceId,after=0,limit=50}={}){
   demand(UUID.test(documentId),'INVALID_DOCUMENT_ID');
   demand(UUID.test(recipientDeviceId)&&Number.isSafeInteger(after)&&after>=0&&
    after<=1000000&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100,
    'INVALID_PRIVATE_FRAME_PAGE');
   return context(credentials,tenantId,false,async(db,actor)=>{
    const row=(await document(db,tenantId,documentId,false)).rows[0];
    demand(row,'PRIVATE_DOCUMENT_NOT_FOUND',404);
    await verify(db,actor,credentials,tenantId,documentId,row.key_epoch,recipientDeviceId,'list');
    // Only current-epoch frames are disclosed to newly authorized devices.
    // Group snapshot/old-epoch history access is governed by a separate MLS policy.
    const found=(await db.query(
     'SELECT * FROM dge_private.update_frames WHERE tenant_id=$1 AND document_id=$2 AND epoch=$3 AND position>$4 ORDER BY position LIMIT $5',
     [tenantId,documentId,row.key_epoch,after,limit+1]
    )).rows;
    const items=found.slice(0,limit).map(item=>result(item,tenantId,documentId));
    return {documentId,keyEpoch:row.key_epoch,items,
     nextCursor:found.length>limit?items.at(-1).position:null};
   });
  }
 });
}
