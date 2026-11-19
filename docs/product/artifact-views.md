# Artifact views

Status: built in the local workspace peek. This page lists each artifact
type, what a reader needs from it, and the view that the peek shows.

## Rules for every view

- Markdown is the source of truth. A view shows excerpts from the source. It
  does not rewrite, summarize, or add claims.
- Each item has a link to its exact source line (`↗ L12`). The link opens
  the file on GitHub at the scanned revision.
- Interface labels use plain words. Dates show as relative time, such as
  "2 days ago". Hover shows the exact ISO date.
- Each type has two layouts: a rich layout and a compact list. Select the
  layout in the page header. The peek saves the choice for each record type
  in the browser.
- The Full document and Markdown source tabs stay available for every type.
- Source text is untrusted. Views escape all text, accept only `http` and
  `https` links, and never run content.
- When a record does not follow its template, the peek shows the general
  section layout. The list layout always works.
- The Progress, Changelog, and Techstack layouts show up to 300 items. A list
  shows up to 500 rows. The page states how many more items are in the Full
  document.

## Inventory

| Type | What the reader wants in 10 seconds | Source structure | View | Fallback |
| --- | --- | --- | --- | --- |
| PROGRESS (and legacy STATUS) | The next action, what shipped, what is in progress, what is blocked, and the proof. | Facts line, `Next action:`, Latest day toggle with Shipped, In progress, Up next, Needs decision, Gates, and an Item/Evidence table. Historical ships with `### YYYY-MM-DD` days. Upcoming roadmap. | Next action banner. Latest day with a four-lane board: Shipped, In progress, Up next, Needs attention. Each item shows its date, proof chips (PR, commit, release, checks, documents) from its own links and its evidence row, an Evidence fold, and its source line. Earlier days fold, newest first. Roadmap in Next, Later, and Idea lanes. List: one row for each item, grouped by day. | Legacy layouts with `## YYYY-MM-DD` headings become days. History tables (Date, Shipped, Proof) become dated days. Evidence rows with no matching item show as "Other proof". A record with no status items uses the general layout. |
| CHANGELOG | What reached people, when, and the proof. | `## version - YYYY-MM-DD` or `## YYYY-MM-DD` headings, optional `###` categories, bullets. | Release timeline: version badge, relative date, category labels, and proof chips for each entry. The PR loader stays below. List: one row for each entry, grouped by release. | A changelog without release headings uses the general layout. |
| VISION | Why the project exists, who it serves, the path, and what is still open. | Owner and Confirmed facts, a declaration, and sections from the vision template. | Direction brief: "In short" banner, Why and World cards, Who, numbered beliefs, a Now → Next → Later path, the never list as a boundary, a "Still open" panel for bets and open questions, and dated direction changes. Other sections stay below. | A vision with none of the template sections uses the general layout. |
| BRAIN | Where knowledge lives, how to reach it, and the limits. | Brain and access facts, a Providers table, a knowledge table, Retrieve steps, a Save table, Cleanup, Access rules, Open questions. | Source library: provider cards with role, route, scope, and a "Verified" or "Not verified" badge. Connected documents follow. Then "What lives where", "How to find things", "Where to save", rules as boundaries, and open questions. | Bullet providers become cards. Prose providers show as a note. A brain with no known sections uses the general layout. |
| STRUCTURE | Where to start, where each part is, and the commands. | Map tree in a code block, a Mermaid flow, Repository key files, `Commands:`, Read before changing, brain trees. | Read first banner. A navigable tree: each path opens on GitHub; tags such as "start here" and "generated; do not edit" are badges. Commands have Copy buttons. Mermaid flows show as labeled steps. Tables show as path and reason pairs. List: one row for each path and command. | A tree with no project folder line keeps its top-level paths. Patterns such as `<slug>/` have no link. Brain trees have no GitHub links. |
| TECHSTACK | Which tools the project uses, why, and what is not confirmed. | Checked fact, tool and integration tables, gaps, evidence. | Component cards with an initials mark, a version badge taken from the tool name, each column as a field, and a "Not confirmed" badge for `Unknown` or `Not used`. Gaps show first as "To verify". | Sections with no table use the general layout. |
| README | What this is, what you get, and how to start. | Pitch, What it does, What you get, Install, Use, Project records. | Guide: "What this is" banner, a checklist of what you get, numbered steps with Copy buttons for commands, and the project records list. | A README with no capability or step sections uses the general layout. |
| Linked Markdown document | The document's sections. | Any Markdown. | General section layout with numbered sections and the connections panel. List: one row for each section. | A document with no headings lists its paragraphs. |
| PR reference | Which pull request this is, and its state. | A link to `github.com/<owner>/<repo>/pull/<n>`. | A source card with a PR chip. For the same repository, "Load PR #n" reads the title, merge state, and description. | Other repositories show the source card and an external link. |
| Unknown file | That it exists and where it is. | Any non-Markdown file or external link. | Source card with the link and the parent record. Contents are not fetched. | Not applicable. |

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
width: the status board, PR proof chips, exact dates, source lines, the saved
list choice, Copy buttons, tree links, and no sideways scrolling on a phone.
