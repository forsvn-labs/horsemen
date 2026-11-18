# Local GitHub reader state

The server owns the account, discovery generation, project membership, and
pinned source revisions. The browser owns selection, loading state, and a
request counter. GitHub remains the record authority. No project content is
persisted by the server.

| State | Entry | Exit |
| --- | --- | --- |
| Idle | Startup or clear | Start discovery |
| Scanning | Clear old results, increment generation | Ready, partial, or error |
| Ready | All repositories inspected | Refresh or clear |
| Partial | Some repositories could not be inspected | Refresh or clear |
| Error | Account or repository listing failed | Retry or clear |

Each repository completes independently. Empty repositories are not failures.
Truncated trees and denied access are explicit gaps. Duplicate scan requests
reuse the active scan. Clear cancels publication of results from its generation;
already-running GitHub reads can finish but their results are discarded.

Project selection clears prior content before loading. Only IDs in the current
scan can be read. The active GitHub account must match the scan account.
A changed account clears that scan. A stale check cannot clear a newer scan.
Record reads use blob SHAs from the scanned commit, not a moving branch.
Missing, oversized, or invalid records fail independently. Four record workers
read independent blobs concurrently. A bounded cache holds at most 16 project
snapshots in memory. Refresh, clear, or an account mismatch removes the cache.
A load from an old generation cannot populate it. Transient failures are not
cached. Each load checks a local credential fingerprint. Remote account
identity is reused for at most 30 seconds and refreshed on credential changes.

Browser request counters prevent an earlier project or PR response from
replacing the latest selection. Host, Origin, and per-process session checks
restrict API requests to the local app. Provider errors do not echo credential
or private provider diagnostics. Markdown is escaped; only HTTP(S) links are
active. Raw scripts and remote image requests do not run.

## Empirical checks

`tests/test_gui.py` covers nested and legacy roots, symlinks, pinned blobs,
size and decoding failures, truncated trees, failed scans and retry, changed
accounts, duplicate scans, cancellation, stale checks, and HTTP boundaries.
The stale-check regression failed before the generation guard was corrected.
`scripts/test_gui_e2e.py` checks the browser against a disposable provider,
including missing records, safe Markdown, source view, saved layouts, zoom,
mobile bounds, and removal of prior peek content when clearing the workspace.
It also checks search, early project loading during discovery, and preservation
of selection when newly discovered projects sort before the current project.
`tests/test_gui_previews.cjs` covers all seven record previews, empty content,
project search, and exclusion of historical Progress entries. Reader tests
cover parallel loads, cache reuse, invalidation, credential changes, and expiry.

Remaining limits: no persistence, scheduled refresh, multi-user isolation,
GitHub Enterprise host support, or complete-tree fallback. An account change
outside the app requires refresh; status metadata is the last scan snapshot.

## Connected documents

Loading a record registers its explicit Markdown links in the current scan.
Only registered Markdown targets can use the document endpoint. Relative
paths resolve against the containing file; paths that escape the repository
are rejected. External URLs are never fetched. Linked reads use the scanned
commit and the same file-size, decoding, and account checks as root records.
Clear and refresh remove the link registry. A stale document response cannot
register more links or replace the current peek.

The peek keeps a bounded navigation history. Opening a connection pushes a
record; Back pops it. Closing the peek or changing projects invalidates its
pending request. The canvas expands only requested connections and keeps the
same artifact reader. Link discovery does not create provider access.

`tests/test_gui_links.py` covers relative paths, code examples, unsafe URLs,
unknown targets, recursive links, revision pinning, and clear. Browser checks
cover Brain → document → decision → Back, external source cards, expansion
onto the canvas, and the artifact-specific overview layouts.

## Canvas interaction and branch visibility

The canvas separates selection from reading. Pointer down selects an artifact;
dragging moves the selection as one group. Empty-space dragging selects an
area. Hand, Space, middle mouse, and right mouse dragging change the camera.
Wheel input pans; modified wheel input zooms around the pointer. Cancel rolls
back an unfinished drag. List view keeps ordinary single-click navigation.

Expanded branches form a directed graph rooted at the seven main artifacts.
Visibility is reachability from those roots through expanded edges. Collapsing
one parent hides only nodes that have no remaining visible path. Cycles cannot
keep an orphan branch visible. Node positions survive collapse. Exploring a
deep document reveals its ancestor path before adding children. Project
changes clear the selection and expansion state; old asynchronous reads
cannot expand the newly selected project.

`tests/test_canvas_state.cjs` covers shared descendants, orphan cycles, ancestor
paths, additive selection, and marquee bounds. Browser tests exercise native
mouse marquee and group drag, single-click selection, Enter/double-click open,
Hand/Space pan, wheel pan and modifier zoom, Escape cancellation, and collapse.
