import {readFile} from 'node:fs/promises';
import {parsePrRegistry} from '../registry/pr-contract.mjs';
const body=await readFile(new URL('../registry/prs.json',import.meta.url),'utf8');
const repo=process.env.GITHUB_REPOSITORY || JSON.parse(body).repository;
const {document}=parsePrRegistry(body,repo);
const retired=JSON.parse(await readFile(new URL('../registry/roadmap.json',import.meta.url),'utf8'));
if(retired.repository!==repo || retired.deprecated!==true || retired.redirectTo!=='registry/prs.json' || ['units','milestones','plannedPrCount'].some(k=>Object.hasOwn(retired,k))) throw new Error('Duplicate active roadmap');
for(const u of document.units) { if(!u.scope || !u.acceptanceCriteria?.length || !u.requiredTests?.length) throw new Error('Incomplete PR specification'); await readFile(new URL('../'+u.specification,import.meta.url)); }
console.log(`Valid shared PR registry: ${repo}; ${document.units.length} planned units; zero inferred completions.`);
