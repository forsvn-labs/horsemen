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

- Select a project in the left rail. Nested project roots are separate entries.
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

The server binds only to 127.0.0.1. GitHub credentials stay in `gh`; requests
are read-only. Repository metadata and record contents are not saved to disk
by the app. The browser stores only opaque project IDs and canvas positions.
External images do not load automatically. Opening an external link leaves
the local app. Do not expose this server through a tunnel or reverse proxy.
After switching GitHub accounts, refresh discovery. Project loads also check
the active account and reject stale scans.

## Verification

```sh
python3 -m unittest discover -s tests -p test_gui.py
python3 scripts/test_gui_e2e.py --output /tmp/horsemen-gui-check
```

The browser check needs `agent-browser`. It uses fictional GitHub fixtures,
checks reading/source views and browser safety, and saves screenshots and
command output outside the repository. Full package checks remain in
[CONTRIBUTING](../CONTRIBUTING.md).
