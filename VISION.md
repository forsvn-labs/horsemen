# Vision

Owner: Hung · Confirmed: 2026-11-18 for an open-source, self-hosted GUI alongside the skill and CLI

Horsemen makes project context easy to carry from one working session to the next.

## Why we exist

A useful project record lets a person or agent continue without rebuilding
the story from scattered conversations. The skill and CLI belong together,
so their rules and checks stay consistent.

## The world we are building

One public Horsemen project combines an agent skill, a CLI, and a canvas
workspace. Each project is a workspace tied to its Git repository. Operators
connect GitHub, pick a repository, and switch between workspaces. A sidebar
lists the key artifacts of the workspace: Vision, Progress, Brain, Structure,
and their supporters. Each artifact opens as its own canvas. The canvas
holds notes, images, recordings, tables, and links beside the record, and
connectors show how they relate. People and agents both change a canvas, and
each change is a commit in the project's repository. Agents read and update the workspace
through a few small tools and hooks. Operators can also share a canvas
publicly. The product remains open source and can be self-hosted.

## Who we build for

People who work with agents and want project records they can read and keep.
The records apply to software, business, research, and personal work.

## What we believe

- The owner sets direction. Evidence establishes progress.
- Knowledge stays with its existing originals.
- The same rules should support every interface.
- A canvas shows how things connect. The records stay the source of truth.
- Project data stays in the project's repository. Our servers keep none of it.

## How we get there

Keep the existing skill and CLI working. Design the canvas workspace first.
After the owner approves the design, build it in small steps that each reach
people: canvases to read, then tools and hooks for agents, then editing in
the browser.

## What we will never become

A tool that treats a plan as permission or invents the owner's direction.
A service that keeps copies of its users' project data.

## Open questions

- Who should the first release serve best?
- Should public canvases use reviewed snapshots or live updates?
- Adoption targets and funding remain undecided.
- May people change record text in the browser, or only the canvas around it?
- Should agents without a copy of the repository get a hosted way to read a workspace?

## Direction changes

- 2026-11-18: Hung expanded the skill-and-CLI scope to include a visual,
  self-hosted product with GitHub project discovery and public canvas sharing.
- 2026-11-19: Hung limited the hosted product to linking Git projects and
  viewing them. It reads records from Git and does not store their data.
- 2026-11-19: Hung made the canvas the main surface. Each project is a
  workspace tied to its repository, each artifact opens as its own canvas,
  and people and agents both edit it. Edits are commits in the repository.
  This replaces the view-only limit; the product still stores no project data.
