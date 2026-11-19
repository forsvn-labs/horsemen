# Local GitHub workspace

Open real Horsemen projects as a calm canvas. Double-click a record to read it
or inspect its exact Markdown. The app reads GitHub; it does not edit files.

From this source checkout, with Python 3.10+ and GitHub CLI installed:

```sh
gh auth status
# If needed: gh auth login
python3 scripts/serve_gui.py
```

Open <http://127.0.0.1:8787>. Use `--port 8790` if that port is occupied.
The first visit scans repositories available to the active github.com account.
Refresh GitHub (in the account menu) repeats discovery. Clear workspace
removes the in-memory scan; it does not sign out of GitHub. Stop the server
with Ctrl+C.

The same app also runs as a hosted, read-only viewer with GitHub sign-in.
See [the hosted viewer](../worker/README.md).

## Reading and navigation

The screen shows few controls. Everything else is in one of three places:
the account menu, the Jump field, and the keyboard.

- **Rail.** The rail lists your projects. A lock marks a private repository.
  A search field appears when you have more than eight projects. Multiple
  search words narrow the result. Nested project roots are separate entries.
- **Account menu.** Select your account name at the bottom of the rail. The
  menu holds Refresh GitHub (with the time of the last check), the theme
  gallery, and Clear workspace. In hosted mode it also holds Choose
  repositories and Sign out.
- **Header.** The header shows the project name and one line: the
  repository, when PROGRESS says it was updated, and the commit that the app
  read. It has Jump, Canvas or List, and in hosted mode Copy link.
- **Jump.** Press Ctrl + K (Command + K on macOS) or select Jump. One field
  reaches each record, linked document, project, canvas action, and theme. Canvas actions include Fit, Select tool, Hand tool, Open the
  selected record, Collapse all linked branches, Reset layout, Refresh GitHub,
  and Clear workspace.
- **Shortcuts.** Press `?` or choose Keyboard shortcuts in Jump to see every
  key.
- The status line under the header shows only while discovery runs, after
  an error, or after Clear workspace. Problems with a repository show under
  it until they are fixed.

### Canvas

- Each card shows the record name and a few key lines from the source. These
  are excerpts, not generated claims. The icon has the colour of the record.
  Open the card for full context.
- Click to select; Shift-click adds or removes a card. Drag an empty area to
  select several cards, then drag the selection to move it together.
- Press `V` for the Select tool and `H` for the Hand tool. Space + drag pans
  even over a card. Middle or right mouse drag also pans. Scroll pans;
  Ctrl/Cmd + scroll or pinch zooms. The zoom control in the corner zooms and
  fits the map.
- Enter or double-click opens the selected card. Arrow keys move selected
  cards by one pixel; Shift + arrows moves them by ten. Escape cancels an
  unfinished drag or clears the selection. Shift + 1 fits the map; Shift + 2
  fits the selection. `0` resets zoom to 100%.
- The link count on a card expands or collapses its linked items. No
  selection is required. Unopened Markdown documents load their links on
  demand. These controls also work in List view. Shift + C collapses all
  branches. Shared documents stay visible while another expanded branch
  reaches them. Linked cards that appear take free space beside their parent,
  so cards do not overlap. Cards you moved keep their place. Reset layout (in
  Jump) arranges all links again. Deeper exploration reveals the ancestor
  path.
- List view keeps single-click opening. These controls follow the navigation
  pattern in [Excalidraw](https://plus.excalidraw.com/changelog); this app does
  not include freehand drawing, shape editing, or the Excalidraw editor.
- On a screen 640px wide or less, the app opens in List view, so cards stay
  readable. Select Canvas to see the map.

### Record view

- A record opens as one reading column of about 70 characters. The header
  shows the record name and the facts that the record states, such as
  "Updated yesterday" and "Stage: pilot". Header actions: Copy link (hosted
  mode), Open on GitHub, the ⋯ menu, and Close.
- The ⋯ menu shows the record in its two layouts, as the full document, or
  as its exact Markdown source. The browser saves the layout choice for each
  record type. "Read the full document" at the end of a layout is one more
  way to see everything.
- Each type has its own layout. See [artifact views](../docs/product/artifact-views.md).
  Progress: the next action first, then Now (work in progress and items that
  need attention), Up next, and shipped work by day, newest first. Proof
  links are small chips. The board is the second layout. Vision: the purpose
  sentence, then simple sections. Brain: the sources, each with its access
  line. Structure: the tree, with Copy buttons for commands. Changelog: a
  dated list. Tech stack: a compact table. README and linked documents: the
  rendered document.
- Dates show as relative time, such as "2 days ago". Hover shows the exact
  date. Each item has a small link to its source line (`L12`).
- The left column lists the records. "On this page" appears only for long
  records. The path above the page appears when you open a linked document;
  each step goes back. Use the left and right arrow keys, or the arrows at
  the end of the page, to change record.
- On a phone, the record view fills the screen.
- The address keeps the selected project and the open record. A reload
  returns to the same place.
- Linked repository Markdown opens inside the app at the same scanned commit.
  External documents and other file types show the link and its source.
  Horsemen does not fetch their contents. Missing and unreadable files show
  an error without replacing the parent record.
- Changelog PR links can load merge details and the PR description. Image
  attachments appear as links. A merge alone is not proof of delivery.

## Design

The default look is a calm reading desk: bone paper, ink, and one pigment
for each record. Vision is gilt, Progress is vermilion, Brain is indigo, and
Structure is verdigris. The pigment appears on the record icon and a few
labels only. Names and icons carry the same meaning without colour.

### Themes

Open the account menu or Jump (Ctrl/Cmd + K) to choose a theme. Each tile
shows a small card and a line of text in that theme's own fonts and colours.
A theme applies at once. The browser saves it and applies it before first
paint, so the page does not flash. Each theme sets its own fonts, corner
radius, borders, shadows, spacing, canvas, accent, and focus ring.

| Theme | Look | Modes | Fonts |
| --- | --- | --- | --- |
| **Engraved** (default) | Carved titles and book text on bone paper | Six palettes | Cleft, Gravure, Halden, Vellum, Signal |
| **Modern** | A clean product interface: grey, rounded, one blue accent | Light, dark | Beacon, Signal |
| **Editorial** | A newspaper page: Didone titles, double rules, no shadows | Light | Opaline, Folio, Signal |
| **Terminal** | A phosphor screen: monospace, dashed borders, amber accent, compact | Dark | Diode titles, device monospace |
| **Swiss** | A column grid, a bold grotesk, black and white, one red | Light | Halden, Signal |
| **Blueprint** | White line work on a blue field, a grid, corner ticks, mono labels | Dark | Tessera, Signal |
| **Soft** | Pastel colours, very round corners, wide spacing, soft shadows | Light, dark | Brioche, Mallow, Signal |
| **High contrast** | Black and white, larger text, 2px borders, a thick focus ring | Light, dark | Beacon, Signal |

The selected tile shows its options. Engraved shows its six palettes: Bone
and Ink, and one for each horse (White, Red, Black, and Pale). System
chooses Bone or Ink from the device. A theme with a light and a dark mode
shows System, Light, and Dark; System follows the device.

For easier reading, choose Modern or High contrast. They replace the
earlier type sets: a browser that saved the Modern or System type set opens
in the Modern theme. The hosted sign-in page stays Engraved, but it uses the
Beacon type for people who chose Modern or High contrast.

A test checks every theme and mode. Text and pigments meet a 4.5:1 contrast
ratio (7:1 in High contrast), focus rings meet 3:1, and text is 12px or
larger. Motion stops when the system asks for reduced motion.

### Fonts

The browser downloads only the fonts of the active theme, and theme.js
preloads only its main files. The theme gallery shows a live preview of each
theme, so the first time it opens, it loads one or two fonts for each theme.
Fonts come from [fontzz](https://fontzz.vercel.app) and are served locally.
See [the font notice](assets/fonts/NOTICE.txt) and
[their licence](assets/fonts/OFL.txt). Icons, seals, and the app icon are
original; see [the icon system](../docs/product/icon-system.md). The latest
design audit and its open items are in
[the design audit](../docs/product/design-audit.md).

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
sections. Fenced `mermaid` blocks show as diagrams and charts. Relative image
links to PNG, JPEG, GIF, WebP, or SVG files up to 1 MiB show the image; other
images appear as links. Other HTML is shown as text. Footnotes and
reference-style links are not supported; exact source is always available.
PR comments are not scanned.
Connections currently use inline Markdown links, excluding code examples and
comments. Reference-style and HTML links are not indexed. A document exposes
up to 200 links; a project retains up to 4,000 link targets per scan. Only a
link found in an already-loaded record can authorize another repository read.
The peek history holds up to 32 levels; Back and project changes release it.

The server binds only to 127.0.0.1. It reads credentials locally through `gh`;
they never reach the browser. Requests are read-only. Repository metadata and record contents are not saved to disk
by the app. The browser stores only opaque project IDs, canvas positions, the theme, palette, and mode choices, and the layout choice for each record type.
In hosted mode, the browser also keeps a discovery index without record text; see
[fast reloads](../worker/README.md#how-it-works).
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
