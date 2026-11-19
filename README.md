![Horsemen — four riders on horseback cross a stone bridge beneath a dramatic sky.](assets/cover.png)

# Horsemen

**Pick up a project without reconstructing it from old chats.**

Horsemen keeps four Markdown records useful: why the project exists, what has
shipped, where its knowledge lives, and where to find its parts. It works for
software, business, research, and personal projects.

Three ways to use it today:

| See your projects in the browser | Keep records current with your agent | Check records without AI |
| --- | --- | --- |
| Sign in with GitHub at [horsemen.forsvn.com](https://horsemen.forsvn.com) | Install the agent skill | Install the CLI |
| Read each record in a view made for it | Gather context and update the right originals | Get repeatable results with Python 3.10+ |
| Share a link to any project or record | Get a reminder to push record edits | Update one local record with an exact edit |

The skill and the CLI use the same checker. The CLI has no runtime
dependencies beyond Python 3.10+ and optional Git, and it does not contact
outside services.

## Get started

### See your projects

Open <https://horsemen.forsvn.com>, sign in with GitHub, and choose the
repositories to show. Each project opens as a canvas of its records. Each
record opens in a reading view: Progress starts with the next action, then
current work and shipped work by day with links to proof. Pick one of eight
themes from the account menu.

Copy a link to a project or record, such as
`horsemen.forsvn.com/owner/repo?record=progress`. Anyone can open a link to a
public repository without signing in, for example
<https://horsemen.forsvn.com/hungv47/horsemen>. A link to a private repository
opens for people with GitHub access to it. The viewer is read-only and stores no project
data on the server. It shows the default branch, so agents commit and push
record changes; the skill's Stop hook reminds them.

Run your own copy: [hosted viewer](worker/README.md). Run it on your computer
with an existing `gh` sign-in: `python3 scripts/serve_gui.py`, then open
<http://127.0.0.1:8787> ([setup](web/README.md)).

### Use the agent skill

Install with the [skills.sh CLI](https://skills.sh/docs/cli). You need Node.js
and npm; no repository clone is required:

```sh
npx skills add hungv47/horsemen --skill horsemen
```

Choose your agent and installation scope when prompted. This installs the
agent skill, not the standalone Python CLI. Start a fresh agent session:

```text
Use Horsemen to inspect this project. Keep this review read-only.
```

For a new project, ask: `Use Horsemen to initialize this project.` Your agent
uses existing evidence and asks for missing direction and knowledge locations.
It must not invent them. [Skill instructions](horsemen/SKILL.md).

### Use the CLI

For the standalone CLI, clone the repository and install into an isolated environment:

```sh
git clone https://github.com/hungv47/horsemen.git
cd horsemen
python3 -m venv .venv
.venv/bin/python -m pip install .
.venv/bin/horsemen status --path /path/to/project
.venv/bin/horsemen brain --path /path/to/project --json
```

This does not install the agent skill or change host hooks. To run without
installation: `PYTHONPATH=horsemen/scripts python3 -B -m horsemen_core --help`.

Read one record with `horsemen brain`, `horsemen vision`, `horsemen structure`,
or `horsemen status`. Use `horsemen check` for all records and `horsemen inspect`
for local project context. Setup and migration proposals live under `horsemen plan`.

For an explicit local update:

```sh
horsemen brain update --changes edit.json --dry-run --json
horsemen brain update --changes edit.json --exclusive --json
```

The [edit format and safety contract](horsemen/CLI.md#update-exactly-one-record)
require a source checksum and one exact replacement. `--exclusive` means no
other editor or sync process writes that record during the save. Missing input
fails; the command does not invent content or update other records.

## What stays with your project

| Record | Question |
| --- | --- |
| VISION.md | Why does this project exist? |
| PROGRESS.md | What shipped, what waits, and what comes next? |
| BRAIN.md | Where is outside knowledge, and how may we use it? |
| STRUCTURE.md | Where is everything? |

README, CHANGELOG, and TECHSTACK support these records. Existing provider
originals remain the source of truth; Horsemen does not create a second store.

## Status and limits

This is an **alpha**. Plans and exported patches are for review; they do not
authorize or apply changes. Local inspection does not check remote pull
requests, releases, or provider contents. Automatic Drive saves and automatic
batch patch application are not available. Local single-record updates are
explicit; provider saves still require the authorized host workflow. Linux
and macOS are the test targets; Windows planning, export and updates are unsupported.
The hosted viewer reads only repositories where its GitHub App is installed,
and links to private repositories open only for people with GitHub access.

- [CLI commands and examples](horsemen/CLI.md)
- [Skill and CLI differences](horsemen/references/cli.md)
- [Develop and verify both interfaces](CONTRIBUTING.md)
- [Current progress](PROGRESS.md) · [MIT license](LICENSE)
