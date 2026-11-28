# Command-line guide

Read or check one project record, inspect the whole project, or apply one
explicit local edit. Python 3.10+ is required; Git is optional. The skill and
CLI share their checker and version. Nothing contacts a provider by default.

## Everyday commands

| Command | Result |
| --- | --- |
| `horsemen brain` | Read and check BRAIN.md: knowledge locations and access rules |
| `horsemen vision` | Read and check VISION.md: owner direction |
| `horsemen anatomy` | Read and check ANATOMY.md: project map |
| `horsemen progress` | Read and check PROGRESS.md, or legacy STATUS.md |
| `horsemen check PATH` | Validate all local records, including cross-record rules |
| `horsemen inspect PATH` | Check records and show local Git state and progress |
| `horsemen plan --help` | Setup, migration, edit proposals and review patches |
| `horsemen show [TARGET]` | Print the workspace index, record headings, one section, a canvas outline, or one canvas element as short text |
| `horsemen canvas apply NAME` | Check, format, and write one canvas file from a list of edit ops |
| `horsemen mcp` | Run the local MCP server; `mcp install` and `mcp status` register and check it |

Add `--json` for machine-readable output. Named-record commands accept
`--path PATH`; otherwise they resolve the current project, including from a
subdirectory. They show the record's content and SHA256 in JSON. They do not
read other records or update dates. Their findings concern that document only;
use `check` for relationships between records, including public/private rules.
If both progress filenames contain real records, `status` fails and asks for
reconciliation. A legacy-only STATUS.md stays at that path, even on update.

`inspect` lists the current branch, changed files and registered worktrees.
It does not inspect other worktrees or query PRs, CI, deployments or providers.
Provider state is `not_checked`, even if BRAIN names Google Drive or another
knowledge home. A local BRAIN.md is a directory of knowledge, not a copy of
all its external originals. A named-record command never bulk-syncs those originals.

`--help` and `--version` need no project reads. Unknown commands fail.
The CLI does not run project scripts or install hooks.

## Update exactly one record

An update needs an explicit edit, not a request to invent fresh content:

```sh
horsemen brain --path /path/to/project --json
horsemen brain update --path /path/to/project --changes edit.json --dry-run --json
horsemen brain update --path /path/to/project --changes edit.json --exclusive --json
```

Use the same syntax for `vision`, `anatomy`, and `progress`. The older `structure` and `status` commands remain aliases. The edit file is
one JSON object, not the batch format used by the older plan command:

```json
{
  "file": "BRAIN.md",
  "source_sha256": "COPY_THE_HASH_FROM_THE_READ_RESULT",
  "before": "one exact existing span",
  "after": "its reviewed replacement",
  "evidence": ["reference supporting this correction"],
  "owner_agreement": "reference to the owner's approval of this edit"
}
```

The filename must match the command. The source hash must match the complete
current UTF-8 document. `before` must occur exactly once. Empty replacement
text is allowed. Evidence is required; the CLI cannot verify its truth.
BRAIN and VISION also require an owner-agreement reference. That reference
records context; it does not authorize new provider access or override holds.
An agent must establish current permission before it invokes a saving command.

`--dry-run` validates and shows proposed content without saving. An actual
save requires `--exclusive`: the caller must ensure no other editor, agent,
sync client or process writes the target until completion. Do not use it on a
provider-mounted file or in a shared/synced directory that cannot meet that
condition. This is a local editing contract, not a provider adapter or an
approval callback. A plan or exported patch never turns into a write by itself.

The save replaces just the matched span in just the named record. It preserves
other text, CRLF/LF line endings, a missing final newline and POSIX permission
bits. No-op edits leave timestamps alone. It does not create missing records,
refresh dates, update companions or commit anything. File identity changes
on replacement; extended attributes/ACLs are not promised to be preserved.

The writer uses a per-record exclusive lock, no-follow reads, source checks,
a temporary file, atomic replacement and read-back. Existing locks, symlinks,
hard links, stale hashes, duplicate JSON keys and malformed input fail. It
cleans up its own temporary file and lock, never somebody else's lock.
A reported read-back failure after replacement means the save may already
have occurred: inspect the target before retrying.

**Concurrency limit:** atomic replacement is not compare-and-swap. An editor
that ignores Horsemen's lock can change the file between the final check and
replacement. `--exclusive` is a caller promise that prevents this situation,
not a mechanism that defeats arbitrary writers. Without that promise, use
`--dry-run` or the existing review-patch workflow. No automatic retry or
rollback is claimed. Local updates require POSIX no-follow file operations;
Windows is unsupported.

`--provider local` is the default. Other values fail before reading or writing
local content, directing you to the configured, authorized host workflow.
There is no CLI provider authentication or live remote save. The existing
Brain/records libraries retain their revision and host-authorization rules;
this local command does not weaken or bypass those adapters.

## Read and edit canvases

```sh
horsemen show                                  # index: records, canvases, next action
horsemen show progress                         # headings of PROGRESS.md
horsemen show "progress#Shipped"               # one section
horsemen show progress.canvas                  # outline of .horsemen/canvas/progress.canvas
horsemen show "progress.canvas#note-risk"      # one element
horsemen canvas apply progress --ops ops.json --dry-run
horsemen canvas apply progress --ops ops.json --base-rev 4191a616
horsemen canvas apply progress                 # rewrite the file in canonical form
```

`show` is the `read` tool and `canvas apply` is the `canvas_edit` tool of the
MCP server; the [canvas guide](references/canvas.md) has the targets, the op
format, and the limits. `--path PATH` selects a project; without it, the
commands find the project from the current folder.

`show` prints plain text within a character limit: 800 for the index, 1,200
for headings, 2,000 for the other targets, and `--max-chars` up to 8,000. A
longer reply ends with `more: offset=N` for `--offset`. Exit code 0 means a
reply on standard output. Exit code 2 means a target that does not exist or
an option out of range, with the reason on standard error.

`canvas apply` reads a JSON list of ops from `--ops FILE`, or from standard
input with `--ops -`. All ops apply, or none: one bad op leaves the file
unchanged. Exit code 0 means that the file was written (or checked, with
`--dry-run`). Exit code 1 means a refused edit: a broken rule, a changed
file, or a `--base-rev` that does not match. Exit code 2 means input that
cannot be used. The command writes one canvas file and no other file. It does
not commit.

`horsemen mcp` serves the two tools on standard input and output until the
input ends. `horsemen mcp install` registers the server with Claude Code and
Codex through their own commands (`claude mcp add`, `codex mcp add`);
`--dry-run` prints the commands and runs nothing. `horsemen mcp status` asks
each host if the server is registered. These two commands change or read
agent settings, not project files.

`horsemen check` also reads `.horsemen/canvas/` and reports `canvas-invalid`,
`canvas-dangling-ref`, `canvas-media-too-large`, and the warning
`canvas-not-canonical`.

## Plans and compatibility

```sh
horsemen plan init /path/to/new-project --json
horsemen plan upgrade /path/to/project --json
horsemen plan update /path/to/project --changes changes.json --json > plan.json
horsemen plan export-patch /path/to/project --plan-file plan.json > review.patch
```

These commands never apply changes. Init identifies missing documents and
owner/provider inputs at the exact directory supplied. Upgrade proposes
STATUS→PROGRESS and legacy TECH/TECHSTACK→ANATOMY migration review, including both-file
reconciliation, without deleting or renaming content. Update takes the existing
`{"changes": [...]}` format: unique root `file`, exact `before`, `after`,
nonempty `evidence`, and optional `owner_agreement`. It preserves review gaps
for owner-controlled documents. Export revalidates source hashes, anchors and
proposed hashes before printing a unified patch. Shell redirection is the
caller's choice; never redirect onto an original document.

Existing `init/update/upgrade PATH --plan`, `export-patch PATH --plan-file FILE`
and `help` remain compatibility spellings. Their outputs and exit behavior
are unchanged, and none gains write behavior. They are omitted from the main
menu in favor of `plan` and `--help`. No caller was found that justified deleting
them. The original `python3 <skill>/scripts/horsemen.py` checker/hook entrypoint,
its return codes, caches and hook paths remain unchanged.

## Output and checks

JSON uses `schema_version: 1`, `command`, `status` and `report`. Named-record
results add `document`, `content`, `source_sha256`, `mode` and provider limits.
Updates add proposed content/hash. Modes distinguish `read_only`, `draft`,
and `local_update`; statuses distinguish `planned`, `updated`, `no_change`
and failures. After a save, validation can still report errors: `updated`
means bytes were saved, not that all document facts or formatting are valid.

Exit codes: 0 for a completed operation without validation errors, 1 for
validation errors, 2 for invalid input or operational failure. Legacy plans
retain exit 0 for a valid proposal even when its status is `needs_input` or
`conflict`; inspect that status. Syntax errors use argparse stderr; parsed
requests with `--json` return operational errors as JSON. Output may contain
private paths and content: keep it local.

From a checkout, replace `horsemen` with
`PYTHONPATH=horsemen/scripts python3 -B -m horsemen_core`. Run
`python3 -B horsemen/scripts/test_cli.py` for subprocess tests, or set
`HORSEMEN_CLI` to an isolated installed executable. Run
`python3 -B horsemen/scripts/test_documents.py` for simulated storage, race
and read-back failures. Run `python3 -B horsemen/scripts/test_canvas_cli.py`
for the canvas commands; it uses fake host commands and never calls a real
agent host. The full repository verifier covers source, installed
wheel, skill archive and legacy hooks; see the root CONTRIBUTING.md.

No live provider writes are used in QA. No release, merge, global installation,
background worker, new provider registry or credential store is part of this CLI.
