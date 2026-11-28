# Visual workspace requirements

Status: discovery. This is a proposed build scope, not a released product.

## Confirmed direction

Horsemen will have an open-source GUI that can be self-hosted. Operators can
connect GitHub, find projects that use Horsemen, open each project on a canvas,
and peek into its records and supporting artifacts. Each type of content gets
an appropriate view. A project canvas can be shared publicly.

The existing skill, Markdown files, and CLI remain usable.

## First release proposal

Start with a read-only workspace for people managing several agent projects.
Measure whether they can identify the next action, its blocker, and its evidence
without reading all project files. The owner has not yet confirmed this audience,
the editing boundary, or whether public shares are snapshots or live views.

| Surface | Required behavior |
| --- | --- |
| Portfolio | List discovered projects, reported health, next action, source revision, and last successful sync. Distinguish missing records from failed access. |
| Canvas | Start with the four records arranged clearly, then allow free artifact movement on an infinite canvas. Use click-to-select, double-click/Enter-to-open, group dragging, marquee selection, Hand/Space pan, and modified-wheel zoom. Support expand/collapse for linked branches, Fit, Reset, saved per-project layouts, search, and a list alternative. |
| Peek | Open any artifact without losing canvas position. Support deep links, keyboard close, readable full content, source view, and return focus. |
| Vision | Show purpose, audience, boundaries, and unresolved owner decisions. |
| Progress | Show next action, shipped outcomes, ready work, blockers, and linked proof. Preserve the difference between ready and shipped. |
| Brain | Show knowledge destinations and access boundaries. A link is not access to its contents. |
| Anatomy | Show architecture, paths, entry points, commands, and the tech stack. |
| Supporters | Render README as a guide, CHANGELOG as release history with delivery evidence, PR/commit references, and before/after PR screenshots, and TECHSTACK as components and their roles. Unknown artifacts keep a readable source view. |
| Public share | Preview the exact included artifacts and linked assets before publishing. Make removal possible. Exclude private source data from public responses. |

## GitHub connection

Use a GitHub App with the minimum needed permissions. A read-only first release
can request read access to repository contents. Account connection and repository
installation are separate steps. Show the repositories the installation can
access; do not promise access to every repository associated with an account.

Paginate repository discovery. Detect record roots inside monorepos as well as
at the repository root. Preserve project identity using repository identity and
record-root path. Read a coherent commit revision, rather than mixing files from
different pushes. Handle truncated tree responses, missing files, revoked access,
renamed repositories, archived projects, rate limits, and delayed synchronization.

Sources: [GitHub App permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app),
[installation scope](https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party),
[Git tree response limits](https://docs.github.com/en/rest/git/trees).

## Data and rendering requirements

Markdown remains the source of truth. Preserve headings, links, tables, and
unknown sections. Derived views must expose their source location and revision.
Reuse the Python record checks through a stable boundary; do not introduce a
second incompatible record contract in the frontend.

Treat repository text as untrusted content. Sanitize HTML and URLs. Do not run
commands from records. Bound file sizes and parsing work. External documents
remain links until their provider has an explicit integration and access grant.
Do not fetch arbitrary private-network URLs from a server to populate previews.

## Public sharing proposal

Publish a reviewed snapshot of selected artifacts, identified by revision.
Public data must have its own allowlist and storage representation; hiding a
card in the browser is insufficient. Inspect links, images, filenames, and
metadata as well as visible prose. Removing a share must stop future delivery,
including cached responses. It cannot erase copies that visitors already saved.
Live sharing can follow after its update and revocation rules are defined.

## Self-hosting requirements

Provide a documented container deployment, persistent storage, migrations,
backup and restore steps, a health check, and an upgrade procedure. Document the
GitHub App setup, callback URL, webhook secret, encryption key, and HTTPS
requirements. Keep secrets on the server. Support periodic refresh where inbound
webhooks are unavailable. A fresh installation must work without a vendor account
or a paid AI service. Choose the application stack after the prototype is reviewed.

## Verification gates

- Test record discovery and parsing against current and legacy Horsemen fixtures.
- Test access isolation, revoked GitHub access, duplicate events, retries, and stale jobs.
- Test that a public share returns only approved data and fails after revocation.
- Test keyboard peeks, focus return, reduced motion, small screens, and large graphs.
- Run a fresh self-hosted install and restore a backup on a clean instance.
- Use the design prototype to test comprehension with representative operators.

The design exploration does not verify authentication, synchronization,
publication, or production deployment. Those require a working backend and real
integration tests with disposable repositories.

## Ship evidence and PR media

Each Changelog entry must state what reached people and link its delivery proof:
a release, verified deployment, published source revision, sent artifact, or
owner confirmation. A merge and passing checks alone are insufficient.

Keep the PR URL, merge status, delivered commit, screenshot or recording URLs,
captions, and capture context beside the outcome. Before/after images are welcome
for visible changes. State when media is missing or inaccessible; never replace
it with generated imagery presented as proof. Preserve the original PR attachment
rather than committing screenshots to the source repository. Public sharing must
check attachment access and inclusion independently of the PR visibility.
