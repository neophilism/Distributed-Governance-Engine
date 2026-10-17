import {digest,invariant} from './integrity.mjs';
import {revisionDigest} from './documents.mjs';
import {validateLegalDocument} from './legal-structure.mjs';
export * from './legal-structure.mjs';

export function legalDocumentDigest(document) {const value=validateLegalDocument(document);return digest('legal-document-v'+value.schemaVersion,value);}
export function migrateLegalDocumentV1(document) {
 const source=validateLegalDocument(document);invariant(source.schemaVersion===1,'Only legal schema v1 can use this migration');
 return validateLegalDocument({...structuredClone(source),schemaVersion:2,schemaMigration:{fromVersion:1,toVersion:2,sourceDigest:legalDocumentDigest(source)}});
}

export function migrateLegacyRevision(legacy,{title,locale='en-US'}) {
 const sourceDigest=revisionDigest(legacy);
 invariant(!Object.hasOwn(legacy,'lifecycle')||legacy.lifecycle==='draft','Signed or published legacy data needs a dedicated migration');
 return validateLegalDocument({schemaVersion:2,id:legacy.id,tenantId:legacy.tenantId,mode:legacy.mode,lifecycle:'draft',revision:legacy.revision,metadata:{title,locale,numberingProfile:'us-federal-v1'},content:legacy.blocks.map(b=>({kind:'paragraph',id:b.id,inlines:[{kind:'text',text:b.text}]})),provenance:{fromSchema:'foundation-blocks-v0',sourceDigest}});
}
