#!/usr/bin/env node
/* Live check of the GitHub calls that /write/canvas makes, on a disposable repository.
   It uses the GitHub CLI sign-in (`gh api`), not the editor app, so it checks the API rules only:
   the browser check with the editor app is a separate, manual step (worker/README.md).

   node scripts/live-edit-check.mjs --repo you/horsemen-edit-check [--yes]

   The repository must exist, its name must contain "check" or "disposable", and you must have push access.
   It writes and then deletes .horsemen/canvas/live-check.canvas with four commits, each with [skip ci].
   It prints HTTP statuses, SHAs, and commit messages only, never a token. */
import { spawnSync } from 'node:child_process';

const args = Object.fromEntries(process.argv.slice(2).reduce((out, arg, i, all) => (arg.startsWith('--') ? [...out, [arg.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : out), []));
const repo = args.repo || '';
if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]*(?:check|disposable)[A-Za-z0-9_.-]*$/.test(repo)) {
  console.error('Use --repo owner/name of a disposable repository; the name must contain "check" or "disposable".'); process.exit(2);
}
const PATH = '.horsemen/canvas/live-check.canvas';
/* One gh api call. Returns { status, body }. The token stays inside gh. */
function api(method, route, body = null) {
  const run = spawnSync('gh', ['api', '--method', method, '--include', route, ...(body ? ['--input', '-'] : [])], { input: body ? JSON.stringify(body) : undefined, encoding: 'utf8' });
  const text = run.stdout || '', split = text.indexOf('\r\n\r\n') >= 0 ? text.indexOf('\r\n\r\n') : text.indexOf('\n\n');
  const status = Number((text.match(/^HTTP\/[0-9.]+ ([0-9]{3})/) || [])[1] || 0);
  let parsed = null; try { parsed = JSON.parse(text.slice(split).trim() || 'null'); } catch { /* Not JSON. */ }
  return { status, body: parsed };
}
const canvas = text => '{\n"horsemen":{"version":1},\n"nodes":[\n{"id":"note-live","type":"text","x":0,"y":0,"width":320,"height":140,"text":' + JSON.stringify(text) + '}\n],\n"edges":[]\n}\n';
const b64 = text => Buffer.from(text).toString('base64');
const results = [];
const step = (name, expected, res, extra = {}) => { const ok = expected.includes(res.status); results.push({ step: name, status: res.status, expected, ok, ...extra }); if (!ok) { console.log(JSON.stringify(results, null, 2)); console.error('FAIL at: ' + name); process.exit(1); } return res; };

const meta = step('read the repository (default branch, push permission)', [200], api('GET', `/repos/${repo}`));
if (meta.body?.permissions?.push !== true) { console.error('You need push access to ' + repo + '.'); process.exit(1); }
const branch = meta.body.default_branch;
const contents = `/repos/${repo}/contents/${PATH}`;
step('the file does not exist yet', [404], api('GET', `${contents}?ref=${encodeURIComponent(branch)}`));
if (args.yes !== 'true') console.log(`This writes ${PATH} on ${repo}@${branch} four times, then deletes it. Add --yes to go on.`), process.exit(0);
const made = step('create the file (no sha)', [201], api('PUT', contents, { message: 'canvas(live-check): add 1 [skip ci]', content: b64(canvas('First save.')), branch }));
const first = made.body.content.sha;
step('a create when the file exists (no sha) is refused', [409, 422], api('PUT', contents, { message: 'canvas(live-check): add 1 [skip ci]', content: b64(canvas('Second create.')), branch }));
step('an update with a stale sha is refused', [409], api('PUT', contents, { message: 'canvas(live-check): edit 1 [skip ci]', content: b64(canvas('Stale.')), branch, sha: 'f'.repeat(40) }));
const read = step('read the file at the branch (blob sha for the conflict check)', [200], api('GET', `${contents}?ref=${encodeURIComponent(branch)}`));
if (read.body.sha !== first) { console.error('The blob SHA after the create is not the SHA of the GET.'); process.exit(1); }
const updated = step('update with the current sha', [200], api('PUT', contents, { message: 'canvas(live-check): edit 1 [skip ci]', content: b64(canvas('Second save.')), branch, sha: first }));
const commit = step('read the commit', [200], api('GET', `/repos/${repo}/commits/${updated.body.commit.sha}`));
const message = commit.body.commit.message, author = commit.body.author?.login || null, verified = commit.body.commit.verification?.verified ?? null;
if (!message.endsWith('[skip ci]')) { console.error('The commit message lost [skip ci].'); process.exit(1); }
step('delete the file (cleanup)', [200], api('DELETE', contents, { message: 'canvas(live-check): remove 1 [skip ci]', branch, sha: updated.body.content.sha }));
console.log(JSON.stringify({ repo, branch, results, commit: { sha: updated.body.commit.sha, message, author, verified } }, null, 2));
console.log('PASS: the contents API refuses a stale sha with 409 and a create over a file, accepts the current sha, and keeps [skip ci].');
