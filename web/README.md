# Local GitHub workspace

Open real Horsemen projects as a draggable canvas. Click a record to read it
or inspect its exact Markdown. The app reads GitHub; it does not edit files.

From this source checkout, with Python 3.10+ and GitHub CLI installed:

```sh
gh auth status
# If needed: gh auth login
python3 scripts/serve_gui.py
```

Open <http://127.0.0.1:8787>. Use `--port 8790` if that port is occupied.
The first visit scans repositories available to the active github.com account.
Refresh GitHub repeats discovery. Clear workspace removes the in-memory scan;
it does not sign out of GitHub. Stop the server with Ctrl+C.

## Reading and navigation

- Search the left rail by project name, repository, or folder. Multiple search
  words narrow the result. Nested project roots are separate entries.
- Open projects as discovery finds them. The remaining scan continues without
  changing the project you selected.
- Cards show source excerpts suited to each record: purpose and audience,
  next action and gates, knowledge sources, paths, releases, and tools.
  These are excerpts, not generated claims. Open the peek for full context.
- Drag records to arrange them, drag the background to pan, and scroll to zoom.
  Fit brings all records into view. Alt + arrow keys move a focused record.
- Click a card for its reading view or exact Markdown source. Missing and
  unreadable records remain visible. Source links use the scanned commit.
- Changelog PR links can load merge details and the PR description. Image
  attachments appear as links. A merge alone is not proof of delivery.

## Boundaries

This is a source-only local preview, not a hosted or multi-user service.
The wheel and skill do not include the web assets. There is no public sharing,
OAuth app, file editing, webhook, local-folder import, or background refresh.

Discovery reads default branches, including archived repositories. A project
needs at least two core records and either VISION or PROGRESS (legacy STATUS
is supported). Missing records are reported. Truncated repository trees are
reported as incomplete scans. Files larger than 512 KiB are not loaded.
Markdown supports headings, lists, tables, fenced code, links, and simple
expandable sections. Other HTML is shown as text. Nested Markdown formatting
is limited; exact source is always available. PR comments are not scanned.

The server binds only to 127.0.0.1. It reads credentials locally through `gh`;
they never reach the browser. Requests are read-only. Repository metadata and record contents are not saved to disk
by the app. The browser stores only opaque project IDs and canvas positions.
External images do not load automatically. Opening an external link leaves
the local app. Do not expose this server through a tunnel or reverse proxy.
After switching GitHub accounts, refresh discovery. Project loads also check
the local credential identity and reject account changes. The remote account
check is reused for up to 30 seconds; revocation of an unchanged credential
can take that long to invalidate cached content.

Records load in parallel. Up to 16 projects are cached in server memory at
the scanned revision. Refresh and Clear workspace discard this cache. Failed
record loads are retried instead of cached. Nothing is written to disk.

## Verification

```sh
python3 -m unittest discover -s tests -p test_gui.py
node tests/test_gui_previews.cjs
python3 scripts/test_gui_e2e.py --output /tmp/horsemen-gui-check
```

The browser check needs `agent-browser`. It uses fictional GitHub fixtures,
checks reading/source views and browser safety, and saves screenshots and
command output outside the repository. Full package checks remain in
[CONTRIBUTING](../CONTRIBUTING.md).
