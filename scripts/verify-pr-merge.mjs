#!/usr/bin/env node
// A fail-closed preflight for GitHub PR merges made OUTSIDE Boardroom's protected merge endpoint.
// Never infer that a merge is safe from "mergeable", documentation-only diffs, or unstarted CI.
import { pathToFileURL } from 'node:url';

const SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA = /^[a-f0-9]{40}$/i;

export function assessMergeEvidence({ repository, pr, checks, statuses, requiredChecks, expectedSha }) {
  const blockers = [];
  const add = (problem) => { if (!blockers.includes(problem)) blockers.push(problem); };
  const sha = pr?.head?.sha;
  if (!SLUG.test(repository || '') || !Number.isInteger(pr?.number)) add('INVALID_REPOSITORY_OR_PR');
  if (pr?.state !== 'open' || pr?.draft) add('PR_NOT_READY');
  if (pr?.base?.repo?.full_name !== repository) add('BASE_REPOSITORY_MISMATCH');
  if (!SHA.test(sha || '') || (expectedSha && expectedSha !== sha)) add('HEAD_SHA_MISMATCH');
  if (pr?.mergeable !== true || pr?.mergeable_state !== 'clean') add('GITHUB_MERGE_REQUIREMENTS_UNSATISFIED');
  if (!Array.isArray(requiredChecks) || requiredChecks.length < 1 || requiredChecks.some(x => typeof x !== 'string' || !x.trim())) add('REQUIRED_CHECKS_NOT_CONFIGURED');
  if (!Array.isArray(checks?.check_runs) || !Number.isSafeInteger(checks?.total_count) || checks.total_count !== checks.check_runs.length) add('CHECK_RUNS_INCOMPLETE');
  if (!Array.isArray(statuses?.statuses) || statuses.statuses.length >= 100) add('COMMIT_STATUSES_INCOMPLETE');
  const runs = Array.isArray(checks?.check_runs) ? checks.check_runs : [];
  const history = Array.isArray(statuses?.statuses) ? statuses.statuses : [];
  if (!runs.length && !history.length) add('NO_EXECUTED_CHECK_EVIDENCE');
  for (const run of runs) {
    if (run.head_sha && run.head_sha !== sha) add('CHECK_FOR_DIFFERENT_COMMIT');
    if (run.status !== 'completed' || run.conclusion !== 'success') add('CHECK_NOT_SUCCESSFUL');
  }
  // GitHub returns the newest legacy status for a context first; ignore older replacements.
  const latest = new Map();
  for (const status of history) if (!latest.has(status.context)) latest.set(status.context, status);
  for (const status of latest.values()) if (status.state !== 'success') add('LEGACY_STATUS_NOT_SUCCESSFUL');
  const passed = new Set([
    ...runs.filter(r => r.status === 'completed' && r.conclusion === 'success').map(r => r.name),
    ...[...latest.values()].filter(s => s.state === 'success').map(s => s.context)
  ]);
  for (const name of requiredChecks || []) if (!passed.has(name)) add('REQUIRED_CHECK_MISSING:' + name);
  // Even CI resource-limit and zero-step failures remain failed; callers must not downgrade them.
  return { safe: blockers.length === 0, blockers, repository, number: pr?.number ?? null, headSha: sha ?? null, passingChecks: [...passed].sort() };
}

export async function verifyRemotePR({ repository, number, requiredChecks, expectedSha, token, request = fetch }) {
  if (!SLUG.test(repository || '') || !Number.isSafeInteger(number) || number <= 0) throw Error('Invalid repository or PR number');
  if (!token) throw Error('Set a scoped GITHUB_TOKEN or GH_TOKEN; never put credentials in arguments');
  const base = 'https://api.github.com/repos/' + repository;
  const headers = { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  async function api(path, method = 'GET', data) {
    const r = await request(base + path, {method, headers, redirect: 'error', ...(data ? {body:JSON.stringify(data)} : {})});
    if (!r.ok) throw Error('GitHub ' + method + ' ' + path.split('?')[0] + ' returned HTTP ' + r.status);
    return r.json();
  }
  const pr = await api('/pulls/' + number);
  const sha = pr?.head?.sha;
  if (!SHA.test(sha || '')) throw Error('Invalid or missing PR head SHA');
  const [checks, statuses] = await Promise.all([
    api('/commits/' + sha + '/check-runs?per_page=100'),
    api('/commits/' + sha + '/status?per_page=100')
  ]);
  return { result: assessMergeEvidence({repository, pr, checks, statuses, requiredChecks, expectedSha}), api };
}

export async function safeMergePR(options) {
  // Two fresh GitHub snapshots narrow the check-rerun window. Merge uses SHA compare-and-swap.
  const first = await verifyRemotePR(options);
  if (!first.result.safe) return { ...first.result, merged: false };
  const second = await verifyRemotePR({...options, expectedSha: first.result.headSha});
  if (!second.result.safe) return { ...second.result, merged: false };
  const response = await second.api('/pulls/' + options.number + '/merge', 'PUT', {sha:second.result.headSha, merge_method:'squash'});
  if (!response.merged || !SHA.test(response.sha || '')) throw Error('GitHub did not confirm a merge');
  return {...second.result, merged:true, mergeSha: response.sha};
}

export function parseArgs(args) {
  const options = { requiredChecks:[], merge:false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--repo') options.repository = args[++i];
    else if (a === '--pr') options.number = Number(args[++i]);
    else if (a === '--require') options.requiredChecks.push(args[++i]);
    else if (a === '--expected-sha') options.expectedSha = args[++i];
    else if (a === '--merge') options.merge = true;
    else throw Error('Unknown/missing argument: ' + a);
  }
  if (!SLUG.test(options.repository || '') || !Number.isSafeInteger(options.number) || options.number < 1) throw Error('Usage: --repo owner/repo --pr N --require "job or CI context" [--require ...] [--expected-sha FULL_SHA] [--merge]');
  if (options.expectedSha && !SHA.test(options.expectedSha)) throw Error('Expected SHA must have 40 hexadecimal digits');
  if (options.requiredChecks.length < 1 || options.requiredChecks.some(x => !x)) throw Error('At least one required real check must be named');
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    const response = opts.merge ? await safeMergePR({...opts,token}) : (await verifyRemotePR({...opts,token})).result;
    // No credentials, personal information, or raw server response in output.
    console.log(JSON.stringify(response, null, 2));
    if (!response.safe) process.exitCode = 2;
  } catch (e) { console.error('Merge preflight stopped: ' + e.message); process.exitCode = 1; }
}

