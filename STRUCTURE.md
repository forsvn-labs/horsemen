# Structure

One repository owns the agent skill, CLI, shared checks, and release verification.

## Map

```text
./
├── web/                   GitHub canvas (local and hosted), Markdown, diagrams (vendored Mermaid in web/vendor/), images, themes, previews, and setup guide
│   ├── assets/            Bundled fonts with their notice, icons, seals, and app icon
│   ├── hosted-reader.js   Browser port of the Python GitHub reader, for hosted mode
│   └── hosted.js          Hosted mode: proxy reads, sign-out, and live commit checks
├── worker/                Cloudflare Worker for horsemen.forsvn.com: GitHub App sign-in and read-only proxy
├── docs/state-machines.md  Local reader lifecycle and failure coverage
├── docs/product/           GUI requirements, artifact views, icon system, design audit, release boundaries, and the canvas workspace proposal with its file schema
├── docs/show-me/product-gui/ Interactive design, Excalidraw, and demo checks
├── docs/show-me/canvas-workspace/ Canvas workspace mock, fictional fixture, and fixture check (proposal)
├── PRODUCT.md              GUI context and explicit prototype assumptions
├── assets/                 README cover and provenance notes
├── favicon.png             Project icon
├── horsemen/               Installable agent skill
│   ├── SKILL.md            Agent entry point
│   ├── CLI.md              Executable usage and limits
│   ├── REVIEW.md           Design decisions and remaining boundaries
│   ├── references/         Templates and focused workflows
│   └── scripts/            Compatibility hooks, provider helpers, tests
│       └── horsemen_core/  Shared checker, CLI, local editor, GitHub reader, canvas format (`canvas.py`), agent tools (`agent_tools.py`), and local MCP server (`mcp.py`)
├── scripts/                Build and end-to-end verification
├── tests/                  Distribution, GUI, canvas format, agent tool, and MCP server tests
│   └── fixtures/canvas/    Shared canvas cases for the Python and JavaScript readers, with a fictional project
├── pyproject.toml          CLI packaging; version comes from shared source
├── CONTRIBUTING.md         Setup, verification, and release procedure
├── .impeccable/            Impeccable design-check settings (one intended-colour exception)
└── .github/workflows/      Linux and macOS verification
```

## Read before changing

- [CONTRIBUTING.md](CONTRIBUTING.md) for tests and artifacts.
- [horsemen/SKILL.md](horsemen/SKILL.md) for the record contract.
- [horsemen/references/cli.md](horsemen/references/cli.md) for interface limits.

## Commands

- Run local GUI: `python3 scripts/serve_gui.py`; see [setup and limits](web/README.md).
- Hosted viewer tests: `node --test tests/test_hosted_reader.cjs worker/test/worker.test.js`.
- Hosted browser check: `python3 scripts/test_hosted_e2e.py --output /tmp/horsemen-hosted-check`.
- Hosted speed benchmark: `python3 scripts/bench_hosted.py --repos 80 --latency 150 --output /tmp/horsemen-bench`.
- Deploy hosted viewer: `cd worker && bunx wrangler deploy`; see [deploy and limits](worker/README.md).
- Canvas rule checks: `node tests/test_canvas_state.cjs`.
- Canvas format cases: `python3 -B -m unittest tests.test_canvas_format`; add `HORSEMEN_SCHEMA_CHECK=1` to compare with the JSON Schema (needs `uvx`). The [case contract](tests/fixtures/canvas/README.md) is for both languages.
- Agent tool tests: `python3 -B -m unittest tests.test_canvas_edit tests.test_canvas_read tests.test_mcp_server` and `python3 -B horsemen/scripts/test_canvas_cli.py`.
- Read a workspace with few tokens: `PYTHONPATH=horsemen/scripts python3 -B -m horsemen_core show`; edit a canvas: `... canvas apply NAME --ops FILE`; see the [canvas guide](horsemen/references/canvas.md).
- Run the local MCP server: `python3 -B horsemen/scripts/horsemen.py mcp` (stdio). `mcp install` changes agent settings; use it only for your own setup.
- Canvas proposal fixture check: `python3 docs/show-me/canvas-workspace/check.py --schema` (needs `uvx` for the schema step).
- Preview checks: `node tests/test_gui_previews.cjs`.
- Artifact view checks: `node tests/test_gui_views.cjs`.
- Browser check: `python3 scripts/test_gui_e2e.py --output /tmp/horsemen-gui-check`.
- Verify: `.venv/bin/python -B scripts/verify.py --output /tmp/horsemen-verification`.
- Read one record: `PYTHONPATH=horsemen/scripts python3 -B -m horsemen_core brain --json`.
- Update one record: see [exact edit input and exclusive-writer contract](horsemen/CLI.md#update-exactly-one-record).
- Check records: `python3 -B horsemen/scripts/horsemen.py check .`.
- Run CLI: `PYTHONPATH=horsemen/scripts python3 -B -m horsemen_core --help`.

Installed skills and virtual environments are outputs, not authoring sources.
The prior private collection retains its history; it points here for future work.

## Brain map

No external provider is configured. [BRAIN.md](BRAIN.md) owns that boundary.
