# Changelog

## 2026-11-21

- Fixed the Editorial theme: the paper grain behind the canvas now loads on horsemen.forsvn.com. It was an inline image that the content security policy blocked. [PR #47](https://github.com/hungv47/horsemen/pull/47).

## 2026-11-20

- When the default branch is protected, a canvas save goes to the branch `horsemen/canvas`, and the edit bar links a pull request. Before, the save failed. [PR #44](https://github.com/hungv47/horsemen/pull/44).

- In canvas edit mode, drop or paste an image, a CSV or TSV table, or a web address. One save is one commit with the canvas file and its new files in `.horsemen/media/`; a public repository asks for confirmation first. [PR #45](https://github.com/hungv47/horsemen/pull/45).

- New app icon and favicon, Junction: four connected tiles for the core records. [PR #43](https://github.com/hungv47/horsemen/pull/43).

- People can edit canvases on horsemen.forsvn.com and save each change as one commit by them, through a second, optional GitHub App, Horsemen Editor. Reading still needs only the viewer app. [Hosted viewer](worker/README.md). [PR #41](https://github.com/hungv47/horsemen/pull/41).

- Canvas link cards for YouTube, Vimeo, Loom, Figma, and Google Docs, Sheets, and Slides load a sandboxed player after a click; nothing loads before. CSV and TSV files on a canvas show as tables. The content security policy allows frames from these five player origins only. [PR #39](https://github.com/hungv47/horsemen/pull/39).

- The Stop hook blocks only when it finds new record drift, and then asks the agent to end with its full task report again. Before, it blocked at every stop, and hosts that show only the last turn hid the task report. [PR #38](https://github.com/hungv47/horsemen/pull/38).

- `hooks install --pointer` selects a short session start for agents: the next action and the gates in 700 characters or less. The Stop hook now reports a canvas that the session broke and canvas files that are not pushed. Refresh your installation to get it. [Hooks](horsemen/references/hooks.md#pointer-mode). [PR #37](https://github.com/hungv47/horsemen/pull/37).

## 2026-11-19

- Agents can read and change canvases with few tokens. `horsemen show` prints an index, a section, or a canvas outline, and `horsemen canvas apply` checks and writes a canvas file. `horsemen mcp install` gives Claude Code and Codex the same two tools, `read` and `canvas_edit`, through a local server. Refresh your installation to get it. [Canvas guide](horsemen/references/canvas.md). [PR #32](https://github.com/hungv47/horsemen/pull/32).

- The viewer shows canvas files (`.horsemen/canvas/*.canvas`): boards in the sidebar, and notes, images, link cards, groups, and connectors on the canvas of a record. A file that is not valid shows a message and the generated canvas. Read-only. See the [roadmap board of this project](https://horsemen.forsvn.com/hungv47/horsemen?canvas=roadmap). [PR #33](https://github.com/hungv47/horsemen/pull/33).

- Each record now opens as a canvas. The sidebar has a project switcher and a list of canvases; each section of a record is a card, and a card opens the reading view at that section. Links such as `horsemen.forsvn.com/owner/repo?canvas=progress&node=s-shipped` open one canvas at one card. [Design](docs/product/canvas-workspace.md). [PR #30](https://github.com/hungv47/horsemen/pull/30).

- Records now show Mermaid diagrams and charts in the colours of the active theme, with a View code toggle. A diagram that cannot be drawn shows its code and the reason. Images stored in the repository show in place when a record links to them; external images stay links. Works in the hosted viewer and the local app. [Hosted viewer](worker/README.md#how-it-works). [PR #27](https://github.com/hungv47/horsemen/pull/27).

- Public repositories open without sign-in. Anyone can read the canvas at a link such as [horsemen.forsvn.com/hungv47/horsemen](https://horsemen.forsvn.com/hungv47/horsemen). Private repositories still need sign-in, and nothing is stored. [PR #25](https://github.com/hungv47/horsemen/pull/25), [PR #26](https://github.com/hungv47/horsemen/pull/26).

- Added eight style themes with a live gallery in the account menu and Jump: Engraved (default, with its six palettes), Modern, Editorial, Terminal, Swiss, Blueprint, Soft, and High contrast. Each theme has its own fonts, shapes, spacing, and colours, and loads only its own fonts. [PR #20](https://github.com/hungv47/horsemen/pull/20).

- Made the workspace calm. The home shows the project list, one account menu, Jump, and Canvas or List; other tools moved to the menu, Jump, or keyboard shortcuts. Each record opens as one reading column, and Progress starts with the next action, then current work and shipped work by day. [Artifact views](docs/product/artifact-views.md). [PR #18](https://github.com/hungv47/horsemen/pull/18).

- Added share links to the hosted viewer. Each project and record has a readable link, such as `horsemen.forsvn.com/owner/repo?record=progress`, and a Copy link button. People with GitHub access to the repository sign in and open the same record. Links carry no data. [PR #16](https://github.com/hungv47/horsemen/pull/16).

- The Stop hook now reminds an agent to commit and push a record it changed when the change has not reached the remote default branch, so the hosted viewer shows it. Refresh your installation to get it: `npx skills add hungv47/horsemen --skill horsemen`. [Hooks](horsemen/references/hooks.md). [PR #14](https://github.com/hungv47/horsemen/pull/14).

- Added type sets for easier reading: Engraved (default), Modern, and System. Choose one from the theme button or Ctrl/Cmd + K. Fixed the Impeccable design audit findings for small text, focus, and phone layout. [Design audit](docs/product/design-audit.md). [PR #10](https://github.com/hungv47/horsemen/pull/10).

- Made hosted reloads fast. A reload shows your projects at once from a saved list of repository names, paths, and revisions, then checks for changes in the background. The list never holds record text; sign-out removes it. [PR #9](https://github.com/hungv47/horsemen/pull/9).

- Launched the hosted viewer at horsemen.forsvn.com. Sign in with GitHub, choose repositories, and read your Horsemen projects. It is read-only and stores no project data on the server. Open projects update when a new commit lands. [Setup and limits](worker/README.md). [PR #6](https://github.com/hungv47/horsemen/pull/6).

- Each record type now opens in its own view. Progress groups work by day on a status board with proof links; Changelog is a release timeline; Vision, Brain, Structure, Tech stack, and README get a brief, library, map, cards, or guide. Each view has a list layout. Live on horsemen.forsvn.com and in the local app. [Artifact views](docs/product/artifact-views.md). [PR #7](https://github.com/hungv47/horsemen/pull/7).

- Added a private local visual workspace: a canvas of each project's records, a peek with a layout for each record, section and record navigation, a jump field, and six themes. It runs from a source checkout and reads GitHub through the local sign-in. It is not a hosted service and has no public sharing. [Setup and limits](web/README.md). [PR #5](https://github.com/hungv47/horsemen/pull/5).

## 2026-11-17

- Horsemen now edits new and changed prose before saving. It uses `no-ai-slop` when available and a bundled checklist otherwise.

## 2026-11-13

- Added direct brain, vision, structure and status commands with read-only reports and explicit single-record local updates. Grouped planning tools under plan while keeping legacy command aliases. [PR #1](https://github.com/hungv47/horsemen/pull/1).

- Restored the original approved cover unchanged and corrected its provenance notes.

- Added a README cover and installation through the skills.sh CLI.

- Published one public MIT project for the Horsemen agent skill and CLI.
- Shared source and version, a self-contained skill bundle, and a CLI wheel.
- One verification command tests source use, installed CLI use, and unpacked hooks.
- Preserved the existing hook entry point and read-only CLI behavior.

Source: [Horsemen](https://github.com/hungv47/horsemen). This is an alpha source
publication, not a PyPI release or an update to existing global installations.
