# Local GitHub workspace

Open real Horsemen projects as a draggable canvas. Double-click a record to read it
or inspect its exact Markdown. The app reads GitHub; it does not edit files.

From this source checkout, with Python 3.10+ and GitHub CLI installed:

```sh
gh auth status
# If needed: gh auth login
python3 scripts/serve_gui.py
```

Open <http://127.0.0.1:8787>. Use `--port 8790` if that port is occupied.
The first visit scans repositories available to the active github.com account.
Refresh GitHub repeats discovery. Clear workspace removes the in-memory scan;
it does not sign out of GitHub. Stop the server with Ctrl+C.

## Reading and navigation

- Search the left rail by project name, repository, or folder. Multiple search
  words narrow the result. Nested project roots are separate entries.
- Open projects as discovery finds them. The remaining scan continues without
  changing the project you selected.
- Cards show source excerpts suited to each record: purpose and audience,
  next action and gates, knowledge sources, paths, releases, and tools.
  These are excerpts, not generated claims. Open the peek for full context.
- Click to select; Shift-click adds or removes an artifact. Drag an empty area
  to select several artifacts, then drag the selection to move it together.
- Use Select (`V`) or Hand (`H`). Space + drag pans even over a card. Middle
  or right mouse drag also pans. Scroll pans; Ctrl/Cmd + scroll or pinch zooms.
- Enter, Open, or double-click opens the selected artifact. Arrow keys move
  selected artifacts by one pixel; Shift + arrows moves them by ten. Escape
  cancels an unfinished drag or clears selection. Shift + 1 fits the map;
  Shift + 2 fits the selection. `0` resets zoom to 100%.
- Use the link count and chevron on a card to expand or collapse its linked
  items. No selection is required. Unopened Markdown documents load their links
  on demand. These controls also work in List view. Collapse all in the toolbar
  hides all expanded branches. Shared documents remain visible
  while another expanded branch reaches them. Linked cards that appear take
  free space beside their parent, so cards do not overlap. Cards on the canvas
  and cards you moved keep their place. Reset layout arranges all links again.
  Deeper exploration reveals the ancestor path.
- List view keeps single-click opening. These controls follow the navigation
  pattern in [Excalidraw](https://plus.excalidraw.com/changelog); this app does
  not include freehand drawing, shape editing, or the Excalidraw editor.
- Open a card for its visual overview: Vision brief, Progress board, Brain
  source library, Structure map, release timeline, tool cards, or README guide.
  Each overview has a title block, the facts that the record states as
  `Label: value`, and the layout for its type. Full document and Markdown
  source tabs preserve the complete record.
- Progress groups items by day, latest day first. A board shows Shipped, In
  progress, Up next, and Needs attention. Each item shows its proof (PR,
  commit, release, checks, and document links from its text and its evidence
  row) and a link to its source line. Earlier days fold.
- Dates show as relative time, such as "2 days ago". Hover shows the exact
  date. Structure paths open on GitHub, and commands have Copy buttons.
- Each overview has a layout switch: the rich layout or a compact list. The
  browser saves the choice for each record type. Views show source excerpts;
  they do not rewrite records. A record that does not follow its template
  uses the general section layout. See [artifact views](../docs/product/artifact-views.md).
- Inside the peek, the left column lists the records and the sections of the
  open page. The path above the page goes back to an earlier document. Use
  the left and right arrow keys, or the buttons at the bottom, to change
  record.
- Press Ctrl + K (Command + K on macOS) or select Jump to. One field reaches
  each project, record, view, and theme.
- The address keeps the selected project and the open record. A reload
  returns to the same place.
- Open a connected artifact to go deeper. Back returns to the previous record.
  Explore on canvas adds connected documents as movable nodes. Lines represent
  explicit links in the source files, not assumed relationships.
- Linked repository Markdown opens inside the app at the same scanned commit.
  External documents and other file types show a source card and an external
  link. Horsemen does not fetch their contents. Missing and unreadable files
  show an error without replacing the parent record.
- Changelog PR links can load merge details and the PR description. Image
  attachments appear as links. A merge alone is not proof of delivery.

## Design

The look is a modern engraving: bone paper, ink, and one pigment for each
record. Vision is Conquest (gilt), Progress is War (vermilion), Brain is
Famine (indigo), and Structure is Death (verdigris). Names and icons carry
the same meaning without colour. The theme button in the left rail opens six
themes: Bone and Ink, and one theme for each horse (White, Red, Black, and
Pale). System follows the device setting. A test checks that text and
pigments in each theme meet a 4.5:1 contrast ratio. Motion stops when the
system asks for reduced motion.

Fonts come from [fontzz](https://fontzz.vercel.app) and are served locally:
Cleft (titles), Gravure (labels), Halden (interface), Vellum (reading), and
Signal (code). See [the font notice](assets/fonts/NOTICE.txt) and [their licence](assets/fonts/OFL.txt). Icons, seals,
and the app icon are original; see [the icon system](../docs/product/icon-system.md).

## Boundaries

This is a source-only local preview, not a hosted or multi-user service.
The wheel and skill do not include the web assets. There is no public sharing,
OAuth app, file editing, webhook, local-folder import, or background refresh.

Discovery reads default branches, including archived repositories. A project
needs at least two core records and either VISION or PROGRESS (legacy STATUS
is supported). Missing records are reported. Truncated repository trees are
reported as incomplete scans. Files larger than 512 KiB are not loaded.
Markdown supports headings, wrapped paragraphs, nested and numbered lists,
task lists, tables, quotes, rules, fenced code, links, and simple expandable
sections. Other HTML is shown as text. Images appear as links. Footnotes and
reference-style links are not supported; exact source is always available.
PR comments are not scanned.
Connections currently use inline Markdown links, excluding code examples and
comments. Reference-style and HTML links are not indexed. A document exposes
up to 200 links; a project retains up to 4,000 link targets per scan. Only a
link found in an already-loaded record can authorize another repository read.
The peek history holds up to 32 levels; Back and project changes release it.

The server binds only to 127.0.0.1. It reads credentials locally through `gh`;
they never reach the browser. Requests are read-only. Repository metadata and record contents are not saved to disk
by the app. The browser stores only opaque project IDs, canvas positions, the theme choice, and the layout choice for each record type.
External images do not load automatically. Opening an external link leaves
the local app. Do not expose this server through a tunnel or reverse proxy.
After switching GitHub accounts, refresh discovery. Project loads also check
the local credential identity and reject account changes. The remote account
check is reused for up to 30 seconds; revocation of an unchanged credential
can take that long to invalidate cached content.

Records load in parallel. Up to 16 projects are cached in server memory at
the scanned revision. Refresh and Clear workspace discard this cache. Failed
record loads are retried instead of cached. Nothing is written to disk.

## Verification

```sh
python3 -m unittest discover -s tests -p 'test_gui*.py'
node tests/test_gui_previews.cjs
node tests/test_gui_views.cjs
node tests/test_gui_markdown.cjs
node tests/test_gui_themes.cjs
node tests/test_canvas_state.cjs
python3 scripts/test_gui_e2e.py --output /tmp/horsemen-gui-check
```

The browser check needs `agent-browser`. It uses fictional GitHub fixtures,
checks reading/source views and browser safety, and saves screenshots and
command output outside the repository. Full package checks remain in
[CONTRIBUTING](../CONTRIBUTING.md).
