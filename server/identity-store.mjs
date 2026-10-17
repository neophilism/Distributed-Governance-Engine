import {randomBytes,randomUUID,createHmac,createHash,timingSafeEqual,createCipheriv,createDecipheriv} from 'node:crypto';
import {readFile} from 'node:fs/promises';

export class AccessError extends Error {
  constructor(code='ACCESS_DENIED') { super(code); this.name='AccessError'; this.code=code; }
}
const deny=condition=>{if(!condition)throw new AccessError();};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const token=()=>randomBytes(32).toString('base64url');
const isToken=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const role=value=>['owner','admin','editor','participant','viewer'].includes(value);
const date=value=>new Date(value).getTime();
export const identityMigration=()=>readFile(new URL('../migrations/001-identity.sql',import.meta.url),'utf8');
export async function applyIdentityMigrations(transaction) {
  const sql=await identityMigration(),checksum=createHash('sha256').update(sql).digest('hex');
  return transaction(async db=>{
    const exec=statement=>db.exec?db.exec(statement):db.query(statement);
    await db.query('SELECT pg_advisory_xact_lock(1245995845)');
    await exec('CREATE SCHEMA IF NOT EXISTS dge_identity; REVOKE ALL ON SCHEMA dge_identity FROM PUBLIC; CREATE TABLE IF NOT EXISTS dge_identity.migrations(version integer PRIMARY KEY,checksum char(64) NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
    const prior=(await db.query('SELECT checksum FROM dge_identity.migrations WHERE version=1')).rows[0];
    if(prior){if(prior.checksum!==checksum)throw Error('Identity migration checksum changed');return {applied:false};}
    await exec(sql);await db.query('INSERT INTO dge_identity.migrations(version,checksum) VALUES(1,$1)',[checksum]);
    return {applied:true};
  });
}

/** One pooled connection per transaction. Never share tenant context across requests. */
export function pgTransactions(pool) {
  return async callback=>{
    const db=await pool.connect();
    try {await db.query('BEGIN');const result=await callback(db);await db.query('COMMIT');return result;}
    catch(error){await db.query('ROLLBACK');throw error;}
    finally{db.release();}
  };
}

/** Trusted server service, not a browser module or an HTTP identity assertion API. */
export function createIdentityStore({transaction,sessionKey,stateKey,origin,clock=Date.now,sessionSeconds=28800}) {
  if(typeof transaction!=='function'||!Buffer.isBuffer(sessionKey)||sessionKey.length!==32||!Buffer.isBuffer(stateKey)||stateKey.length!==32||sessionKey.equals(stateKey))throw Error('Independent 32-byte identity keys required');
  const site=new URL(origin);
  if(site.protocol!=='https:'||site.origin!==origin)throw Error('An exact HTTPS origin is required');
  if(!Number.isSafeInteger(sessionSeconds)||sessionSeconds<60||sessionSeconds>86400)throw Error('Session duration must be 60–86400 seconds');
  // Copy configuration so a caller cannot mutate keys after initialization.
  sessionKey=Buffer.from(sessionKey);stateKey=Buffer.from(stateKey);
  const digest=(purpose,value)=>createHmac('sha256',sessionKey).update(purpose+'\0'+value).digest('hex');
  const now=()=>{const n=clock();if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid server clock');return new Date(n);};
  const checkWrite=credentials=>deny(credentials?.origin===origin&&isToken(credentials.csrfToken));
  async function session(db,credentials,write=false,recent=false) {
    deny(isToken(credentials?.sessionToken));
    if(write)checkWrite(credentials);
    const result=await db.query(`SELECT a.id,a.auth_epoch,s.csrf_digest,s.created_at FROM dge_identity.sessions s
      JOIN dge_identity.accounts a ON a.id=s.account_id WHERE s.token_digest=$1 AND s.revoked_at IS NULL
      AND s.expires_at>$2 AND a.status='active' AND s.auth_epoch=a.auth_epoch FOR SHARE OF a,s`,[digest('session',credentials.sessionToken),now()]);
    const row=result.rows[0];deny(row);
    if(write)deny(timingSafeEqual(Buffer.from(row.csrf_digest),Buffer.from(digest('csrf',credentials.csrfToken))));
    if(recent)deny(date(row.created_at)>now().getTime()-300000);
    return row;
  }
  const scope=(db,tenantId)=>{deny(uuid(tenantId));return db.query("SELECT set_config('dge.tenant_id',$1,true)",[tenantId]);};
  const event=(db,tenantId,actorId,subjectId,kind)=>db.query('INSERT INTO dge_identity.events(id,tenant_id,actor_id,subject_id,kind,occurred_at) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),tenantId,actorId,subjectId,kind,now()]);
  async function tenantContext(db,credentials,tenantId,write=false) {
    const actor=await session(db,credentials,write,write);
    await scope(db,tenantId);
    const tenant=await db.query(`SELECT id FROM dge_identity.tenants WHERE id=$1 FOR ${write?'UPDATE':'SHARE'}`,[tenantId]);
    deny(tenant.rows.length);
    const member=await db.query('SELECT role FROM dge_identity.memberships WHERE tenant_id=$1 AND account_id=$2 AND active=true',[tenantId,actor.id]);
    deny(member.rows.length);
    return {...actor,role:member.rows[0].role};
  }
  const manage=actor=>deny(['owner','admin'].includes(actor.role));
  return Object.freeze({
    // Call only with claims authenticated by the configured OIDC adapter. Never link by email.
    establishSession:({issuer,subject})=>transaction(async db=>{
      const uri=new URL(issuer);
      deny(uri.protocol==='https:'&&!uri.username&&!uri.password&&!uri.hash&&!uri.search&&issuer.length<=2048);
      deny(typeof subject==='string'&&subject.length>0&&subject.length<=255&&!subject.includes('\0'));
      const account=await db.query(`INSERT INTO dge_identity.accounts(id,issuer,subject,created_at) VALUES($1,$2,$3,$4)
        ON CONFLICT(issuer,subject) DO UPDATE SET subject=excluded.subject RETURNING id,status,auth_epoch`,[randomUUID(),issuer,subject,now()]);
      deny(account.rows[0].status==='active');
      const sessionToken=token(),csrfToken=token(),expiresAt=new Date(now().getTime()+sessionSeconds*1000);
      await db.query('INSERT INTO dge_identity.sessions(token_digest,account_id,auth_epoch,csrf_digest,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)',[digest('session',sessionToken),account.rows[0].id,account.rows[0].auth_epoch,digest('csrf',csrfToken),now(),expiresAt]);
      return {accountId:account.rows[0].id,sessionToken,csrfToken,expiresAt:expiresAt.toISOString()};
    }),
    account:sessionToken=>transaction(async db=>({accountId:(await session(db,{sessionToken})).id})),
    createTenant:credentials=>transaction(async db=>{
      const actor=await session(db,credentials,true,true),id=randomUUID();await scope(db,id);
      await db.query('INSERT INTO dge_identity.tenants(id,created_at) VALUES($1,$2)',[id,now()]);
      await db.query("INSERT INTO dge_identity.memberships(tenant_id,account_id,role,updated_at) VALUES($1,$2,'owner',$3)",[id,actor.id,now()]);
      await event(db,id,actor.id,actor.id,'tenant-created');return {tenantId:id};
    }),
    members:(credentials,tenantId,{after=null,limit=100}={})=>transaction(async db=>{
      deny((after===null||uuid(after))&&Number.isSafeInteger(limit)&&limit>=1&&limit<=200);
      await tenantContext(db,credentials,tenantId);
      const rows=(await db.query('SELECT account_id AS "accountId",role FROM dge_identity.memberships WHERE tenant_id=$1 AND active=true AND ($2::uuid IS NULL OR account_id>$2::uuid) ORDER BY account_id LIMIT $3',[tenantId,after,limit+1])).rows;
      return {items:rows.slice(0,limit),nextCursor:rows.length>limit?rows[limit-1].accountId:null};
    }),
    invite:(credentials,tenantId,accountId,requestedRole)=>transaction(async db=>{
      const actor=await tenantContext(db,credentials,tenantId,true);manage(actor);
      deny(uuid(accountId)&&role(requestedRole)&&requestedRole!=='owner');
      if(requestedRole==='admin')deny(actor.role==='owner');
      const target=await db.query("SELECT id FROM dge_identity.accounts WHERE id=$1 AND status='active'",[accountId]);deny(target.rows.length);
      const invitationToken=token();
      await db.query('INSERT INTO dge_identity.invitations(token_digest,tenant_id,account_id,role,expires_at) VALUES($1,$2,$3,$4,$5)',[digest('invite',invitationToken),tenantId,accountId,requestedRole,new Date(now().getTime()+86400000)]);
      await event(db,tenantId,actor.id,accountId,'invited');return {invitationToken};
    }),
    acceptInvitation:(credentials,tenantId,invitationToken)=>transaction(async db=>{
      const actor=await session(db,credentials,true,true);deny(isToken(invitationToken));await scope(db,tenantId);
      const tenant=await db.query('SELECT id FROM dge_identity.tenants WHERE id=$1 FOR UPDATE',[tenantId]);deny(tenant.rows.length);
      const invitation=await db.query(`UPDATE dge_identity.invitations SET consumed_at=$1 WHERE token_digest=$2 AND tenant_id=$3
        AND account_id=$4 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>$1 RETURNING role`,[now(),digest('invite',invitationToken),tenantId,actor.id]);deny(invitation.rows.length);
      const existing=await db.query('SELECT active FROM dge_identity.memberships WHERE tenant_id=$1 AND account_id=$2',[tenantId,actor.id]);deny(!existing.rows[0]?.active);
      await db.query(`INSERT INTO dge_identity.memberships(tenant_id,account_id,role,updated_at) VALUES($1,$2,$3,$4)
        ON CONFLICT(tenant_id,account_id) DO UPDATE SET active=true,role=excluded.role,updated_at=excluded.updated_at`,[tenantId,actor.id,invitation.rows[0].role,now()]);
      await event(db,tenantId,actor.id,actor.id,'joined');return {joined:true};
    }),
    changeMember:(credentials,tenantId,accountId,nextRole)=>transaction(async db=>{
      const actor=await tenantContext(db,credentials,tenantId,true);manage(actor);deny(uuid(accountId)&&(nextRole===null||role(nextRole)));
      const target=(await db.query('SELECT role FROM dge_identity.memberships WHERE tenant_id=$1 AND account_id=$2 AND active=true',[tenantId,accountId])).rows[0];deny(target);
      if(target.role==='owner'||target.role==='admin'||nextRole==='owner'||nextRole==='admin')deny(actor.role==='owner');
      if(target.role==='owner'&&nextRole!=='owner'){
        const count=await db.query("SELECT count(*)::int AS n FROM dge_identity.memberships WHERE tenant_id=$1 AND role='owner' AND active=true",[tenantId]);deny(count.rows[0].n>1);
      }
      await db.query('UPDATE dge_identity.memberships SET role=COALESCE($3,role),active=$4,updated_at=$5 WHERE tenant_id=$1 AND account_id=$2',[tenantId,accountId,nextRole,nextRole!==null,now()]);
      // A removed member cannot reuse an invitation issued before removal.
      if(nextRole===null)await db.query('UPDATE dge_identity.invitations SET revoked_at=$3 WHERE tenant_id=$1 AND account_id=$2 AND consumed_at IS NULL',[tenantId,accountId,now()]);
      await event(db,tenantId,actor.id,accountId,nextRole===null?'removed':'role-changed');return {changed:true};
    }),
    logout:credentials=>transaction(async db=>{
      await session(db,credentials,true);
      await db.query('UPDATE dge_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[digest('session',credentials.sessionToken),now()]);return {revoked:true};
    }),
    logoutAll:credentials=>transaction(async db=>{
      const actor=await session(db,credentials,true);
      await db.query('UPDATE dge_identity.accounts SET auth_epoch=auth_epoch+1 WHERE id=$1',[actor.id]);return {revoked:true};
    }),
    putLogin:(state,browserToken,secret)=>transaction(async db=>{
      deny(isToken(state)&&isToken(browserToken)&&typeof secret==='object');
      const stateDigest=digest('login-state',state),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',stateKey,iv);
      cipher.setAAD(Buffer.from('dge-login-v1:'+stateDigest));
      const encrypted=Buffer.concat([cipher.update(JSON.stringify(secret),'utf8'),cipher.final()]);
      deny(encrypted.length<8192);
      const sealed=Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
      await db.query('INSERT INTO dge_identity.login_challenges(state_digest,browser_digest,sealed_state,expires_at) VALUES($1,$2,$3,$4)',[stateDigest,digest('login-browser',browserToken),sealed,new Date(now().getTime()+600000)]);
    }),
    consumeLogin:(state,browserToken)=>transaction(async db=>{
      deny(isToken(state)&&isToken(browserToken));const stateDigest=digest('login-state',state);
      const result=await db.query('DELETE FROM dge_identity.login_challenges WHERE state_digest=$1 AND browser_digest=$2 AND expires_at>$3 RETURNING sealed_state',[stateDigest,digest('login-browser',browserToken),now()]);deny(result.rows.length);
      const bytes=Buffer.from(result.rows[0].sealed_state,'base64url'),decipher=createDecipheriv('aes-256-gcm',stateKey,bytes.subarray(0,12));
      decipher.setAAD(Buffer.from('dge-login-v1:'+stateDigest));decipher.setAuthTag(bytes.subarray(12,28));
      return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'));
    }),
    pruneExpiredLogins:()=>transaction(async db=>(await db.query('DELETE FROM dge_identity.login_challenges WHERE state_digest IN (SELECT state_digest FROM dge_identity.login_challenges WHERE expires_at<=$1 ORDER BY expires_at LIMIT 500) RETURNING state_digest',[now()])).rows.length)
  });
}

export function sessionCookie(sessionToken,{maxAge=28800}={}) {
  deny(isToken(sessionToken)&&Number.isSafeInteger(maxAge)&&maxAge>=0&&maxAge<=86400);
  return `__Host-dge_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
