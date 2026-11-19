# Changelog

## 2026-11-19

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
