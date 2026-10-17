import * as oidc from 'openid-client';
import {randomBytes} from 'node:crypto';
import {AccessError,sessionCookie} from './identity-store.mjs';

/** Configuration comes only from server deployment, never callback/query input. */
export async function discoverIdentityProvider({issuer,clientId,clientSecret}) {
  const url=new URL(issuer);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('HTTPS OIDC issuer required');
  if(typeof clientId!=='string'||!clientId||typeof clientSecret!=='string'||!clientSecret)throw Error('OIDC server credentials required');
  return oidc.discovery(url,clientId,clientSecret,undefined,{execute:[oidc.enableNonRepudiationChecks]});
}
export function createOIDCLogin({store,configuration,redirectUri}) {
  oidc.enableNonRepudiationChecks(configuration);
  const redirect=new URL(redirectUri),issuer=configuration.serverMetadata().issuer;
  if(redirect.protocol!=='https:'||redirect.username||redirect.password||redirect.search||redirect.hash)throw Error('Exact HTTPS OIDC callback required');
  return Object.freeze({
    async start() {
      const state=randomBytes(32).toString('base64url'),browserToken=randomBytes(32).toString('base64url');
      const verifier=oidc.randomPKCECodeVerifier(),nonce=oidc.randomNonce();
      await store.putLogin(state,browserToken,{verifier,nonce,issuer,redirectUri});
      const url=oidc.buildAuthorizationUrl(configuration,{redirect_uri:redirectUri,scope:'openid',response_type:'code',state,nonce,code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256',max_age:'300'});
      return {authorizationUrl:url.href,cookie:`__Host-dge_login=${browserToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`};
    },
    async complete(callbackUri,browserToken) {
      const callback=new URL(callbackUri);
      if(callback.origin!==redirect.origin||callback.pathname!==redirect.pathname||callback.username||callback.password||callback.hash||callback.searchParams.getAll('state').length!==1)throw new AccessError();
      const state=callback.searchParams.get('state');
      const pending=await store.consumeLogin(state,browserToken);
      if(pending.issuer!==issuer||pending.redirectUri!==redirectUri)throw new AccessError();
      const tokens=await oidc.authorizationCodeGrant(configuration,callback,{pkceCodeVerifier:pending.verifier,expectedState:state,expectedNonce:pending.nonce,idTokenExpected:true,maxAge:300});
      const claims=tokens.claims();
      if(!claims||claims.iss!==issuer||typeof claims.sub!=='string')throw new AccessError();
      const session=await store.establishSession({issuer,subject:claims.sub});
      return {...session,cookie:sessionCookie(session.sessionToken),clearLoginCookie:'__Host-dge_login=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'};
    }
  });
}
