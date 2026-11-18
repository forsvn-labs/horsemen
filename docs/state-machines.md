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
Missing, oversized, or invalid records fail independently.

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

Remaining limits: no persistence, scheduled refresh, multi-user isolation,
GitHub Enterprise host support, or complete-tree fallback. An account change
outside the app requires refresh; status metadata is the last scan snapshot.
