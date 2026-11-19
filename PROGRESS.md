# Progress

Updated: 2026-11-19 · Stage: live · Health: On track

## Latest day

<details open>
<summary>Latest day</summary>

Next action: Review the visual workspace pull request. Then refresh existing skill installations before the next project update.

## Shipped

- **Shorter records** (2026-11-17): Horsemen edits changed prose before saving. New source installs include the rule.

## In progress

- **Visual workspace**: The local app now uses an existing GitHub sign-in to discover projects and load their records. The canvas supports project search, record-specific previews, and PR evidence links. Canvas controls now separate selection from opening: group dragging, area selection, Hand/Space pan, and modified-wheel zoom. Linked branches can expand or collapse directly from each card. Linked cards that appear now take free space beside their parent, so cards do not overlap. The interface has a new engraved identity based on the four riders, with six themes, local fonts, and original icons. The peek now lists the records and the sections of the open page, and each overview has numbered sections and stated facts. A jump field reaches each project, record, view, and theme. Each artifact now has a visual overview. Connected repository documents open inside the peek, with a Back path, and can expand onto the canvas. External documents remain source links. Projects appear during discovery; parallel reads and a memory cache reduce loading delays. A live account scan and record read passed locally. Public sharing and hosted sign-in remain pending.

### Technical details

| Item | Evidence |
| --- | --- |
| Shorter records | [Pre-save edit](horsemen/references/sync.md#pre-save-edit) and the distribution regression test. The source, wheel, and packaged skill checks passed locally. |
| Visual workspace | [Prototype](docs/show-me/product-gui/prototype.html), [canvas options](docs/show-me/product-gui/index.html), and [GUI requirements](docs/product/gui-requirements.md). Demo checks passed at desktop, tablet, and phone sizes; full repository verification passed locally. Run [the demo checks](docs/show-me/product-gui/verify.py) or the verification command in CONTRIBUTING.md. The owner chose a private local app first. Run `python3 scripts/serve_gui.py`; [setup and limits](web/README.md). Reader tests and fixture browser checks passed for discovery, source views, missing records, access failures, saved layouts, and clearing old content. Full source, wheel, and packaged-skill verification passed locally. Search and preview tests passed, including selection during an active scan. Live timing checks confirmed faster repeat loads; no private records were saved as test output. Linked-document tests cover source-authorized reads, nested navigation, external links, and visual overviews. Canvas rule and browser checks cover selection, group movement, drag cancellation, zoom, and shared branch collapse. Card controls passed mouse, keyboard, and list-view checks without selecting, dragging, or opening the card. Arrangement rule tests and browser checks found no overlap for nested and parallel branches. Browser checks passed in the light and dark themes; see [the icon system](docs/product/icon-system.md). Markdown, theme contrast, peek navigation, and reload checks passed locally. No public GUI release has been made. |

### Gates

Existing installations do not change until refreshed. The visual workspace is a local source preview in review; it has no public GUI release.

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

- Use the local GitHub reader, then decide the scope for hosted sign-in and public sharing.
- Gather feedback on the existing skill and CLI while developing the visual workspace.
- Safe automatic writes remain separate future work, with no promised date.

</details>
