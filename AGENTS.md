# Working on Horsemen

Start with [BRAIN.md](BRAIN.md), the project map. Open the records you need:

- [VISION.md](VISION.md): purpose, audience, and direction.
- [PROGRESS.md](PROGRESS.md): next action, gates, and delivery evidence.
- [ANATOMY.md](ANATOMY.md): architecture, tech stack, tests, and release steps.

Supporting standards: [DESIGN.md](DESIGN.md) for the viewer, [README.md](README.md)
for setup, and [CHANGELOG.md](CHANGELOG.md) for shipped changes. Use the
[Horsemen skill](horsemen/SKILL.md). Keep owner direction and permissions intact.

Horsemen is one project with an agent skill and a Python CLI. Keep shared
logic in `horsemen/scripts/horsemen_core`; keep the legacy script and hooks
compatible. Add regression tests before fixes. Run the verification command
in CONTRIBUTING.md. Do not claim publication or installation from a build.

This repository is public. Use fictional examples and public source links.
Never copy personal project records, account details, or private histories.
Update records when facts change; unchanged facts do not need date edits.
