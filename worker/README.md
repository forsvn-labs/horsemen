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
- **Fast reloads.** After discovery, the browser saves a discovery index in
  `localStorage`: repository names, record paths, revisions, and ETags. It
  never saves record text. A reload shows the projects at once and opens the
  last project, then checks every branch in the background. Only changed or
  new repositories are scanned again. Sign-out and Clear workspace remove the
  index. Discovery reads up to 12 repositories in parallel.
- **Share links.** Every project and record has a readable link, such as
  `https://horsemen.forsvn.com/owner/repo?record=progress`. A project in a
  subfolder adds `root=apps%2Fweb`. The address bar always shows the link for
  the open project and record; **Copy link** in the header and in the record
  copies it. A signed-out visitor signs in and returns to the same link. The
  link carries no data: the visitor needs GitHub access to the repository, and
  the app must be installed on it. Otherwise the page says so. Agents can write
  these links in reports without any API.
- **Public view.** A link to a public repository, such as
  `https://horsemen.forsvn.com/hungv47/horsemen`, opens without sign-in. The
  Worker first checks that the repository is public, then reads it through
  `/pub/...` without any user token. It reads only repository routes. GitHub
  allows 60 such requests an hour per Cloudflare IP; set the optional secret
  `GITHUB_PUBLIC_TOKEN` (a fine-grained token with public read access and no
  permissions) for 5,000 an hour. Public data is cached at the edge: repository
  details and branch heads for 60 seconds, objects addressed by SHA for a day.
  A repository made private stops working within 60 seconds. The browser
  keeps nothing for a public view. A signed-in user can add `?view=public` to
  see what visitors see. Private repositories still need sign-in.
- **Agents.** Agents update records the normal way: edit, commit, and push.
  The viewer shows the default branch, so unpushed edits do not appear. The
  Horsemen Stop hook reminds the agent when a record it changed has not
  reached the remote default branch (see the Publish rule in
  [hooks](../horsemen/references/hooks.md)).

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
python3 ../scripts/bench_hosted.py --repos 80 --latency 150 --output /tmp/horsemen-bench
```

The benchmark uses a fake GitHub with a fixed delay for each call. It prints
the time to the first project and to the end of discovery, for a first visit
and a reload. `wrangler dev` uses HTTP/1.1, so the browser sends at most six
requests at a time; production uses HTTP/2, so real parallel reads are faster.

The end-to-end check runs `wrangler dev` against a fake GitHub. It signs in,
opens a fictional project, detects a new commit, and signs out. It needs
`agent-browser` and saves screenshots and logs to `--output`.

## Limits

- Only default branches are shown. Branch and pull request views are not built.
- A first visit reads every installed repository: two calls for each one.
  A reload makes one branch check for each repository; unchanged branches
  return 304 and do not count against the GitHub rate limit (5,000 requests
  an hour).
- Links to private repositories work only for people with GitHub access.
  Public links to private repositories would need stored share settings.
- Private PR image attachments open on GitHub; the viewer does not load them.
- Cloudflare's free plan allows 100,000 Worker requests a day. Each GitHub
  read is one request.
