# Hosted viewer

A Cloudflare Worker that serves the Horsemen visual workspace to anyone who
signs in with GitHub. It is read-only and keeps no project data.

## How it works

```text
browser ──/gh/* (CSRF token + encrypted cookie)──▶ Worker ──user token──▶ GitHub API
   ▲  parses records (web/hosted-reader.js)            │ allowlisted GET calls only
   └──────────────── JSON passes through ◀─────────────┘ nothing logged or stored
```

- **Sign-in.** A GitHub App with "Request user authorization". The user
  installs the app on the repositories they choose. The user token can only
  read repositories that the user can access and the app is installed on.
- **Session.** The token lives in an AES-GCM encrypted `__Host-` cookie that
  is HttpOnly, Secure, and SameSite=Lax. There is no database, KV, or server
  session store. Expiring tokens refresh through `/auth/refresh`.
- **Reads.** The Worker forwards only these GET calls: the user, installations,
  installation repositories, branch commits, trees, blobs, contents at a
  revision, and pull requests. It drops unknown query keys and rejects path
  traversal. GitHub error text is never passed to the browser.
- **Parsing.** The browser runs `web/hosted-reader.js`, a port of the Python
  reader. `tests/test_hosted_reader.cjs` checks that both produce the same
  links, sections, and project roots.
- **Live updates.** While a project is open and its tab is visible, the browser
  checks the branch every `POLL_SECONDS` (default 60) with an ETag. An
  unchanged branch returns 304, which GitHub does not count against the rate
  limit. A new commit reloads the project; an open record waits until it closes.
- **Agents.** Agents update records the normal way: edit, commit, and push.
  The viewer shows the default branch, so unpushed edits do not appear.

## Deploy

Needs Bun and a Cloudflare account with the target domain.

```sh
cd worker
bun install
# Edit wrangler.jsonc: set `name` and the custom domain.
bunx wrangler deploy
# Create the GitHub App, then store its settings and a new session key:
bun scripts/create-github-app.mjs --origin https://your.domain --session-key
```

The setup script opens a local page. Select **Continue to GitHub**, then
**Create GitHub App**. Add `--org your-org` to create the app in an
organization. The script saves `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
`GITHUB_APP_SLUG`, and `SESSION_KEY` with `wrangler secret put`. It never
prints them. It discards the app private key, which read-only user access
does not need. Then install the app from the link that the script prints.

To rotate the session key, which signs everyone out:
`openssl rand -base64 32 | bunx wrangler secret put SESSION_KEY`.

`/healthz` returns 200 when the instance is configured and 503 when it is not.

## Develop and test

```sh
node --test ../tests/test_hosted_reader.cjs test/       # unit tests
python3 ../scripts/test_hosted_e2e.py --output /tmp/horsemen-hosted-check
```

The end-to-end check runs `wrangler dev` against a fake GitHub. It signs in,
opens a fictional project, detects a new commit, and signs out. It needs
`agent-browser` and saves screenshots and logs to `--output`.

## Limits

- Only default branches are shown. Branch and pull request views are not built.
- Discovery reads every installed repository each time the page loads.
  Very large installations are slow, and each read counts against the user's
  GitHub rate limit (5,000 requests an hour).
- Public share links are not built. They will need stored share metadata,
  not stored records.
- Private PR image attachments open on GitHub; the viewer does not load them.
- Cloudflare's free plan allows 100,000 Worker requests a day. Each GitHub
  read is one request.
