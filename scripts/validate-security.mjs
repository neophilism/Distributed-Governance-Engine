import {readFile} from 'node:fs/promises';
import {parseSecurityStatus,evaluateSecurityStatus} from './e2eesa-status.mjs';
const registry=JSON.parse(await readFile(new URL('../registry/prs.json',import.meta.url),'utf8'));
const status=parseSecurityStatus(await readFile(new URL('../security/e2eesa-status.json',import.meta.url),'utf8'),registry.repository);
const result=evaluateSecurityStatus(status);
if(result.implemented||result.tested||result.independentReview||result.certificationEligible) throw new Error('Foundation cannot claim production assurance');
console.log('Security status valid; production implementation/testing/review remain explicitly pending.');
