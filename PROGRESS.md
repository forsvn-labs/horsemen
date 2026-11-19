# Progress

Updated: 2026-11-19 · Stage: live · Health: On track

## Latest day

<details open>
<summary>Latest day</summary>

Next action: Use the hosted viewer on real projects and note what to improve; the open audit items are in docs/product/design-audit.md.

## Shipped

- **Share links** (2026-11-19): Each project and record on horsemen.forsvn.com has a readable link, such as `/owner/repo?record=progress`, and a Copy link button. People with GitHub access to the repository open the same record after sign-in. Live on horsemen.forsvn.com.

- **Publish reminder** (2026-11-19): When an agent changes a record but the change has not reached the remote default branch, the Stop hook asks it to commit and push. Then the hosted viewer shows the update. Available from main; other installations get it after a refresh.

- **Readable type and design audit** (2026-11-19): The workspace now has three type sets: Engraved (default), Modern, and System. Choose one from the theme button or Ctrl/Cmd + K. Small labels are larger, phones open in List view, and keyboard focus is easier to see. The audit lists the fixes and the larger ideas still open. Live on horsemen.forsvn.com.

- **Faster hosted loading** (2026-11-19): A reload shows your projects at once from a saved list of repository names and paths, then checks for changes in the background. A first visit reads more repositories at the same time. Live on horsemen.forsvn.com.

- **Hosted viewer** (2026-11-19): horsemen.forsvn.com is live. People sign in with GitHub, choose repositories, and read their projects. Nothing is stored on the server. An open project updates when a new commit lands.

- **Views for each record type** (2026-11-19): Each record opens in a layout made for it. Progress groups work by day on a status board with proof links; other records get a brief, library, map, timeline, cards, or guide. Each type also has a list layout. Live on horsemen.forsvn.com and in the local app from main.

- **Visual workspace** (2026-11-19): A private local app shows each project as a canvas of its records. Each record opens in a peek with its own layout, a section outline, and a way to jump between records. It has six themes and reads GitHub through the existing sign-in. Available from main; run `python3 scripts/serve_gui.py`.

- **Shorter records** (2026-11-17): Horsemen edits changed prose before saving. New source installs include the rule.

## In progress

- **Calm workspace** (started 2026-11-19): The owner asked for a simpler screen and better record views. The workspace now shows few controls: the project list, one account menu, Jump, and Canvas or List. Cards show the record name and a few key lines. A record opens as one reading column; Progress starts with the next action, then the work now, then shipped work by day. Waits for owner review; not merged or deployed.

### Technical details

| Item | Evidence |
| --- | --- |
| Shorter records | [Pre-save edit](horsemen/references/sync.md#pre-save-edit) and the distribution regression test. The source, wheel, and packaged skill checks passed locally. |
| Hosted viewer | Merged in [PR #6](https://github.com/hungv47/horsemen/pull/6) and deployed from main; the live files match main, `/healthz` reports ok, and the live sign-in redirect was checked. Reader parity and Worker tests passed, and the hosted browser check passed against a fake GitHub: sign-in, project load, live update, and sign-out. Full verification passed locally. See [deploy and limits](worker/README.md). The owner signed in with a real account and saw the projects load on 2026-11-19. |
| Faster hosted loading | Benchmark with 80 repositories and 150 ms GitHub delay (`scripts/bench_hosted.py`): first project on reload 2.1 s to 0.36 s; first visit 2.2 s to 1.9 s; discovery 8.9 s to 5.9 s. Reader, Worker, and browser checks pass. Merged in [PR #9](https://github.com/hungv47/horsemen/pull/9) after CI passed; deployed from main, and the live files match main. |
| Share links | Link, Worker, and browser checks pass: a signed-out visitor returns to the shared record after sign-in; sign-in never redirects outside the app; a repository without access shows a clear message. Merged in [PR #16](https://github.com/hungv47/horsemen/pull/16) after CI passed; deployed from main, the live files match main, and a live share link keeps its target through sign-in. |
| Publish reminder | Hook scenario S20 passes: uncommitted and unpushed record edits fire once, published edits and repositories without a remote do not. All 150 hook scenarios and full verification passed locally. Merged in [PR #14](https://github.com/hungv47/horsemen/pull/14) after CI passed. The owner's global skill now installs from this repository and matches main; the Claude Code and Codex hooks run it. |
| Calm workspace | [Design audit, minimal pass](docs/product/design-audit.md#minimal-pass-2026-11-19) and [artifact views](docs/product/artifact-views.md). Impeccable critique went from 27/40 to 31/40; the rendered-page detector went from 2 findings to 0 at desktop, tablet, and phone width. View, preview, theme, canvas, Worker, fixture browser, and hosted browser checks passed locally, and full verification passed. |
| Readable type and design audit | [Design audit](docs/product/design-audit.md). Theme and type tests, canvas rule tests, Worker tests, the fixture browser check, and the hosted browser check passed locally. Not merged or deployed. Squash-merged in [PR #10](https://github.com/hungv47/horsemen/pull/10) after CI passed; deployed from main, and the live files match main. |
| Views for each record type | [Artifact views](docs/product/artifact-views.md). View tests (`node tests/test_gui_views.cjs`) and the fixture browser check passed locally at desktop and phone width; full repository verification passed locally. Merged in [PR #7](https://github.com/hungv47/horsemen/pull/7) after CI passed on Linux and macOS; deployed from main, and the live files match main. |
| Visual workspace | [Prototype](docs/show-me/product-gui/prototype.html), [canvas options](docs/show-me/product-gui/index.html), and [GUI requirements](docs/product/gui-requirements.md). Demo checks passed at desktop, tablet, and phone sizes; full repository verification passed locally. Run [the demo checks](docs/show-me/product-gui/verify.py) or the verification command in CONTRIBUTING.md. The owner chose a private local app first. Run `python3 scripts/serve_gui.py`; [setup and limits](web/README.md). Reader tests and fixture browser checks passed for discovery, source views, missing records, access failures, saved layouts, and clearing old content. Full source, wheel, and packaged-skill verification passed locally. Search and preview tests passed, including selection during an active scan. Live timing checks confirmed faster repeat loads; no private records were saved as test output. Linked-document tests cover source-authorized reads, nested navigation, external links, and visual overviews. Canvas rule and browser checks cover selection, group movement, drag cancellation, zoom, and shared branch collapse. Card controls passed mouse, keyboard, and list-view checks without selecting, dragging, or opening the card. Arrangement rule tests and browser checks found no overlap for nested and parallel branches. Browser checks passed in the light and dark themes; see [the icon system](docs/product/icon-system.md). Markdown, theme contrast, peek navigation, and reload checks passed locally. Merged in [PR #5](https://github.com/hungv47/horsemen/pull/5); CI passed on Linux and macOS. |

### Gates

Existing installations do not change until refreshed. The local workspace stays a source preview. The hosted viewer is read-only and stores no project data. Public sharing is not built.

</details>

## Historical ships

<details>
<summary>Historical ships</summary>

### 2026-11-13

- **Direct record commands** (2026-11-13): Brain, vision, structure and status have read-only reports and explicit local updates. Whole-project checks remain; planning tools share one menu. Available from main through the documented source installation.

- **Easy installation and a project cover** (2026-11-13): The README starts with the skills.sh install command and the original owner-approved cover.

- **One Horsemen project** (2026-11-13): Published source, one version, clear setup, and verification for both ways to use it.

#### Decisions

- Public repository and MIT license confirmed by the owner on 2026-11-13.
- Preserve private history in the original collection; publish only the checked source.

#### Technical details

| Item | Evidence |
| --- | --- |
| Direct record commands | [PR #1](https://github.com/hungv47/horsemen/pull/1), merged as [b9a9e5a](https://github.com/hungv47/horsemen/commit/b9a9e5a0538ddf03c72878d44d8464c23e0338b2). All four PR checks passed on Linux/macOS and Python 3.10/3.14. |
| Easy installation and a project cover | [README](README.md); skills CLI discovery and a temporary Codex installation matched the source; [original cover and verified checksum](assets/README.md). |
| One Horsemen project | [Public source](https://github.com/hungv47/horsemen) is available. Source, installed CLI, and unpacked-skill checks passed locally on 2026-11-13. Reproduce with [CONTRIBUTING.md](CONTRIBUTING.md). The private skills collection now points here. |

Existing installed copies are unchanged.

#### Command review evidence

- Full local verification passed on 2026-11-13: source tests, installed CLI,
  packaged skill and legacy hooks. Added coverage for each record, exact-edit
  validation, isolation, legacy callers and configured knowledge routes;
  simulated storage and read-back failures use disposable files. Reproduce
  with CONTRIBUTING.md. Remote main checks are published in Actions.
- Local writes require the caller to exclude other editors. Provider originals
  still use their authorized host workflow; no live provider writes were tested.

#### Gates

- Local checks pass. Cross-platform results are visible in [Actions](https://github.com/hungv47/horsemen/actions).
- Batch application and live Drive saves remain unavailable. Explicit local single-record updates are available from main.

Earlier personal installations are not public releases of this repository.

</details>

## Upcoming roadmap

<details>
<summary>Upcoming roadmap</summary>

- Hosted viewer next steps: branch and PR views. Links for people without GitHub access come later and will need stored share settings only.
- Gather feedback on the existing skill and CLI while developing the visual workspace.
- Safe automatic writes remain separate future work, with no promised date.

</details>
