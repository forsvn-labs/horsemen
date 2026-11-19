# Progress

Updated: 2026-11-19 · Stage: live · Health: On track

## Latest day

<details open>
<summary>Latest day</summary>

Next action: Use the local workspace on real projects and note what to improve. Refresh existing skill installations before the next project update.

## Shipped

- **Visual workspace** (2026-11-19): A private local app shows each project as a canvas of its records. Each record opens in a peek with its own layout, a section outline, and a way to jump between records. It has six themes and reads GitHub through the existing sign-in. Available from main; run `python3 scripts/serve_gui.py`.

- **Shorter records** (2026-11-17): Horsemen edits changed prose before saving. New source installs include the rule.

### Technical details

| Item | Evidence |
| --- | --- |
| Shorter records | [Pre-save edit](horsemen/references/sync.md#pre-save-edit) and the distribution regression test. The source, wheel, and packaged skill checks passed locally. |
| Visual workspace | [Prototype](docs/show-me/product-gui/prototype.html), [canvas options](docs/show-me/product-gui/index.html), and [GUI requirements](docs/product/gui-requirements.md). Demo checks passed at desktop, tablet, and phone sizes; full repository verification passed locally. Run [the demo checks](docs/show-me/product-gui/verify.py) or the verification command in CONTRIBUTING.md. The owner chose a private local app first. Run `python3 scripts/serve_gui.py`; [setup and limits](web/README.md). Reader tests and fixture browser checks passed for discovery, source views, missing records, access failures, saved layouts, and clearing old content. Full source, wheel, and packaged-skill verification passed locally. Search and preview tests passed, including selection during an active scan. Live timing checks confirmed faster repeat loads; no private records were saved as test output. Linked-document tests cover source-authorized reads, nested navigation, external links, and visual overviews. Canvas rule and browser checks cover selection, group movement, drag cancellation, zoom, and shared branch collapse. Card controls passed mouse, keyboard, and list-view checks without selecting, dragging, or opening the card. Arrangement rule tests and browser checks found no overlap for nested and parallel branches. Browser checks passed in the light and dark themes; see [the icon system](docs/product/icon-system.md). Markdown, theme contrast, peek navigation, and reload checks passed locally. Merged in [PR #5](https://github.com/hungv47/horsemen/pull/5); CI passed on Linux and macOS. |

### Gates

Existing installations do not change until refreshed. The visual workspace is a local source preview. Public sharing and hosted sign-in are not built.

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

- Hosted viewer at horsemen.forsvn.com: read-only, reads records from Git, and stores none of their data. A plan with GitHub App sign-in and no database waits for owner approval.
- Gather feedback on the existing skill and CLI while developing the visual workspace.
- Safe automatic writes remain separate future work, with no promised date.

</details>
