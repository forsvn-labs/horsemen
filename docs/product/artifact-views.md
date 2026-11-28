# Artifact views

Status: built in the local workspace and the hosted viewer. This page lists
each artifact type, what a reader needs from it, and the layouts that the
record view shows.

## Rules for every view

- Markdown is the source of truth. A view shows excerpts from the source. It
  does not rewrite, summarize, or add claims.
- The view is one reading column of about 70 characters. It starts with
  content. The peek header holds the record name and the facts that the
  record states (for example "Updated yesterday · Stage: pilot"), so the view
  does not repeat a title, a kicker, a seal, or helper text.
- Each item has a quiet link to its exact source line (`L12`). The link opens
  the file on GitHub at the scanned revision.
- Proof links (pull requests, commits, releases, checks, documents) show as
  small chips.
- Interface labels use plain words. Dates show as relative time, such as
  "2 days ago". Hover shows the exact ISO date.
- Each type has two layouts. The ⋯ menu in the header selects the layout,
  the full document, or the Markdown source. The browser saves the layout
  choice for each record type. "Read the full document" at the end of a
  layout opens the full document in one click.
- Source text is untrusted. Views escape all text, accept only `http` and
  `https` links, and never run content.
- When a record does not follow its template, the peek shows the rendered
  document. The list layout always works.
- A section card on a record canvas opens the view at its section. The view
  uses the layout of the record when the layout has a part with the name of
  the section. If not, it opens the full document at that heading. See
  [record canvases](../../web/README.md#record-canvases).
- The Progress, Changelog, and Techstack layouts show up to 300 items. A list
  shows up to 500 rows. The page states how many more items are in the full
  document.

## Inventory

The first layout is the default.

| Type | What the reader wants in 10 seconds | Source structure | Layouts | Fallback |
| --- | --- | --- | --- | --- |
| PROGRESS (and legacy STATUS) | The next action, what is happening now, what shipped, and the proof. | Facts line, `Next action:`, Latest day toggle with Shipped, In progress, Up next, Needs decision, Gates, and an Item/Evidence table. Historical ships with `### YYYY-MM-DD` days. Upcoming roadmap. | **List:** the next action, large. Then Now: work in progress, decisions, gates, and blockers, each with a small status tag. Then Up next. Then Shipped: work grouped by day, newest first, with proof chips. More than four days fold under "earlier days". Notes and the roadmap come last. **Board:** the next action, then four lanes for the latest day (Shipped, In progress, Up next, Needs attention) with an Evidence fold on each item; earlier days fold; the roadmap in lanes. | Legacy layouts with `## YYYY-MM-DD` headings become days. History tables (Date, Shipped, Proof) become dated days. Evidence rows with no matching item show as "Other proof". A record with no status items and no next action shows the rendered document. |
| VISION | Why the project exists, who it serves, what it will never become, and what is still open. | Owner and Confirmed facts, a declaration, and sections from the vision template. | **Brief:** the purpose sentence, large (the declaration, or a short Why section). Then simple sections in this order: who, why, world, beliefs, path (with Now, Next, and Later tags), never, sustainability, bets, open questions, and dated direction changes. Other sections follow. **List:** one row for each section. | A vision with none of the template sections shows the rendered document. |
| BRAIN | Where knowledge lives and how to reach it. | Brain and access facts, a Providers table, a knowledge table, Retrieve steps, a Save table, Cleanup, Access rules, Open questions. | **Sources:** a list of sources. Each source has its name, its role as a tag, one access line (location, route, account, and scope), and a "Verified" or "Not verified" badge. Linked documents follow. Then what lives where, how to find things, where to save, rules, and open questions as simple sections. **List:** one row for each source. | Bullet providers become sources with their text as the access line. A brain with no known sections shows the rendered document. |
| ANATOMY | Where to start, where each part is, the stack, and the commands. | Map tree in a code block, a Mermaid flow, Repository key files, `Commands:`, Read before changing, brain trees. | **Map:** read first, then the tree. Each path opens on GitHub; tags such as "start here" and "generated; do not edit" are small tags. Commands have Copy buttons. Mermaid flows show as labeled steps. Tables show as path and reason pairs. **List:** one row for each path and command. | A tree with no project folder line keeps its top-level paths. Patterns such as `<slug>/` have no link. Brain trees have no GitHub links. |
| CHANGELOG | What reached people, when, and the proof. | `## version - YYYY-MM-DD` or `## YYYY-MM-DD` headings, optional `###` categories, bullets. | **Releases:** a dated list. Each release has its version, relative and exact date, category labels, and proof chips for each entry. The pull request loader follows. **List:** one row for each entry, grouped by release. | A changelog without release headings shows the rendered document. |
| Legacy TECHSTACK | Which tools the project uses, why, and what is not confirmed. | Checked fact, tool and integration tables, gaps, evidence. | **Table:** gaps first as "To verify". Then one compact table for each source table: tool, version (taken from the tool name), one column for each source column, and a "Not confirmed" badge for `Unknown` or `Not used`. **List:** one row for each tool. | Sections with no table show the rendered document. |
| README | What this is and how to start. | Pitch, What it does, What you get, Install, Use, Project records. | **Document:** the rendered README without its title, which is in the header. Code blocks have Copy buttons. **List:** one row for each section. | Not applicable. |
| DESIGN | Visual system and interface rules. | Root DESIGN.md in the open format. | Plain document with a section canvas. | No card if the file is absent. |
| Linked Markdown document | The document itself. | Any Markdown. | The rendered document with the linked documents list. | A document with no headings shows its paragraphs. |
| PR reference | Which pull request this is, and its state. | A link to `github.com/<owner>/<repo>/pull/<n>`. | A PR chip and the link. For the same repository, "Load PR #n" reads the title, merge state, and description. | Other repositories show the link only. |
| Unknown file | That it exists and where it is. | Any non-Markdown file or external link. | The link and the record that links to it. Contents are not fetched. | Not applicable. |

## Failure modes covered by tests

`tests/test_gui_views.cjs` covers these cases with fictional records:

- Template records for each type.
- Missing sections, and a record with only a next action.
- Legacy STATUS layouts with dated top-level headings.
- No dates, invalid dates (`2026-13-45`), and dates that are not ISO.
- Malformed tables: no divider row, uneven columns, escaped pipes, and a
  header with no rows.
- Unsafe content: HTML in names, `<script>` text, and `javascript:` links.
- Windows line endings, comments, and headings inside code fences.
- Records that do not follow the template.
- A 600 KB record with 6,000 items.

`scripts/test_gui_e2e.py` checks the views in a browser at desktop and phone
width: the Progress reading order, the optional board, PR proof chips, exact
dates, source lines, the saved layout choice, the menu for the full document
and source, Copy buttons, tree links, a compact record list, "On this page"
only for long records, a full-screen record view on a phone, and no sideways
scrolling on a phone.
