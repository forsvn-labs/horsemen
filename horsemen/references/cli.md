# Standalone CLI and skill parity

The standalone CLI and skill share one source and checker. The skill adds
reasoning, evidence gathering and authorized host/provider workflows.

| Intent | Agent workflow | Executable CLI |
| --- | --- | --- |
| One record | `brain`, `vision`, `structure`, `status`: read/report by default | `horsemen brain [--path PATH] [--json]` (same for the other three) |
| Update one record | Explicit `COMMAND update`; only that original, within current permissions | `horsemen brain update --changes FILE --exclusive`: exact local edit; `--dry-run` only drafts |
| Validate all records | `check`: read-only | `horsemen check PATH [--json]` |
| Inspect project | `inspect`: connected review under BRAIN scope | `horsemen inspect PATH [--json]`: local records and Git only |
| Setup/migration | `init` / `upgrade`: gather missing input and preserve existing content | `horsemen plan init/upgrade PATH`: proposal only |
| Broad maintenance | `update` / `inspect-and-update`: explicit authorized scope | `horsemen plan update PATH --changes FILE`: proposal only |
| Review a batch | Review exact changes and permission gaps | `horsemen plan export-patch PATH --plan-file FILE`: stdout, no application |
| Read with few tokens | The `read` tool, or `horsemen.py show TARGET` | `horsemen show [TARGET] [--max-chars N] [--offset N] [--if-rev REV]` |
| Edit a canvas | The `canvas_edit` tool, in the three cases in [canvases](canvas.md) | `horsemen canvas apply NAME [--ops FILE] [--base-rev REV] [--dry-run]` |
| Give a host the tools | Only when the user asks | `horsemen mcp install`, `horsemen mcp status`; `horsemen mcp` runs the server |
| Diagram | Existing Mermaid/show-me-bro workflows | Not implemented |
| Help | Menu without project reads | `horsemen --help` |

Named-record commands never imply bulk sync or companion updates. Default
checks concern only that document; use whole-project `check` for cross-record
rules. `status` refers to PROGRESS.md, or legacy STATUS.md, not a new record.
A BRAIN report does not prove that external originals or permissions are current.

## Local updates and provider limits

Local updates require one exact edit, a full source hash, evidence references
and an explicit exclusive-writer promise. BRAIN/VISION also require an owner
agreement reference. The agent must check actual current permissions; input
references cannot grant authority. The command does not reason about evidence,
interpret arbitrary provider policies or create missing content.

`--exclusive` requires no other editor or sync process to write the target.
The lock excludes other Horsemen writers, not arbitrary editors. Atomic file
replacement is not revision-conditional storage. Do not use local mode to
bypass a provider hold or update a mounted provider file. An unsupported
`--provider` fails without a local fallback. Provider updates still require
the existing authorized host and revision-aware adapter; no live connection
is added to the CLI. Drive Markdown writes remain unsupported.

## Canvas commands

`show`, `canvas apply`, and the MCP server use one implementation, so each
gives the same text and the same limits; see [canvases](canvas.md). `show`
reads records and canvas files only. `canvas apply` writes one file in
`.horsemen/canvas/` and nothing else; it does not commit, and it does not
use the exclusive-writer contract of record updates. It refuses the write
when the file changed after it was read. `mcp install` calls the host's own
command and edits no host file. The legacy script accepts the same three
commands, so an installed skill needs no wheel.

## Compatibility and release gate

Old top-level planning/export spellings and `help` remain hidden compatibility
aliases with their old behavior. `horsmen` is an agent spelling alias, not an
executable. Legacy checker/hooks remain supported and are not installed or
changed by the new CLI. Read-only Git commands disable configured executable
helpers; old hook behavior is unchanged.

CI checks Linux/macOS and Python 3.10/3.14. Windows planning/export/update is
unsupported. Passing tests do not authorize merge, release, install or provider
writes. See [CLI usage and limits](../CLI.md) for exact input, output, failure
behavior and test commands.
