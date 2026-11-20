# Hooks and the check script

The hooks detect drift. They do not write records. The agent decides what to
change, and the user confirms intent changes. Hosts without hooks (or with the
hooks not installed) still work: the project `AGENTS.md` entrypoint and the
skill instructions carry the same rules.

All behavior lives in one dependency-free script, `scripts/horsemen.py`
(Python 3.9 or later, Git optional).

| Command | Used by | Result |
| --- | --- | --- |
| `horsemen.py check [DIR] [--json]` | Agents and people, after record edits | Health report. Exit 1 when errors exist |
| `horsemen.py hook session-start [--pointer]` | `SessionStart` hook | Compact orientation for the agent; with `--pointer`, a pointer of 700 characters or less |
| `horsemen.py hook stop` | `Stop` hook | Blocks only when it finds new record drift, and names the drift |
| `horsemen.py hooks install\|uninstall\|status` | People, once per machine | Installs, removes, or checks the two hooks and their script targets for Claude Code and Codex. `install --pointer` selects [pointer mode](#pointer-mode) |
| `horsemen.py show`, `canvas apply`, `mcp` | Agents and people | Short reads, canvas edits, and the local MCP server; see [canvases](canvas.md) |
| `scripts/e2e.py --output FILE` | Maintainers | Scenario validation with a JSON receipt |

## Hook contract

Both Claude Code and Codex read hook JSON from stdin and accept the same
output. The script uses only these supported fields:

- `SessionStart` prints `{"hookSpecificOutput": {"hookEventName":
  "SessionStart", "additionalContext": "..."}}`. It runs at startup, resume,
  clear, and after compaction, so orientation survives a compacted context.
- `Stop` prints `{"decision": "block", "reason": "..."}` only when it finds
  new record drift. Otherwise it prints nothing. A block makes the agent take
  one more turn, and hosts such as T3 Code and the Claude Code app show that
  turn as the final reply and fold the task report away. So a block asks the
  agent to end with its full task report again. When the input has
  `stop_hook_active: true`, the script never blocks. This prevents recursion.
  The routine end-of-task review comes from the session-start text, and the
  agent must check the records before its final reply even when the host does
  not run hooks.

### What session-start injects

1. The project root and which records exist.
   It also reminds the agent to review all four records at task end.
2. The PROGRESS snapshot: Latest day, before Historical ships/Upcoming roadmap;
   for legacy layouts, everything above the first dated log heading
   (summary, Next action, status table, Roadmap, and the Technical details
   toggle with evidence and Gates), capped at 60 whole lines and 3,000
   characters.
3. STRUCTURE's "Read before changing" section, when present.
   It does not inject VISION, BRAIN, the rest of STRUCTURE, or the log. If any
   injected part does not fit, the output says so and tells the agent to read
   the rest before acting. Legacy projects get an instruction to read
   STATUS.md before project work.
4. Up to six health lines, for example: commits since PROGRESS changed,
   missing paths in STRUCTURE, an undefined `Brain:` line, an unconfirmed
   vision, an old PROGRESS format, open questions, legacy file names.

A Git repository with no records gets one line: offer setup, do not start it.
A folder that is neither a project nor a Git repository gets nothing.

### Pointer mode

Pointer mode is a choice at install time: `hooks install --pointer`. Without
it, session start injects the text above, byte for byte as before. In pointer
mode, session start injects 700 characters or less, and the agent reads the
rest on demand with the `read` tool or `horsemen.py show`
(see [canvases](canvas.md)).

| Line | Rule |
| --- | --- |
| Root and records | Always. A root longer than 100 characters keeps its last 99 |
| Canvases | The names of the canvas files. No line when the project has none. Names that do not fit become `+N more`, then a count |
| Next action | The `Next action:` line of the PROGRESS snapshot. A line over 240 characters is cut with `…` |
| Gates | Always. In full when the gates have 300 characters or less. Longer gates become "Read progress#Gates before you act"; a gate is never cut. A snapshot without gates says so |
| STRUCTURE reading list | One line that names `structure#Read before changing`, when the section exists |
| Health | Up to three lines: canvas problems first, then the lines of the usual order |
| Read line | Always. It names the `read` tool and `horsemen show`, and asks for the review of the four records |

The gates are a `Gates:` line with its list, or the lines below a `Gates`
heading, in the PROGRESS snapshot. The root, the gates, and the read line
always stay. When the limit is near, the other lines go in this order:
health, canvases, next action, STRUCTURE reading list. A legacy project gets
the instruction to read STATUS.md before project work in place of the next
action and the gates.

### What stop checks

Stop does not ask for a routine review. Session-start text already tells the
agent to review VISION, BRAIN, PROGRESS, and STRUCTURE before it finishes,
including discussions and work in outside tools that local Git cannot see.
A routine block at every stop hid the task report in hosts that show only the
last turn. The review must not create edits, dates, or documents without a
changed fact.

At session start the script also saves a disposable baseline in the system
temp folder. When one is available, stop compares the project to it:

| Rule | Fires when | Asks the agent to |
| --- | --- | --- |
| Progress | Work commits (commits that touch files other than the records) exist after the last PROGRESS change, and PROGRESS has no uncommitted edits | Update PROGRESS, or say why no update is needed |
| Structure | A folder at depth 1 or 2 was added, removed, or renamed, and STRUCTURE did not change | Update STRUCTURE |
| Changelog | PROGRESS gained a `Shipped` bullet (including partly shipped), and CHANGELOG did not change (or does not exist) | Add the shipped part to CHANGELOG, creating the file if needed |
| Vision | VISION changed since the last VISION reminder | Reuse the owner's agreement, check README, PROGRESS, and BRAIN for conflicts, and log an agreed direction change |
| Publish | A record, or a file in `.horsemen/canvas/` or `.horsemen/media/`, changed in this session, and its content differs from the remote default branch (`origin/HEAD`, as of the last fetch). It counts uncommitted, unpushed, and unmerged edits. Projects without a remote default branch are skipped | Commit and push when the project's rules allow, so readers of GitHub, such as the hosted viewer, see the change |
| Lint | A record changed and `check` finds errors in it | Fix the listed errors |
| Canvas errors | A canvas file changed in this session and `check` finds errors in it | Correct the file; `canvas_edit` checks and formats it |
| Canvas card | A card on an unchanged canvas names a heading or file that was there at session start and is gone now | Repair the card with `canvas_edit` or `horsemen.py canvas apply` |

The two canvas rules run only in a project with files in `.horsemen/`. A
card that was broken before the session is not reported at stop; `check` and
the pointer's health line report it. A project without canvases gets the
same stop text as before.

Triggered rules go into one reminder under 1,200 characters, with the
review instructions and the request to end with the full task report. When the agent updates STRUCTURE
or CHANGELOG, the current tree or shipped list becomes the new baseline, so a
later move or release fires the rule again. An unchanged drift detail does
not repeat, and a stop without new drift does not block.
A later work commit or VISION edit can produce a new drift detail.

### Disposable state

- Location: `horsemen-hooks/` under Python's system temp folder, or the
  dedicated directory named by `HORSEMEN_STATE_DIR`. The directory is mode
  0700; cache files are mode 0600 and replaced atomically.
- Identity: a hash of the resolved project root and full session ID; if the
  ID is absent, use the transcript path, then a stable project fallback.
  The script does not read the transcript. Projects and IDs that share
  punctuation or a long prefix cannot overwrite each other's cache.
- Fields: format version, project root, whether Git was found, baseline
  HEAD and time, record hashes, shipped item names, folder names, a short
  hash for each file in `.horsemen/canvas/` and `.horsemen/media/` (200 files
  at most), the canvas problems at session start, and prior drift reminder
  fingerprints. No owner choices or permissions live here. A cache from an
  earlier release has no canvas fields; then stop skips the canvas rules.
- Startup and clear reset the baseline. Resume, compaction, and an omitted
  source preserve a valid baseline. Invalid or older cache formats are
  rebuilt at session start. Files unused for seven days are removed.
- A missing or unwritable cache skips drift detail only; orientation still
  works and the hook exits without a block. Deleting the cache changes no project facts.
- Without a session ID or transcript path, concurrent sessions for one
  project share a fallback cache. Drift detail can be less precise.

All Git calls in one hook run share a 3.5-second budget (hosts allow 5).
When the budget runs out, optional checks are skipped and the hook still
prints its output.

## Failure modes

These cases were listed before the script was written. `scripts/e2e.py`
covers each one marked with a test ID.

### Session start

| ID | Failure mode | Required behavior |
| --- | --- | --- |
| F1 | Runs in a home folder or other non-project folder | Print nothing |
| F2 | A parent folder has only an `AGENTS.md` (a workspace root) | Do not treat it as a project |
| F3 | PROGRESS is very long | Output stays under 60 snapshot lines and 4 KB |
| F4 | PROGRESS has no dated headings | Snapshot still capped |
| F5 | Only legacy `STATUS.md` exists | Treat it as PROGRESS, do not inject its body, flag migration |
| F6 | Both `STATUS.md` and `PROGRESS.md` exist | Flag two owners for one concern |
| F7 | Some records are missing | List the missing records |
| F8 | Git repository with no records | One-line setup offer only |
| F9 | Records without Git | Work without drift counts |
| F10 | Git missing, slow, or failing | No crash; every Git call has a timeout |
| F11 | Empty or malformed stdin | Fall back to the current folder; exit 0 |
| F12 | Records contain invalid UTF-8 | Read with replacement; no crash |
| F13 | Records are stale | Report commits since PROGRESS changed and missing STRUCTURE paths |
| F15 | Large repository | Finish in under 1 second; never walk the full tree |
| F16 | Template placeholders remain | Flag them |
| F19 | Nested project inside a repository | Nearest folder with a record wins |
| F3b | A snapshot line is too long to fit | Never cut silently; say the injection is incomplete |
| F5b | Legacy STATUS.md holds gates | Tell the agent to read it before project work |
| F20 | Git is slow | Shared time budget; output within the host deadline |
| F21 | STRUCTURE lists mandatory reading | Inject "Read before changing" |

### Stop

| ID | Failure mode | Required behavior |
| --- | --- | --- |
| T1 | A task ends without a commit or local edit, including discussion or work in the brain | Do not block; do not edit records. The session-start text asks for the review |
| T2 | The session baseline is absent, invalid, or expired | Exit cleanly without a block; skip unavailable drift details |
| T3 | Several tasks finish in one session | Block only for new drift at each stop; `stop_hook_active` prevents recursion |
| T4 | Only an uncommitted file changed | Do not block or claim it shipped |
| K1 | Session IDs differ only by punctuation or after a long shared prefix | Keep their caches separate |
| K2 | One session visits two project roots | Keep their baselines separate |
| K3 | The host omits a session ID | Use a stable project fallback, not a process ID |
| K4 | Resume or compaction has no source field | Preserve an existing valid baseline |
| K5 | A later commit or VISION edit follows an earlier reminder | Detect the new change |
| K6 | Cache contains project paths and hashes | Keep the directory private and files readable only by the owner |
| K7 | Cache is valid JSON but a Git revision, folder list, or shipped-item list has the wrong type | Discard the baseline and exit cleanly |
| I3 | Hooks exist but their script was removed | Status reports the missing script and exits nonzero |
| I4 | One of the two expected hook events is missing | Status reports the incomplete installation and exits nonzero |
| S1 | `stop_hook_active` is true | Never block |
| S2 | No baseline (hook installed mid-session) | Do not block |
| S3 | No commits and no record edits | Do not block; do not edit records |
| S4 | Work commits, PROGRESS unchanged | Block once with the progress reminder |
| S5 | Commits touch only records | Do not block |
| S6 | Folder added, removed, or renamed; STRUCTURE unchanged | Structure reminder |
| S7 | New `Shipped` bullet (including partly shipped); CHANGELOG unchanged | Changelog reminder |
| S8 | Edited record has lint errors | Lint reminder with the errors |
| S9 | VISION changed | One downstream-review reminder |
| S10 | Same drift at the next stop | Do not block again |
| S12 | Branch switched; baseline is not an ancestor of HEAD | Skip commit-based rules |
| S14 | Commits pulled from a remote | Ignore commits dated before the session |
| S16 | Output must be valid JSON for both hosts | One JSON object; reason under 1,200 characters |
| S17 | Any internal error | Exit 0 with no output |
| S18 | Untracked folder existed before the session | Not structure drift (found in live use) |
| S19 | Folder added after STRUCTURE was already updated once | Structure rule fires again |
| S20 | Second release after CHANGELOG was already updated once | Changelog rule fires again |
| S21 | New `Shipped` bullet in a project without CHANGELOG.md | Reminder to create CHANGELOG.md with the shipped part only |
| S22 | The session writes a canvas file that breaks a rule | Canvas errors reminder, one time for the same errors; no note for a valid or repaired file |
| S23 | The session renames a heading that a section card names | Canvas card reminder, one time; a card that was broken before the session is not reported |
| S24 | A canvas or media file changed and is not on the remote default branch | The Publish reminder names the file; binary media compares by Git object name |
| S25 | The cache is from a release before canvases | Exit cleanly without a block; the canvas rules are skipped |
| S26 | Any block | Ask the agent to end with its full task report again, because hosts show only the last turn |
| L1 | Hooks installed without `--pointer` (all installations before pointer mode) | Session start gives the same bytes as before, also in a project with canvases; stop gives its expected text in a project without canvases (S26 changed that text) |
| PT1 | Pointer mode in a healthy project | 700 characters or less; the root, the records, the next action, the read line, and the review request; no snapshot text |
| PT2 | Gates of 300 characters or less, as a `Gates:` line or below a `Gates` heading | The gates stay in full |
| PT3 | Gates over 300 characters | An instruction to read the gates before acting; no gate is cut |
| PT4 | A project without canvas files | No canvas line |
| PT5 | A long root path, 20 canvases with long names, a long next action, and many problems | Still 700 characters or less, with the gates, the record names, and the read line |
| PT6 | Pointer mode outside a project, or with malformed stdin | Print nothing; exit 0 |
| PT7 | Only legacy `STATUS.md` exists | The instruction to read it before project work |
| PT8 | STRUCTURE has a "Read before changing" section | One line that names the section to read |
| PT9 | More than three health findings | Three health lines at most, canvas problems first |
| PT10 | `hooks install --pointer`, then `hooks install` | Only the SessionStart command changes; `status` names pointer mode; a later install without the option gives the earlier commands |

### Check

| ID | Failure mode | Required behavior |
| --- | --- | --- |
| C1 | Required record missing | Error |
| C2 | Legacy record names (`STATUS.md`, old binding preamble) | Warning; both STATUS and PROGRESS is an error |
| C3 | PROGRESS has no `Updated:` date, a future date, an unknown status, or a `Shipped` item without evidence in the Technical details table | Error |
| C3b | Log headings out of order, duplicated, or in the future; more than 30 entries | Warning |
| C4 | VISION lacks a core section or a `Confirmed:` line | Warning |
| C4b | VISION holds engineering content (a code block or a file path) | Warning: it is a business document |
| C5 | STRUCTURE names a path (containing `/`) that does not exist | Error |
| C5b | A top-level entry is not mentioned in STRUCTURE | Warning |
| C6 | BRAIN has no `Brain:` line, or it says Undefined | Warning. `Brain: None` (all knowledge in the repository) is valid |
| C6b | BRAIN names a provider but has no Providers table | Warning |
| C6c | BRAIN lists a repository file as brain knowledge | Warning: repository files belong in STRUCTURE |
| C7 | `{{...}}` template placeholders remain | Warning |
| C9 | README or AGENTS.md does not link the four records | Warning |
| C15 | README.md is missing | Warning: every project has a README |
| C16 | README has no Install, Get started, Setup, Use, or Access section | Warning: README is VISION plus install, cut down |
| C17 | PROGRESS records shipped work and CHANGELOG.md is missing | Warning |
| C3k | `Partly shipped` item without evidence | Error, as for `Shipped` |
| C10 | CHANGELOG has a future date or planned-work words | Error for dates, warning for words |
| C11 | Broken relative link in a record | Error |
| C11b | URL-encoded local link (`my%20report.md`) | Decoded before checking |
| C3c | Old status table lacks Item or Date, or a row has the wrong width | Error |
| C3d | `Shipped` bullet of any age | Legacy layout retained; new layouts keep the latest day and preserve older outcomes in Historical ships |
| C3e | Escaped pipe inside an old-table cell | Parsed as text |
| P2 | PROGRESS uses a status table instead of status sections | Warning to migrate (`progress-legacy-format`); evidence still counts |
| P3 | Status bullet without a bold item name | Warning (`progress-item-unnamed`) |
| P4 | Code, paths, PR or issue numbers, or commit hashes outside a toggle | Warning (`progress-technical-in-body`) |
| P5 | `Shipped` or `Ready to ship` bullet dated in the future | Error |
| P6 | Indented sub-bullets under an item | Details, not items |
| P7 | `In progress` or `Ready to ship` bullet without a Technical details row | Warning |
| P8 | More than ten `Shipped` bullets | Warning (`shipped-list-long`) |
| P10 | No status section at all | Warning (`progress-no-state-table`) |
| V2 | VISION uses the old business-plan sections | Format warning (`vision-legacy-format`); preserve it unless a revision is requested or a direction change is agreed |
| C5c | A flat map line (`path    description`) names a missing path | Error |
| C12 | `Visibility: public` and a private link, email, or local path in any record | Error |
| C13 | Archived project whose open sections say `- Nothing right now.` | No format warning |
| C3f | PROGRESS in the old format (`State` column, Evidence in the main table, old labels) | Warning to migrate; old evidence still counts, old labels are not errors |
| C3g | A `<details>` toggle is not closed | Error: it hides the rest of the file on GitHub |
| C3h | No blank line after `</summary>` | Warning: GitHub does not render the Markdown inside |
| C3i | Dated heading carries a headline (`## 2026-11-02 · Paid launch`) | Parsed as a log date |
| C3j | Item names differ only in case, bold, or backticks between the two tables | Still matched |
| C5e | STRUCTURE Brain section names provider folders | Not checked as repository paths |
| C5f | BRAIN names a provider but STRUCTURE has no Brain section | Warning |
| C5g | A nested tree node does not exist at its full path (parent joined with child) | Error |
| C5h | Tree drawn with `├──`, `└──`, and `│` | Each node resolves to its parent's path |
| C5i | Tree drawn with indentation only | Same as C5h |
| C5j | The first tree line names the project folder (`my-app/`), even when the local clone or worktree has another name | Treated as the root, not as a path |
| C5k | Folder names with brackets (`[...locale]/`, `[slug].astro`) | Checked literally |
| C5l | Pattern nodes (`*.png`, `<slug>/`, `...`) | Skipped |
| C5m | A `mermaid` block in STRUCTURE | Not parsed as a tree |
| C5n | A file node under a file, or a node after a description with a slash | Only the first token of each line is a path |
| C18 | A canvas file in `.horsemen/canvas/` is valid and in canonical form | No finding; a project without canvases gets no new finding |
| C19 | A canvas file is valid but another tool wrote it in its own layout | Warning (`canvas-not-canonical`) |
| C20 | A canvas file is not JSON, has conflict markers, or breaks a format rule | Error (`canvas-invalid`) |
| C21 | A card names a heading or a file that is gone, or an edge end names no node | Error (`canvas-dangling-ref`) |
| C22 | A media file is over 1 MiB, or its content is not its type | Error (`canvas-media-too-large`, `canvas-invalid`) |
| C23 | A canvas file has a bad name, or the project has more than 20 canvas files | Error (`canvas-invalid`) |
| C24 | A canvas file or folder is a link out of the project | Error; the target is not read |
| I1 | Install on a config file with mode 0600 | Mode kept; new files created 0600 |
| I2 | Hook command and the macOS `/usr/bin/python3` stub | Use an absolute python3; never the stub |

## Install

The hooks call the installed runtime copy of the skill, not a source checkout.

```sh
python3 ~/.agents/skills/horsemen/scripts/horsemen.py hooks install
python3 ~/.agents/skills/horsemen/scripts/horsemen.py hooks status
python3 ~/.agents/skills/horsemen/scripts/horsemen.py hooks uninstall
```

`install` edits `~/.claude/settings.json` and `~/.codex/hooks.json`. It keeps
every other hook, replaces only its own entries, keeps each file's
permissions, and writes a one-time backup next to each file. Each hook
command tries an absolute `python3` (never the macOS `/usr/bin/python3`
stub) and exits silently when the script or Python is missing. Codex asks the user to trust new hooks before they run;
approve them in Codex. Hosts without hook support rely on `AGENTS.md`.

`install --pointer` selects [pointer mode](#pointer-mode) for session start.
Run `install` again without the option to go back; `status` prints
`SessionStart: pointer mode` when it is on. Pointer mode is useful when the
host has the Horsemen MCP server, or when the agent has a shell for
`horsemen.py show`.

`status` checks both expected events and the script path in the saved
commands. It exits 1 for a missing event, duplicate event, missing target,
or target it cannot verify. It does not prove the host enabled or trusted
the hooks. After installation, compare package bytes and executable modes
with source, run `status`, then exercise the configured commands against a
temporary project. A hook count alone is not proof of a working install.

## Limits

- The drift details see Git history and record content. They cannot see a
  deployment, a store release, or a meeting. The agent must still record
  those events.
- Structure drift covers folders at depth 1 and 2. A moved file inside an
  unchanged folder is not detected; `check` still catches its broken path in
  STRUCTURE.
- Stop reports canvas problems that the session made, not older ones. Run
  `check` after a canvas edit.
- Pointer mode finds gates in a `Gates:` line or below a `Gates` heading
  only. Gates in another form, such as a table cell, are not found; then the
  pointer says that the snapshot has no gates. Keep gates in one of the two
  forms before you select pointer mode.
- In pointer mode, an agent that does not read on demand sees less of
  PROGRESS than in the default mode.
- The check does not judge meaning. A VISION that contradicts PROGRESS needs
  the agent's review, which the vision rule requests.

## Quiet task reporting

Session and stop instructions tell the agent to perform record maintenance
silently. The user's actual task remains the subject of its report. Do not
append a Horsemen checklist or record-review receipt unless requested. Still
ask required permission questions and surface actionable blockers. Hook output
is internal guidance, not a user-facing update to paste into the reply.

## TECHSTACK companion and proactive brain care

TECHSTACK.md is tracked as a companion, not a fifth record or project-root marker.
`check` warns with `techstack-missing` when an existing project lacks it. Link,
placeholder and public-locator checks also cover TECHSTACK. The inventory grants
no permission. Stop guidance requests inspection of relevant brain originals
and TECHSTACK when its sources change. Hooks cannot verify provider content or
execute cleanup; the agent follows saved write and recovery rules.

Legacy TECH.md remains tracked for hashes, link/privacy checks and record-only
commit classification until migrated. It never satisfies the TECHSTACK presence
check, becomes a project marker, or triggers automatic rename/deletion.
