/* The setup script for the two GitHub Apps. Failure modes covered: the viewer app gets write access; the editor
   app asks for more than Contents and Metadata; the two apps share secret names (one would overwrite the other);
   the editor callback is not the editor route; --print-manifest prints a secret. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { APPS, manifest } from '../scripts/create-github-app.mjs';

test('the viewer app stays read-only and the editor app asks only for Contents write and Metadata read', () => {
  const viewer = manifest({ kind: 'viewer', origin: 'https://horsemen.example', port: 8799, dev: false });
  assert.deepEqual(viewer.default_permissions, { contents: 'read', metadata: 'read', pull_requests: 'read' });
  assert.deepEqual(viewer.callback_urls, ['https://horsemen.example/auth/callback']);
  const editor = manifest({ kind: 'editor', origin: 'https://horsemen.example', port: 8799, dev: true });
  assert.deepEqual(editor.default_permissions, { contents: 'write', metadata: 'read' });
  assert.deepEqual(editor.callback_urls, ['https://horsemen.example/auth/edit/callback', 'http://localhost:8787/auth/edit/callback']);
  assert.equal(editor.name, 'Horsemen Editor'); assert.deepEqual(editor.default_events, []); assert.equal(editor.hook_attributes.active, false);
});

test('the two apps store distinct secrets', () => {
  const names = [...Object.values(APPS.viewer.secrets), ...Object.values(APPS.editor.secrets)];
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(Object.values(APPS.editor.secrets), ['EDITOR_CLIENT_ID', 'EDITOR_CLIENT_SECRET', 'EDITOR_APP_SLUG']);
});

test('--print-manifest prints the manifest only and starts no server', () => {
  const run = spawnSync(process.execPath, [new URL('../scripts/create-github-app.mjs', import.meta.url).pathname, '--editor', '--origin', 'https://horsemen.example', '--print-manifest'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stderr);
  const printed = JSON.parse(run.stdout);
  assert.deepEqual(printed.default_permissions, { contents: 'write', metadata: 'read' });
  assert.doesNotMatch(run.stdout, /secret|private_key|pem/i);
  const bad = spawnSync(process.execPath, [new URL('../scripts/create-github-app.mjs', import.meta.url).pathname, '--editor', '--origin', 'https://horsemen.example', '--session-key'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(bad.status, 2, 'the editor app does not make a new session key');
});
