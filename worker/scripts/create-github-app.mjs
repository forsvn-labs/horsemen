#!/usr/bin/env node
/* Create the Horsemen GitHub App with the manifest flow, then store its
   settings as Worker secrets. Secrets are never printed or written to disk.

   bun scripts/create-github-app.mjs --origin https://horsemen.example.com [--org my-org] [--name "Horsemen Viewer"]

   It opens a local page. Select "Create GitHub App" on GitHub; the script
   receives the app settings and runs `wrangler secret put` for each one. */
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).reduce((out, arg, i, all) => (arg.startsWith('--') ? [...out, [arg.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : out), []));
const origin = (args.origin || '').replace(/\/$/, '');
if (!/^https:\/\/[a-z0-9.-]+$/.test(origin)) { console.error('Use --origin https://your.domain'); process.exit(2); }
const port = Number(args.port || 8799);
const state = randomBytes(16).toString('hex');

function manifest({ name, origin, port, dev }) {
  return {
    name, url: origin, description: 'Read-only viewer for Horsemen project records. Stores none of your project data.',
    redirect_url: `http://127.0.0.1:${port}/created`,
    callback_urls: [origin + '/auth/callback', ...(dev ? ['http://localhost:8787/auth/callback'] : [])],
    request_oauth_on_install: true, public: true,
    hook_attributes: { url: origin + '/webhooks/github', active: false },
    default_permissions: { contents: 'read', metadata: 'read', pull_requests: 'read' }, default_events: [],
  };
}
const app = manifest({ name: args.name || 'Horsemen Viewer', origin, port, dev: args['no-dev'] !== 'true' });
const target = args.org ? `https://github.com/organizations/${encodeURIComponent(args.org)}/settings/apps/new` : 'https://github.com/settings/apps/new';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function putSecret(name, value) {
  const run = spawnSync('bunx', ['wrangler', 'secret', 'put', name], { input: value, cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' });
  if (run.status) throw new Error(`wrangler secret put ${name} failed`);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const send = (status, html) => { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(html); };
  if (url.pathname === '/') {
    return send(200, `<!doctype html><meta charset="utf-8"><title>Create the Horsemen GitHub App</title>
<body style="font:16px system-ui;max-width:560px;margin:60px auto;padding:0 16px">
<h1>Create the Horsemen GitHub App</h1><p>GitHub opens with the settings filled in. You can change the name. Then select <b>Create GitHub App</b>.</p>
<form method="post" action="${esc(target)}?state=${state}"><input type="hidden" name="manifest" value="${esc(JSON.stringify(app))}"><button style="font:inherit;padding:10px 16px">Continue to GitHub</button></form></body>`);
  }
  if (url.pathname === '/created') {
    if (url.searchParams.get('state') !== state || !url.searchParams.get('code')) return send(400, 'State mismatch. Run the script again.');
    try {
      const r = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(url.searchParams.get('code'))}/conversions`, { method: 'POST', headers: { accept: 'application/vnd.github+json', 'user-agent': 'horsemen-setup' } });
      if (!r.ok) throw new Error('GitHub did not convert the manifest (' + r.status + ')');
      const data = await r.json();
      putSecret('GITHUB_CLIENT_ID', data.client_id);
      putSecret('GITHUB_CLIENT_SECRET', data.client_secret);
      putSecret('GITHUB_APP_SLUG', data.slug);
      if (args['session-key'] === 'true') putSecret('SESSION_KEY', randomBytes(32).toString('base64'));
      // The private key and webhook secret are not needed for read-only user access; they are discarded.
      const install = `${data.html_url}/installations/new`;
      console.log(`Created GitHub App "${data.name}" (${data.slug}). Secrets saved to the Worker.\nInstall it: ${install}`);
      send(200, `<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;max-width:560px;margin:60px auto;padding:0 16px"><h1>Done</h1><p>The app settings are saved as Worker secrets.</p><p><a href="${esc(install)}">Install the app on your repositories</a>, then open <a href="${esc(origin)}">${esc(origin)}</a>.</p></body>`);
    } catch (error) {
      console.error(error.message);
      send(500, 'Setup failed: ' + esc(error.message));
    }
    setTimeout(() => server.close(), 500);
    return;
  }
  send(404, 'Not found');
});

server.listen(port, '127.0.0.1', () => {
  const local = `http://127.0.0.1:${port}/`;
  console.log(`Open ${local} to create the GitHub App.`);
  if (args.open !== 'false') spawn('open', [local], { stdio: 'ignore', detached: true }).on('error', () => {});
});
