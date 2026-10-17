import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createIdentityStore,pgTransactions,applyIdentityMigrations,AccessError} from '../server/identity-store.mjs';

// Intentionally limited to a disposable loopback test database. Never accepts a production URL.
const url=new URL(process.env.DGE_TEST_DATABASE_URL??'');
if(!['127.0.0.1','localhost'].includes(url.hostname)||!/^\/[a-z0-9_]+_test$/.test(url.pathname))throw Error('Disposable loopback database ending in _test required');
const owner=new pg.Pool({connectionString:url.href,max:1});
let runtime;
after(async()=>{await runtime?.end();await owner.end();});
test('PostgreSQL enforces row permissions and serializes competing membership and invitation writes',async t=>{
  assert.deepEqual(await applyIdentityMigrations(pgTransactions(owner)),{applied:true});
  assert.deepEqual(await applyIdentityMigrations(pgTransactions(owner)),{applied:false});
  const login='dge_test_'+randomBytes(8).toString('hex'),password=randomBytes(32).toString('hex');
  await owner.query(`CREATE ROLE ${login} LOGIN PASSWORD '${password}' IN ROLE dge_identity_runtime`);
  const runtimeUrl=new URL(url);runtimeUrl.username=login;runtimeUrl.password=password;
  runtime=new pg.Pool({connectionString:runtimeUrl.href,max:4});
  const flags=(await runtime.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  assert.deepEqual(flags,{rolsuper:false,rolbypassrls:false});
  const store=createIdentityStore({transaction:pgTransactions(runtime),sessionKey:randomBytes(32),stateKey:randomBytes(32),origin:'https://quill.example'});
  const user=async()=>({...await store.establishSession({issuer:'https://test-provider.example',subject:randomUUID()}),origin:'https://quill.example'});
  const a=await user(),b=await user(),c=await user(),{tenantId}=await store.createTenant(a);
  const invitation=await store.invite(a,tenantId,b.accountId,'editor');
  await t.test('a one-use invitation has only one successful concurrent acceptance',async()=>{
    const results=await Promise.allSettled([store.acceptInvitation(b,tenantId,invitation.invitationToken),store.acceptInvitation(b,tenantId,invitation.invitationToken)]);
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.ok(results.find(x=>x.status==='rejected').reason instanceof AccessError);
  });
  await store.changeMember(a,tenantId,b.accountId,'owner');
  await t.test('two owners cannot concurrently remove the final owner',async()=>{
    const results=await Promise.allSettled([store.changeMember(a,tenantId,a.accountId,null),store.changeMember(b,tenantId,b.accountId,null)]);
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
    const remaining=results[0].status==='fulfilled'?b:a;
    const members=await store.members(remaining,tenantId);assert.equal(members.items.filter(x=>x.role==='owner').length,1);
    await assert.rejects(store.members(c,tenantId),AccessError);
    const removed=remaining===a?b:a;await assert.rejects(store.members(removed,tenantId),AccessError);
  });
  await t.test('row security denies an unscoped pooled connection and session revocation survives reuse',async()=>{
    assert.equal((await runtime.query('SELECT id FROM dge_identity.tenants')).rows.length,0);
    await assert.rejects(runtime.query('DELETE FROM dge_identity.events'),/permission denied/);
    const fresh=await user();await store.logoutAll(fresh);await assert.rejects(store.account(fresh.sessionToken),AccessError);
  });
});
