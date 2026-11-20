# Canvas workspace design

Status: the owner approved this design and all eleven proposed answers on
2026-11-19. Slice 1 (the sidebar and generated canvases, read-only) is live.
See [slice 1 as built](#slice-1-as-built). The browser half of slice 2a
(canvas files shown in the browser, read-only) is merged and deployed. See
[slice 2a as built](#slice-2a-as-built). The Python half of slice 2a, the agent
tools, and the hooks are merged. Slice 2b (click-to-load players and CSV and
TSV tables) is merged and deployed. See [slice 2b as built](#slice-2b-as-built).
Slice 4a (browser editing with the opt-in editor app) is built and waits for
review; the editor app does not exist on the live site yet. See
[slice 4a as built](#slice-4a-as-built).
The owner gave the direction and three decisions on 2026-11-19; this page
turns them into a design and a build plan.

- [Clickable mock](../show-me/canvas-workspace/index.html) with fictional data.
- [Canvas file schema](canvas.schema.json) and a
  [checked fixture](../show-me/canvas-workspace/fixture/).
- Questions that need an answer before a build: [Owner questions](#owner-questions).

## Summary

| Topic | Proposal |
| --- | --- |
| Workspace | One project root in one GitHub repository. A switcher at the top of the sidebar changes workspace. |
| Sidebar | Lists the artifacts of the workspace: Home, Vision, Progress, Brain, Structure, README, Changelog, Tech stack, then boards. |
| Canvas for each artifact | The app generates it from the record's headings. No file is necessary. A saved canvas file adds notes, media, links, groups, and connectors. |
| Source of truth | Markdown records stay the source of truth. A canvas refers to a record section; it does not copy the text. |
| File format | [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/) with limits and three optional keys, in `.horsemen/canvas/<name>.canvas`. One element on each line. |
| Media | Images, GIFs, CSV, and XLSX up to 1 MiB each in `.horsemen/media/`. Videos and large files are links. |
| Agents | Two tools: `read` and `canvas_edit`. Local MCP server from the Python CLI. The session hook injects a pointer of 700 characters or less. |
| People | Edit in the browser. Each save is one commit. A second, opt-in GitHub App has the write permission. |
| Server | Still stores no project data. The viewer app, the public view, and the local app stay read-only. |
| First slice | Sidebar and generated canvases, read-only. It needs no file format, no new permission, and no new promise. |

## What changes in the promises

| Promise today | After this plan |
| --- | --- |
| "Stores none of your project data." | Still true. Canvas files and media live in the user's repository. The Worker has no database, key-value store, or content log. It checks a save in memory and passes it to GitHub. Unsaved drafts stay in the browser tab. |
| "Read-only. Horsemen never writes to your repositories." | No longer true for a person who installs the editor app. It stays true for the viewer app, the public view, and the local app. The sign-in page text must change in the same pull request that ships editing. |
| "You choose the repositories." | Still true, for each app separately. |

## Where this design pushes back

| Idea | Risk | Smaller path in this design |
| --- | --- | --- |
| "Everything stays inside the canvas." | Long text is hard to read in small cards. The calm reading column shipped on 2026-11-19 for this reason. Facts that live only on a canvas are invisible to an agent that reads Markdown. | The canvas is the surface; the records are the store. A section card opens the reading view as an overlay on the canvas. Notes on a canvas are working material. A fact that must last goes into a record. |
| One canvas file for each artifact from day one. | Files that only repeat the record add commits and merge work, and they go stale. | The app generates the canvas. A file exists only after someone adds or moves something, and it holds only those elements. |
| A preview card for any URL. | The server must fetch pages that users name. That is a request-forgery risk, and the server would hold third-party content. | No server fetch. A link card shows the title stored in the canvas file and the host. Known hosts get an embedded player that loads on a click. |
| Excel files in the repository. | XLSX is a binary file. Git cannot show its changes, an agent cannot read it as text, and each edit stores a full copy. | CSV is the table format. XLSX is accepted with a simple preview in a later slice. Large or live sheets are links. |
| A save for each change. | Each commit on the default branch can start CI and deploys. GitHub also limits content creation to 80 requests a minute and 500 an hour. | Edits collect in a draft. The person selects Save. One save is one commit with `[skip ci]`. |
| Live co-editing. | It needs a server that holds state. That breaks the storage rule. | Commits and a merge of elements by ID. The app checks for new commits every 60 seconds, as it does today. |
| Write access on the existing GitHub App. | Each new user would see "Read and write access to code", also users who only read. GitHub has no folder-level permission. | A second, opt-in editor app. The Worker has one narrow write route. |
| A hosted MCP endpoint now. | It needs an OAuth server on a Worker that has no storage, and it sees only pushed commits. Agents with a checkout do not need it. | Local MCP first. Decide on a hosted endpoint after local use shows a need. |
| Edit record text in the browser. | It needs a second copy of the record rules in JavaScript. VISION is the owner's text. | Not in this plan. A section card has an "Edit on GitHub" link. Agents and the CLI keep the existing edit contract. |
| Freehand drawing and shapes. | Not requested. It would make the app a drawing tool. | Out of scope. Cards, frames, and connectors only. |

## User jobs and the first slice

| Job | Who | The canvas helps when |
| --- | --- | --- |
| See how the parts of a record connect. | Operator | Sections are cards; connectors show what blocks, proves, or feeds what. |
| Put the proof beside the claim. | Operator, agent | A screenshot, recording, or table sits next to the shipped item. |
| Think in the open. | Operator | Notes, frames, and connectors on a board; decisions move into records later. |
| Give an agent the picture cheaply. | Agent | One short tool call returns an outline; details come on demand. |
| Move between projects. | Operator | The switcher opens another workspace at its last canvas. |
| Show someone one exact place. | Operator | A link opens a canvas at one element. |

**First slice: generated canvases, read-only.** The sidebar lists the
artifacts. Each artifact opens as a canvas of its sections. A section card
opens the reading view at that section. No canvas file, no format, no write
permission.

This slice tests the largest assumption at the lowest cost: that a canvas of
sections is more useful than the reading column alone. Proof of value: the
owner uses it on three real projects for one week and reports which of the two
they open first, and what they want to put next to a section. If the answer is
"the reading view, nothing", stop and rethink before the format work.

## Information architecture

```text
┌ Workspace ▾ ───────┬───────────────────────────────────────────────┐
│ Lantern Walks      │ Progress          Edit · Canvas|List · Copy link│
│ ────────────────── │  ┌ Shipped ───┐ ─demo─▶ ┌ video ─┐ ┌ link ─┐   │
│ Home               │  └────────────┘         └────────┘ └───────┘   │
│ Vision             │  ┌ In progress┐ ─route▶ ┌ image ─┐ ┌ table ┐   │
│ Progress       •   │  └────────────┘         └────────┘ └───────┘   │
│ Brain              │        ▲ blocks                                │
│ Structure          │  ┌ note ──────┐                                │
│ README             │  └────────────┘                                │
│ Changelog          │                                                │
│ Tech stack         │                                                │
│ Boards             │                                                │
│ Launch plan    •   │                                 − 100% + Fit   │
│ ────────────────── │                                                │
│ account ▾          │                                                │
└────────────────────┴────────────────────────────────────────────────┘
```

| Level | What it is | Where it comes from |
| --- | --- | --- |
| Workspace | One project root in one repository. A monorepo can hold several. | Discovery, as today: a folder with two or more core records. |
| Artifact | A record, a supporter, or a board. | Records and supporters: the seven files. Boards: canvas files with other names. |
| Canvas | The view of one artifact. | Generated from the record, plus the canvas file when one exists. |
| Element | A card, frame, or connector. | Generated (a section) or saved in the canvas file. |

### How the current app maps in

| Today | In the canvas workspace |
| --- | --- |
| Rail with the project list | Workspace switcher at the top of the sidebar. Jump (Ctrl/Cmd + K) still lists projects. |
| Home canvas of record cards | The **Home** artifact. Same cards, same linked-document branches. |
| Peek with a type-specific view | The reading view. It opens over the canvas from a section card, a record card, or `?record=`. |
| Canvas or List | Kept for each canvas. A phone opens in List. List is also the accessible form of a canvas. |
| Card positions in browser storage | Stay in browser storage until browser editing ships. Then a saved layout goes into the canvas file. |
| `?record=progress` links | Still work. New: `?canvas=progress&node=s-shipped`. |

### Generated canvas

1. Read the record. Make one section card for each second-level heading.
   The card ID is `s-` plus the heading slug (`s-in-progress`); a repeated
   heading gets `-2`, `-3`.
2. If a canvas file exists, draw its elements at their saved places.
3. Place each section that no saved element shows. Use a fixed grid when
   there is no file, or a column beside the saved elements. The same input
   always gives the same layout. Generated cards do not overlap saved cards.
4. A saved section card whose heading no longer exists shows "Section not
   found" with the record link. `horsemen check` reports it.

A canvas file is sparse on purpose. A record with one note beside it needs a
file with one or two lines.

### Slice 1 as built

Slice 1 has step 1 and the fixed grid of step 3. The rules are in
`web/canvas-sections.js`; `tests/test_canvas_sections.cjs` checks them.

| Item | Rule in the code |
| --- | --- |
| Heading | A line that starts with `## `, outside code blocks and comments. These are the headings that the reading view shows. |
| Slug | The heading as plain text, with accents folded to plain letters, in lower case; each run of other characters becomes one hyphen; 56 characters at most. A heading without letters or digits gets `section`. |
| ID | `s-` and the slug. The second heading with the same slug gets `-2`. If that ID is taken (a heading named "Shipped 2"), the number goes up until the ID is free. An ID is 64 characters or less. |
| Record without sections | One card for the whole record, with the ID `r-` and the record name, such as `r-readme`. |
| Grid | Three columns, in reading order. Cards are 320 by 196; columns are 360 apart and rows 248 apart. A new last section does not move the cards before it. |
| Card text | The heading, a few source lines (two on the canvas, three in the list), and a count for two or more list items or table rows. A table gives its first column. A diagram block gives the word "Diagram". |
| Connectors | None on a record canvas: an edge exists only in a canvas file (slice 2a). Home keeps its connectors between records and linked documents. |
| Moving cards | Not possible. The app saves nothing about a record canvas. Home card positions stay in browser storage, as before. |
| Reading view | A card opens the reading view at its section: in the layout of the record when the layout names the section, else in the full document. |
| Links | `?canvas=<record>&node=<id>`, with `&record=<record>` while the reading view is open. The local app uses `#p=<project>&c=<record>&n=<id>&r=<record>`. `?record=` links work as before. Sign-in keeps `canvas` and `node`. |
| Switcher | Lists the projects in name order, with search for long lists and a lock for private ones. A project opens on its last canvas until the page reloads. Hosted mode adds Connect a repository. |

Not in slice 1: the order by most recent use, a saved last canvas across
reloads, "No records yet" entries, and all that needs a canvas file.

### Slice 2a as built

Slice 2a has steps 2, 3, and 4 of the generated canvas, the drawing of canvas
files, and the JavaScript reader. This section is about the browser half. The
Python reader, the `check` rules, and the shared cases come with the pull
request of the agent tools.

| Item | Rule in the code |
| --- | --- |
| Modules | `web/canvas-format.js` reads and checks a file. `web/canvas-view.js` makes one drawing from the file and the generated canvas. Both are pure rules that the app and the tests share. `web/app.js` draws the result. |
| Same rules in two languages | The JavaScript reader gives the same errors as the Python reader, in the same order, with the same codes (`canvas-invalid`, `canvas-dangling-ref`, `canvas-media-too-large`) and the same messages, and the same canonical text. `tests/test_canvas_format.cjs` runs the shared cases in `tests/fixtures/canvas/`. A report holds 20 errors at most. |
| Readers | Both readers find `<project root>/.horsemen/canvas/<name>.canvas` in the tree of the repository, 20 at most for a root, in name order. A file in a sub-folder, with a name that the rule refuses, or behind a symlink is not listed. A file larger than 512 KiB is refused by its listed size and is not requested. The hosted reader uses the blob route, in the signed-in view and in the public view. The saved index keeps the path and the SHA, never the text. |
| Files that a canvas names | The reader registers each `file` node with a safe path. Only a registered file can be read. An image loads through the existing image route (1 MiB, the content must match the type) when it comes into view; a canvas loads 100 images at most. |
| Artifact | A file with a reserved name belongs to the canvas of that record. Another name is a board. The rail lists the boards after the records, in name order, in title case. `home.canvas` is reserved and is not shown in this slice. |
| A record with a file | The saved elements show at their places and sizes. Each section that no saved element shows gets a generated card in one column at the left of the saved elements, in record order, with the pitch of the fixed grid. A saved section card matches a generated card by the line of its heading, not by its ID. A file with no element keeps the fixed grid. |
| IDs | An element keeps the ID of the file. A generated card keeps its `s-` ID; when the file uses that ID for another element, the generated card gets `-2`, `-3`. |
| Section card | `file` and `subpath` name the section. The text comes from the record at the loaded commit. `#Parent#Child` names a deeper heading: the card shows its text and opens the section that holds it. A card of another record has a "from Vision" tag and opens that record. When the heading is gone, the card says "Section not found" and still opens the record. |
| Other elements | A note is Markdown from the safe renderer. A portal opens a canvas of the same project root, or says "Canvas not found". A Markdown file that is not a record is a document card that opens in the reading view. An image shows from a `blob:` address with its `alt` text. A link card shows the stored title and the host; the app fetches nothing. A group is a frame behind the other elements. Another file is a file card with a link to GitHub. An unknown type shows as "Not supported". |
| Embeds and tables | Not in this slice. A video or design address is a link card. A CSV, TSV, or XLSX file is a file card. Slice 2b adds them; see [slice 2b as built](#slice-2b-as-built). |
| Connectors | A curve from border to border. A stated side wins; if not, the app takes the sides that face each other. The end has an arrow unless the file says `none`. The label sits at the middle of the curve. The list view states each connector as a text line of its start element. |
| Colours | A preset takes a colour of the active theme: 1 vermilion, 2 between vermilion and gilt, 3 gilt, 4 verdigris, 5 between verdigris and indigo, 6 indigo. A hex value is set as a value, never as CSS text. Each theme draws its own card border, so the colour also shows as a stripe. |
| A file that is not valid | A file that fails before its elements are checked (size, UTF-8, JSON, conflict markers, nesting, numbers, Unicode, shape, version, counts) shows no element: the record shows its generated canvas, and a board is empty. One message above the canvas names the file and the fault, with a link to the file. For a file with some bad elements, the other elements show; the message gives the count of elements that do not show and the first fault, and a list of 8 faults at most. An edge to an element that does not show does not show. The first element with an ID keeps it. A file with a higher version shows with a note. The rail marks a canvas whose file shows no element. |
| Interaction | Read-only. An element has a fixed place; a drag on it moves the canvas. Click selects. Enter selects the element with focus and opens the selected element when it can open: a section card, a record or document card, and a portal. A link inside a note or a card stays a link. |
| Links | `?canvas=<name>&node=<id>` and `#p=<project>&c=<name>&n=<id>` name a board or a record canvas and one element. A link to a canvas or an element that is gone opens what exists and says so. |
| List view | Elements outside groups from top to bottom, then each group with its elements. A phone opens in the list. |
| Untrusted content | The app builds each tag itself and escapes each value of a file. The checks cover script text in each text key, a `javascript:` address, CSS in a colour, a path with `..`, 5,000 nodes, a file of 2 MiB, IDs with the names of records and of built-in keys, and an SVG with a script. The SVG blob test opens the `blob:` address of the image as a page, in the local app and under the Worker's content security policy, and checks that the script did not run. |

Not in slice 2a (browser): the overview of references between canvases
(dashed lines on Home and the "Referenced from" list), group background
images, the "Stored in Git LFS" message, and all that needs embeds, tables,
or editing.

Section card IDs follow one rule on both sides: the live rule of slice 1 in
`web/canvas-sections.js` (accents fold to plain letters, 56 characters, only
backtick fences). The owner chose it on 2026-11-19 so that old `?node=` links
keep working. The shared cases state this rule, and the Python agent tools
and the browser both pass them.

### Slice 2b as built

Slice 2b has the click-to-load players, the `frame-src` list, and CSV and TSV
tables. It needs no change to the file format: the kind of an element still
comes from the JSON Canvas type and the file extension or the URL host.

| Item | Rule in the code |
| --- | --- |
| Modules | `web/canvas-embeds.js` turns the address of a link card into a frame address, or gives null. `web/canvas-table.js` splits CSV and TSV text into rows and writes escaped markup. `web/canvas-view.js` uses both; `web/app.js` makes the frame and loads the tables. Pure rules, with tests in `tests/test_canvas_embeds.cjs`, `tests/test_canvas_table.cjs`, and `tests/test_canvas_view.cjs`. |
| Providers | YouTube (`youtube.com`, `www.`, `m.`, `youtu.be`, `youtube-nocookie.com`), Vimeo, Loom, Figma, and Google Docs, Sheets, and Slides on `docs.google.com`. The host must match exactly, with no port and no user information. Any other address stays a link card. |
| Frame address | The app builds it from an ID that a strict pattern checks: 11 characters for YouTube, digits and an optional hex hash for Vimeo, 32 hex characters for Loom, a file key and an optional `node-id` for Figma, and a file ID for Google. A stored address never goes into a frame. YouTube uses `www.youtube-nocookie.com/embed/<ID>`, with `start` from `t` or `start`. Vimeo adds `dnt=1`. Figma gets `www.figma.com/embed?embed_host=horsemen&url=` with an address that the app makes again from the key. Google uses `/preview` (`/embed` for slides); a published file keeps its published form. |
| Before the click | The card shows the title, "Load video" or "Load preview", a note that nothing loads before the click, the host, and "Open on <provider>". No frame, no thumbnail, no request to a provider. |
| After the click | One `iframe` with `sandbox="allow-scripts allow-same-origin allow-presentation"`, `allow="fullscreen; picture-in-picture; encrypted-media"`, and a title. YouTube gets `referrerpolicy="strict-origin-when-cross-origin"`; the other frames get `no-referrer`. The app checks the frame address against `frame-src` again before it makes the frame. The button gets the label "Load video", not "Play": the player starts on its own button, because autoplay is not the same for each provider. |
| `frame-src` | `https://www.youtube-nocookie.com https://player.vimeo.com https://www.loom.com https://www.figma.com https://docs.google.com`, on each response of the Worker and on the page of the local server. One test compares the two policies with the list in `web/canvas-embeds.js`. A `curl` check on 2026-11-20 showed that these frame addresses send no `X-Frame-Options` and no `frame-ancestors`; the Figma `embed.figma.com` form sends `X-Frame-Options: SAMEORIGIN` on its redirect, so the app uses `www.figma.com/embed`. |
| Tables | A CSV or TSV file that a canvas names, in `.horsemen/media/` or at another path. The reader gives its text (1 MiB at most) through `/api/table` in the local app and the contents route in the hosted viewer. A text that is not UTF-8, has a NUL character, or is a Git LFS pointer gives a message. The first row is the header; then 200 rows and 30 columns at most; a cell shows 300 characters at most. A column of numbers aligns right. A canvas loads 20 tables at most. XLSX stays a file card. |
| Interaction | The button of a player is a real button: Tab, Enter, and Space work. A click on it does not select or open the card. Over a table, the wheel and the arrow keys scroll the table; Ctrl or Cmd with the wheel still zooms. A drag on a table does not move the canvas. |
| List view and phones | A player keeps its ratio (16:9 for a video, 4:3 for a file). A table scrolls in its card, 360 pixels high at most. |
| Browser checks | `scripts/test_gui_e2e.py` and `scripts/test_hosted_e2e.py` open the Proof board of `scripts/canvas_fixture.py`. A route in the isolated browser answers each provider origin with a fake player, so no real provider is contacted. The checks show that no request goes to a provider before a click, that the frame of the chosen player loads under the content security policy, and which referrer it sends. |

Not in slice 2b: an XLSX preview, a live check for each provider (it needs a
deployed canvas; see the pull request), a player that stays loaded when a
live update draws the canvas again, and thumbnails.

### Slice 4a as built

Slice 4a has the editor app, its sign-in, the write route, and edit mode in
the hosted app. The rules are in `worker/src/index.js` (sign-in and the
route), `web/canvas-edit.js` (draft operations, the commit message, and the
merge, shared by the browser and the Worker), and `web/canvas-editor.js`
(edit mode). `worker/test/editor.test.js`, `worker/test/setup.test.js`, and
`tests/test_canvas_edit.cjs` check them; `scripts/test_hosted_edit_e2e.py`
checks the browser against a fake GitHub.

| Item | Rule in the code |
| --- | --- |
| Editor app | `create-github-app.mjs --editor` makes "Horsemen Editor" with Contents: Read and write and Metadata: Read, the callback `/auth/edit/callback`, and no events. It stores `EDITOR_CLIENT_ID`, `EDITOR_CLIENT_SECRET`, and `EDITOR_APP_SLUG` and prints none of them. Without these three secrets, the site is a viewer: no editor sign-in, no write route, and the sign-in page keeps "This site never writes to your repositories." |
| Editor sign-in | Needs a viewer session. It has its own state cookie (`__Host-horsemen-edit-state`), sealed for its own purpose, so the state of one flow cannot finish the other. The token goes into the field `w` of the session cookie. The GitHub login of the editor token must be the login of the viewer session; if not, the token is revoked and the session does not change. A viewer refresh keeps `w`. An expired editor token refreshes with the editor app during a write; a failed refresh removes `w` and asks for editor sign-in again (`403`, `editor-signin`). |
| Tokens | Reads (`/gh/*`) use the viewer token only. `/write/*` uses the editor token only. The public view has no session, and its routes are GET only. Sign-out revokes both tokens, each with the credentials of its own app. |
| Request checks | In this order: the editor app is configured (else `404`), a session (`401`), same origin and the CSRF token (`403`), POST (`405`), an `Origin` header that is this site (`403`), `Content-Type: application/json` (`415`), a declared `Content-Length` of 2 MiB or less when there is one (`413`), an editor token (`403`), a body of 2 MiB or less while it is read (`413`), JSON with exactly `repo`, `root`, `canvas`, `base`, and `text` (`400`), each name (`400`), and the canvas (`422`). |
| Names | `repo`: `owner/name` with the characters that GitHub allows, not `.` or `..`. `root`: empty, or up to 16 folders of letters, digits, `_`, `.`, and `-`, with 200 characters at most; a folder cannot start with `.`. `canvas`: the canvas name rule, not `home`. `base`: a blob SHA (40 or 64 hex characters) or `null`. Media is not accepted in this slice. |
| Canvas | `canvas-format.js` checks the text, as in the browser. Each error refuses the save, also an edge to a missing node. A file with a higher version is refused. The Worker writes the canonical text. It does not check that each `file` exists or that each `subpath` matches a heading. |
| Commit | `GET /repos/{repo}` (default branch, push permission), `GET` the file at the default branch (blob SHA), then `PUT` the file. A SHA that is not `base` is a conflict (`409`, `conflict`, with the current SHA or `null`). The same text as on GitHub makes no commit (`unchanged`). A `409` or `422` from the `PUT` reads the file again: a new SHA is a conflict; the same SHA means that the head moved, and the `PUT` runs again, three times at most (then `409`, `busy`). `403` or `404` from GitHub is `editor-install`; a user without push access gets `no-push`. GitHub error text never goes to the browser. |
| Message | `canvas(<name>): <counts> [skip ci]`. The counts come from the old and the new file: add (new nodes), move (only position or size changed), edit (other keys changed), connect (new edges), remove (nodes and edges). No text from the file goes into the message. A replayed request finds a new SHA and is a conflict. |
| Edit mode | Hosted and signed in only; the Worker adds `canvas-edit.js`, `canvas-editor.js`, and `canvas-editor.css`. Edit opens on a record canvas or a board whose file is valid and of version 1. Move (drag, arrow keys), add a note (in free space in the middle of the view), edit a note (double-click, Enter), connect or disconnect two selected elements, delete, and save (Ctrl/Cmd + S) with a preview of the file, the message, the branch, the changed elements, and a warning for a public repository. A generated section card goes into the file with `file` and `subpath` when it moves or connects; a card whose heading is repeated or has `#` cannot. A generated card cannot be deleted. |
| Draft | The canvas document in `sessionStorage`, with the SHA and the document that it started from. It comes back with Edit after a reload. If the file changed since, the draft merges with the new file first. The page warns before it closes with an unsaved draft. Sign-out removes drafts. Done asks: save, discard, or keep the draft. |
| Merge | By element ID, from the conflict table. Changes to different elements, and to different keys of one element, are kept. Position and size: mine wins. The same content key, a delete against an edit, or the same new ID on both sides: the person chooses mine or theirs for each element (mine is the default). The edges of a node that is not in the result go. A merge that leaves no change of mine makes no commit. While a draft is open, the 60-second check shows "The canvas changed on GitHub." and **Merge now**. |

The browser check found two faults, which this slice fixes: a share link with
the path `/write/canvas` was read as the repository `write/canvas`, so
`write` is now a reserved name; and when the background check of the saved
index found a new commit of the open project first, the open project did not
reload.

Not in slice 4a: resize, media upload and drop (4b), links and groups,
colour, undo, the choice of the target branch and protected branches (4c),
and a check of the file references on save.

#### The choice of the GitHub call

| Option | Calls for one save | One commit for several files | Conflict check | Result |
| --- | --- | --- | --- | --- |
| **REST contents API** (`PUT /repos/{repo}/contents/{path}` with `sha`) | 3: the repository, the file, the `PUT` | No | GitHub refuses a `sha` that is not the current blob SHA. A head that moves during the call returns `409`. | **Chosen for slice 4a.** One file, the fewest calls, and the blob SHA is the conflict check that the design needs. Each `PUT` is one commit by the user, with the user token. |
| GraphQL `createCommitOnBranch` | 3 or more: head, file, mutation | Yes | `expectedHeadOid`: each new commit on the branch fails it, also a commit that does not touch the file. | For slice 4b (media), when a save writes several files. |
| Git data API (blob, tree, commit, ref) | 5 or more | Yes | The ref update fails when it is not a fast-forward. | Not used: more calls, and the commit is not signed. |

Sources: [repository contents API](https://docs.github.com/en/rest/repos/contents)
(the blob `sha` for an update; the default branch when no branch is given) and
[the Git database guide](https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-your-git-database)
(`409` for an empty or busy repository). The GitHub documentation does not
give the cause of each `409` of the contents call. Thus the Worker reads the
file again before it decides between "conflict" and "try again". The fake
GitHub of the browser check follows this rule. The live check on a disposable
repository confirms it on github.com before the first deploy with editing.

### Connections between artifacts

| Connection | How it is stored | How it shows |
| --- | --- | --- |
| Inside one canvas | An edge between two elements. | A connector with an optional label. |
| To a section of another record | A section card that names the other record, with an edge to it. | The card has a "from Vision" tag. Opening it goes to that record. |
| To another canvas | A card that names the other canvas file. | A portal card: "Open canvas". |
| Between records in Markdown | A normal Markdown link in the record. | As today: linked-document branches on Home. |
| Overview | Not stored. The app reads the workspace's canvas files (at most 20) and finds the cross-references. | Dashed lines between artifact cards on Home, and a "Referenced from" list in the reading view. |

An edge never crosses files. This keeps each file valid alone and lets two
people edit two canvases with no conflict.

## Canvas file format

**Decision: use JSON Canvas 1.0, with a small Horsemen profile.** Agents
already know the format, other tools can open the files, and the design work
is done. The profile adds limits, a fixed way to write the file, and three
optional keys.

### Location and names

| Item | Rule |
| --- | --- |
| Folder | `<project root>/.horsemen/canvas/` |
| File | `<name>.canvas`, name `^[a-z0-9][a-z0-9-]{0,63}$` |
| Reserved names | `home`, `vision`, `progress`, `brain`, `structure`, `readme`, `changelog`, `techstack` belong to those artifacts. |
| Boards | Any other name. The sidebar shows the name in title case. |
| Limits | 512 KiB a file, 500 nodes, 1,000 edges, 20 canvas files in a workspace. |

### Element types

The app finds the kind of an element from the JSON Canvas type plus the file
extension or the URL host. No extra type names are necessary.

| Element | JSON Canvas | How the app knows | Keys used |
| --- | --- | --- | --- |
| Note or card | `text` node | type | `text` (Markdown) |
| Record section | `file` node | `.md` file and a `subpath` | `file`, `subpath` (`#Heading` or `#Parent#Child`) |
| Whole record or document | `file` node | `.md` file, no `subpath` | `file` |
| Canvas portal | `file` node | `.canvas` file | `file` |
| Image or GIF | `file` node | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg` | `file`, `alt` (profile key) |
| Sheet or table | `file` node | `.csv`, `.tsv`, `.xlsx` | `file`, `subpath` (`#Sheet name` for XLSX) |
| Video or design embed | `link` node | host is on the embed list | `url`, `title` (profile key) |
| Link card | `link` node | any other `http` or `https` URL | `url`, `title` |
| Group or frame | `group` node | type | `label` |
| Connector | edge | — | `fromNode`, `toNode`, `label`, sides, ends |
| Unknown type | any | type is not one of the four | Shown as "not supported"; kept on save |

All nodes have `id`, `type`, `x`, `y`, `width`, `height`, and an optional
`color` (`"1"` to `"6"`, or `#RRGGBB`). The presets take the colours of the
active theme.

### Example

```json
{
"horsemen":{"version":1},
"nodes":[
{"id":"g-proof","type":"group","x":380,"y":-60,"width":1000,"height":360,"label":"Proof for the booking page"},
{"id":"img-route","type":"file","x":420,"y":400,"width":400,"height":250,"alt":"Map of the harbour loop with five stops","file":".horsemen/media/route-map.svg"},
{"id":"note-risk","type":"text","x":-380,"y":430,"width":320,"height":140,"color":"1","text":"**Risk:** the old gate closes at 21:00 in winter."},
{"id":"s-shipped","type":"file","x":0,"y":0,"width":320,"height":220,"color":"4","file":"PROGRESS.md","subpath":"#Shipped"},
{"id":"vid-walkthrough","type":"link","x":420,"y":0,"width":480,"height":270,"title":"Booking page walkthrough (3 min)","url":"https://www.youtube.com/watch?v=EXAMPLE0000"}
],
"edges":[
{"id":"e-demo","fromNode":"s-shipped","toNode":"vid-walkthrough","label":"demo"}
]
}
```

### Rules

| Rule | Detail |
| --- | --- |
| Version | `horsemen.version` is an integer. A file without it is version 1. The app shows a file with a higher version read-only and does not save it. |
| Unknown keys | Kept on save, at each level. Another tool can drop the three profile keys; nothing breaks without them. |
| IDs | `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`, unique in the file across nodes and edges. An ID does not change after it is made. Agents can use words (`note-risk`). The browser makes 12 random characters. `s-` is for section cards. |
| Paths | Relative to the project root. No leading `/`, no `.` or `..` part, no backslash. |
| URLs | `http` or `https` only. |
| Numbers | `x`, `y`: integers from −1,000,000 to 1,000,000. `width`, `height`: 16 to 8,192. |
| Text | A note holds up to 20,000 characters of Markdown. The app draws it with the same safe renderer as the records. |
| Order | Groups first, then nodes by ID, then edges by ID. JSON Canvas uses the order as the stacking order; Horsemen keeps frames at the back and does not keep a manual stacking order. |
| Canonical text | UTF-8, line feeds, one element on each line, keys `id`, `type`, `x`, `y`, `width`, `height` first and the others in A to Z order, no spaces, a final newline. `horsemen check` reports a file that is valid but not canonical as a warning. |
| Rules a schema cannot state | Unique IDs; each edge end names a node; each `file` exists; each `subpath` matches a heading; media type and size. The CLI, the MCP tool, and the Worker check them. |

Two implementations read and write the format: Python (`horsemen_core`) for
the CLI, MCP, and hooks, and JavaScript for the browser and the Worker.
Shared fixture files, with the expected text and the expected error for each
case, keep the two the same. This is the same method as the reader parity
test today.

### How a canvas links to the records

- A section card stores `file` and `subpath` only. The app draws the live
  text of that section from the Markdown file at the same commit.
- The heading text is the anchor. Records need no added IDs or comments, so
  they stay plain Markdown that any agent can read.
- When a heading changes, the card shows "Section not found". `check` reports
  `canvas-dangling-ref`, and the Stop hook asks the agent to repair the card
  when the agent changed that heading in the session.
- An agent that reads only Markdown misses nothing that is a project fact,
  because facts belong in records. Canvas notes are working material. The
  `read` tool gives an agent the notes when it wants them.

### Merges and conflicts

| Case | Result |
| --- | --- |
| Two edits to different elements, through Git | Git merges them: each element is one line, and the fixed order puts new lines in different places. |
| Two additions at the same place, through Git | A normal Git conflict. Keep both lines. A file with conflict markers fails `check` (`canvas-invalid`), so the Stop hook reports it. |
| Browser save when the file changed on GitHub | The Worker refuses the save (the blob SHA differs). The browser reads the new file and merges by element ID with these rules, then saves again. |
| Same element, different keys changed | Both changes are kept. |
| Same element, both moved or resized | The person's own position wins. |
| Same element, same content key changed (`text`, `url`, `file`, `subpath`, `label`, `title`, `alt`, `color`) | The person chooses: mine or theirs, for each element. |
| One side deleted, the other edited | The person chooses. |
| A node is deleted | Its edges go with it. |

## Media rules and limits

| Item | Rule |
| --- | --- |
| Folder for uploads | `<project root>/.horsemen/media/` |
| File name | Lower case, `^[a-z0-9][a-z0-9._-]{0,99}$`. A browser upload gets `<name>-<8 hex of its SHA-256>.<ext>`, so the same file is stored once and a name never changes its content. |
| Types | PNG, JPEG, GIF, WebP, SVG, CSV, TSV, XLSX. The content must match the extension. |
| Size | 1 MiB for each file. This is the size that GitHub returns in one contents call, and the limit that the image reader already uses. |
| Budget | `check` warns when `.horsemen/media/` is over 20 MiB. It does not block. |
| Files elsewhere in the repository | A canvas can show them by path, with the same type and size rules. Uploads go to the media folder only. |
| Too large, or a video | The editor refuses the file and offers a link card. Videos are never committed. |
| Tables | CSV and TSV show the first 200 rows and 30 columns. XLSX shows a file card until the preview slice. |
| Git LFS | Not used. An LFS pointer file shows as "Stored in Git LFS; not shown". |
| Deletion | Removing a card does not delete its file. `check` lists media that no canvas uses. Git history keeps a file after deletion, so the editor warns before an upload to a public repository. |

### Embeds and link cards

| Address | Shows as |
| --- | --- |
| YouTube, Loom, Vimeo | A card with a play button. The player loads in a sandboxed frame only after a click. |
| Figma, Google Sheets, Google Docs, Google Slides | A card with "Load preview". The same click rule. If the provider refuses the frame or the viewer has no access, the card stays a link. |
| Any other `http` or `https` address | A link card: the stored `title`, the host, and "Open". The server fetches nothing. An agent or a person writes the title. |

The app builds the frame address itself from an ID that it reads from the
URL. It never puts a stored URL into a frame.

## Browser editing and the commit flow

### GitHub permission

GitHub App permissions apply to a whole repository. There is no permission for
a folder.

| Option | Permission | What GitHub enforces | Limits |
| --- | --- | --- | --- |
| **A. Second app, "Horsemen Editor" (proposed)** | Contents: Read and write. Metadata: Read. | Only repositories where the user installed the editor. Only what that user can do. | The Worker's write route is the only narrowing to `.horsemen/`. |
| B. Add write to the existing app | Same, on `horsemen-viewer` | Same | Each new user sees the write request, also users who only read. Existing installations stay read-only until their owner approves the change. |
| C. "Single file" permission | Read and write to at most 10 exact paths | GitHub limits writes to those paths | No media upload, no boards, no monorepo roots. The current GitHub permission tables do not show how it works with user tokens. Test it before use. |

**Contents: Read and write means this.** With a signed-in user's token, the
app can create, change, and delete any file, branch, and tag that the user
can, in the repositories where the editor is installed. It cannot change
files in `.github/workflows` (that needs the Workflows permission), and it
cannot pass branch protection that applies to the user. Horsemen asks for no
other permission.

What keeps the risk small:

- The editor is opt-in for each repository. The viewer app does not change.
- Writes use the user's token only. The app has no private key on the server
  (the setup script discards it), so the server cannot write without a live
  user session. Tokens expire and refresh, as today.
- The Worker has one write route with fixed paths (below). It is not a proxy.
- An organization can add its own rule that limits the paths of a push, where
  its GitHub plan has push rulesets.

Self-hosting: the editor app is optional. With no editor secrets, the
instance is a viewer, as today.

### What the Worker allows

| Route | Method | Today | After |
| --- | --- | --- | --- |
| `/gh/*` | GET | Allowlisted reads with the viewer token | No change. Canvas files and media use the blob and contents routes that are already on the list. |
| `/pub/*` | GET | Public reads, no user token | No change. Never writes. |
| `/auth/edit/login`, `/auth/edit/callback` | GET | — | Sign-in for the editor app. The editor token goes into the same encrypted cookie, in its own field. |
| `/auth/edit/logout` | POST | — | Stop editing: revoke the editor token only. Needs the CSRF token. |
| `/write/access` | GET | — | Is the editor app installed on a repository, and can the person push? Reads only, with the editor token. |
| `/write/canvas` | POST | — | The only write route. |

`POST /write/canvas` request:

```json
{
  "repo": "example-org/lantern-walks",
  "root": "",
  "canvas": "progress",
  "base": "9b1c…blob SHA, or null for a new file",
  "text": "the canvas file",
  "media": [{ "name": "board-1a2b3c4d.png", "data": "base64" }],
  "summary": "add 2, move 3"
}
```

| Check | Rule |
| --- | --- |
| Session | A valid cookie with an editor token. The viewer token is never used for a write. Public mode has no write. |
| Cross-site | The `Origin` header must be this site. `Sec-Fetch-Site` must be `same-origin` when present. The session token header must match (as for reads). `Content-Type` must be `application/json`. No CORS headers. |
| Size | `Content-Length` is required. 6 MiB at most for a request, 512 KiB for the canvas, 1 MiB for each media file, 4 media files. |
| Names | `repo`, `root`, `canvas`, and each media name match fixed patterns. The Worker builds the paths: `<root>/.horsemen/canvas/<canvas>.canvas` and `<root>/.horsemen/media/<name>`. The browser never sends a path, a branch, or a full commit message. |
| Content | The canvas must pass the same validator as the browser, and the Worker writes it in canonical form. Each media file must match its type. |
| Branch | The default branch only. |
| Commit | One commit for the canvas and its new media. The Worker reads the branch head and the current blob SHA of the canvas. A different SHA from `base` returns `409` with `code: "conflict"`. If the head moves between the read and the commit, the Worker tries again, three times at most. |
| Reply | `{ "commit": "sha", "canvas_sha": "sha", "url": "…" }`. GitHub error text is not passed on. |

GitHub call, as built in slice 4a: the REST contents API,
`PUT /repos/{repo}/contents/{path}` with the blob `sha`. See
[the choice of the GitHub call](#the-choice-of-the-github-call). Slice 4b
writes media files too and needs one commit for several files; it moves to
the GraphQL `createCommitOnBranch` mutation or the Git data API then, with the
same contract.

### Flow for a person

1. Select **Edit**. Without the editor app on this repository, the app
   explains the permission and links to the install page.
2. Move, add, connect, or delete. Changes go to a draft in the tab
   (`sessionStorage`), with the SHA of the file that the draft started from.
   The page warns before it closes with an unsaved draft. Sign-out clears
   drafts.
3. Select **Save** (Ctrl/Cmd + S). A preview shows the file, the message, and
   the changed lines.
4. The Worker commits. The header shows the new commit.
5. On a conflict, the browser merges (see [Merges and conflicts](#merges-and-conflicts))
   and saves again. While a draft is open, the 60-second check also offers
   "Merge now" when the file changes on GitHub.

| Item | Rule |
| --- | --- |
| Batching | One save is one commit. There is no timed save. |
| Message | `canvas(<name>): <summary> [skip ci]`, for example `canvas(progress): add 2, move 3 [skip ci]`. The Worker writes it from counts. |
| Author | The signed-in user. GitHub signs the commit when it can. |
| Branch | The default branch. On a protected branch, the first version says so and offers the file as a download. A later slice commits to a `horsemen/canvas` branch and links to "Open a pull request". |
| Who can save | A user with push access. The app reads the permission from the repository list and hides Edit for others. GitHub enforces it. |
| Public repository | The editor shows "This repository is public. Anyone can see this canvas and its files." |

## Workspace switching and repository connection

| Step | Behaviour |
| --- | --- |
| Connect GitHub | Sign in with the viewer app, as today. |
| Pick repositories | "Choose repositories" opens the GitHub install page, as today. The switcher gets a "Connect a repository" entry that opens the same page. |
| Find workspaces | Discovery, as today. The tree that discovery already reads also lists canvas files, so finding them costs no extra request. The saved index keeps canvas paths and SHAs, never content. |
| Repository without records | Listed under "No records yet" with one line: ask your agent to "Use Horsemen to initialize this project". The browser does not create records. |
| Switch | The switcher lists workspaces, most recent first, with search and a lock for private ones. It opens the last canvas of that workspace. The browser keeps only IDs for this. |
| Unsaved draft | A switch asks: save, keep the draft, or discard. |
| Links | `/owner/repo?root=apps%2Fweb&canvas=progress&node=s-shipped`. The sign-in return path keeps `canvas` and `node`. |

## Agent access: tools, CLI, and hooks

### Transport

| Option | Decision | Reason |
| --- | --- | --- |
| Local stdio server: `horsemen mcp` | **Build.** | It reads the working tree, so it sees edits that are not pushed. No network, no token, no dependency: JSON-RPC lines on standard input and output, with the Python standard library. |
| Same functions in the CLI: `horsemen show`, `horsemen canvas apply` | **Build.** | One implementation, three interfaces. An agent with a shell needs no tool schema in its context. |
| Remote endpoint on the Worker | **Later.** | See [push back](#where-this-design-pushes-back). A first step could serve public repositories read-only. |

The installed skill starts the server (`python3 <skill>/scripts/horsemen.py mcp`),
so it works without the wheel. `horsemen.py mcp install` registers it through
the host's own command (`claude mcp add`, `codex mcp add`); it does not edit
host files.

### Tools

Two tools. All output is plain text, because it costs fewer tokens than JSON.

```json
[
  {
    "name": "read",
    "description": "Read a Horsemen workspace. target: \"\" = index. \"progress\" = headings of a record. \"progress#Shipped\" = one section. \"progress.canvas\" = canvas outline. \"progress.canvas#id\" = one element.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "target": { "type": "string" },
        "max_chars": { "type": "integer", "minimum": 200, "maximum": 8000 },
        "offset": { "type": "integer", "minimum": 0 },
        "if_rev": { "type": "string" }
      },
      "required": ["target"]
    }
  },
  {
    "name": "canvas_edit",
    "description": "Change elements of one canvas file in .horsemen/canvas. Checks, formats, and writes the file. Does not commit.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "canvas": { "type": "string" },
        "ops": {
          "type": "array",
          "maxItems": 50,
          "items": {
            "type": "object",
            "properties": {
              "op": { "enum": ["add", "update", "remove"] },
              "id": { "type": "string" },
              "node": { "type": "object" },
              "edge": { "type": "object" },
              "near": { "type": "string" },
              "side": { "enum": ["right", "left", "below", "above"] }
            },
            "required": ["op"]
          }
        },
        "base_rev": { "type": "string" },
        "dry_run": { "type": "boolean" }
      },
      "required": ["canvas", "ops"]
    }
  }
]
```

`read` examples:

```text
> read {"target": ""}
workspace lantern-walks @ main 3f2a91c, 1 commit not pushed
records: VISION 5 sections · PROGRESS 5 · BRAIN 2 · STRUCTURE 2 · README · CHANGELOG · TECHSTACK
canvases: progress 11 nodes 7 edges · launch-plan 9 nodes 4 edges
next: Send the autumn route to the ten pilot guests.

> read {"target": "progress.canvas"}
progress.canvas rev=3fa9c1d2 11 nodes 7 edges
g-proof group "Proof for the booking page" @380,-60 1000x360
s-shipped section PROGRESS.md#Shipped @0,0 320x220
vid-walkthrough video youtube "Booking page walkthrough (3 min)" @420,0 480x270
img-route image .horsemen/media/route-map.svg "Map of the harbour loop…" @420,400 400x250
note-risk note "Risk: the old gate closes at 21:00 in winter…" @-380,430 320x140
…
edges: s-shipped>vid-walkthrough "demo"; note-risk>s-in-progress "blocks"; …
not placed: #Latest day, #Up next, #Gates
```

`canvas_edit` behaviour:

| Item | Rule |
| --- | --- |
| `add` | `node` or `edge`. The tool makes the ID when there is none. `near` (an element ID or `#Heading`) with `side` puts the node in free space beside that element, so an agent needs no coordinates. |
| `update` | `id` plus the keys to change in `node` or `edge`. |
| `remove` | `id`. Edges of a removed node go too. |
| Section cards | An op that names `#Heading` saves that section card first, with its `s-` ID. |
| All or nothing | One bad op means nothing is written. The reply names the op and the rule. |
| `base_rev` | When given and the file differs, nothing is written. |
| Media | The agent copies a file into `.horsemen/media/` with its own tools, then adds a node. The tool checks type and size. No binary data goes through MCP. |
| Reply | `ok rev=5e0c77aa added=note-7 updated=1 removed=0`, plus at most five warnings. |
| Commit | The agent commits and pushes. The Stop hook's Publish rule covers `.horsemen/`. |

### Budget for each call

| Item | Limit | About |
| --- | --- | --- |
| Both tool definitions, as compact JSON | 1,200 characters (1,047 in this draft) | 300 tokens, once for a session |
| `read ""` (index) | 800 characters | 200 tokens |
| Record headings | 1,200 characters | 300 tokens |
| One section, default | 2,000 characters; then `more: offset=2000` | 500 tokens |
| Canvas outline | 2,000 characters; one line of 100 characters for each node | 500 tokens |
| Any `read` | 8,000 characters with `max_chars` | 2,000 tokens |
| `canvas_edit` reply | 400 characters | 100 tokens |

Tests fail when a limit is exceeded.

### Caching

- The server keeps parsed files in memory by path, size, and change time.
- Each reply starts with `rev=`, the first eight characters of the content
  hash. `read` with `if_rev` returns `unchanged rev=…` (about 20 characters)
  when nothing changed.
- No cache is written to disk.

### Hooks

No new hook events. The two hooks change like this:

| Hook | Today | Proposed |
| --- | --- | --- |
| SessionStart | Injects the PROGRESS snapshot: up to 60 lines and 3,000 characters, plus STRUCTURE's reading list and health lines. | **Pointer mode:** 700 characters at most. Root and records; the canvas names; the Next action line; the gates in full when they fit in 300 characters, or else "read progress#Gates before you act"; up to three health lines; one line that names the `read` tool and `horsemen show`. |
| Stop | Asks for the four-record review; adds drift details. | The same, plus: an invalid canvas file (Lint); a section card whose heading the session changed; `.horsemen/` files in the Publish rule. |

Pointer mode is a choice at install time (`hooks install --pointer`). Without
it, the hooks work as they do today, so existing installations do not change.
Gates stay in the pointer because the snapshot's purpose is "respect the
gates before you act".

The skill tells agents when to change a canvas: when the user asks, when a
section card broke, and when new proof exists for a shipped item. A hook does
not ask for canvas edits at each stop.

### Agent tools as built

Slice 3a and the Python half of slice 2a are built as this section says, with
these additions. The [canvas guide](../../horsemen/references/canvas.md) is
the reference for agents.

| Item | As built |
| --- | --- |
| Read-only mark | The `read` definition has the MCP annotation `readOnlyHint`, so a host can run it with no approval question. The two definitions are 1,083 characters as compact JSON. `canvas_edit` writes and can remove elements, so it has no mark. |
| Approval in Codex | Codex asks the person for each `canvas_edit` call. A run with no person (`codex exec`) waits for the answer. The person can allow the tool in the Codex settings; `mcp install` does not set this. |
| Node types in an op | An op can make only `text`, `file`, `link`, and `group` nodes. A kind name from the outline, such as `note` or `image`, is read as its type, because real agents send it. Another type is refused. A node of another tool keeps its own type. |
| Placement | A place that is taken moves along the side of the anchor, in the direction where the free place is nearer. |
| Receipts | `python3 -B scripts/agent_sessions.py --output DIR` starts a new Claude Code and Codex session in a temporary fictional project and checks that each calls both tools. The server is set for that run only. |
| Not built here | The JavaScript reader, drawing in the browser, the SVG blob test, and the browser checks of slice 2a. |

### Hooks as built

Slice 3b is built as the Hooks table says, with these details. The
[hook reference](../../horsemen/references/hooks.md#pointer-mode) has the
full rules.

| Item | As built |
| --- | --- |
| Opt-in | `hooks install --pointer` adds `--pointer` to the SessionStart command only. Without it, session start gives the same bytes as before; a scenario compares them with the output of the release before canvases. |
| Pointer lines | Root and records; canvas names; next action; gates; one line for STRUCTURE's "Read before changing" list (an addition, because that list is required reading in the default mode); up to three health lines; the read line with the review request. |
| Gates | In full at 300 characters or less; else "Read progress#Gates before you act". A gate is never cut. The root, the gates, and the read line always stay; other lines go first when the limit is near. |
| Stop rules | Canvas errors in a file that the session changed; a card on an unchanged canvas that broke in the session, reported once; `.horsemen/canvas/` and `.horsemen/media/` files in the Publish rule. These rules run in both modes, and only in a project with files in `.horsemen/`. |
| Not done here | The done condition of slice 3b: the owner's installed skill runs pointer mode in one real project for a week with no missed gate. No installed skill or hook setting was changed. |

## Security and privacy

| Topic | Rule |
| --- | --- |
| Canvas files are untrusted input | A collaborator, or the owner of a public repository, can write anything. The app validates each file, skips bad elements with a visible count, and never fails the page. Limits: file size, node and edge counts, number ranges, string lengths. |
| Markup | Notes go through the existing Markdown renderer: all HTML is text; links are `http` or `https` only. |
| Colours | A preset or `#RRGGBB` only, so a colour cannot carry CSS. |
| Paths | Checked on read and write. A canvas cannot name a file outside the repository. |
| SVG | Only as an `<img>` from a `blob:` address, never inline or in a frame, as the image reader does. A test opens the blob address as a page and checks that its script does not run. Browser upload of SVG stays off until that test passes. |
| Private repositories | Canvas files and media go through the same proxy with the user's token. The server keeps nothing. The saved index holds paths and SHAs only. A draft stays in the tab. |
| Public repositories | Anyone can read canvases and media through the public view, with the same edge cache as today (60 seconds for heads, one day for objects by SHA). The public view cannot write. |
| Rate limits | Reads: one request for each canvas file, one for each image, loaded when visible and cached by SHA; 100 media cards at most on a canvas. A user has 5,000 requests an hour. Writes: one or two GraphQL calls for a save; GitHub allows 80 content requests a minute and 500 an hour. |
| Frames | `frame-src` gets a fixed list of embed hosts. A frame loads after a click, with `sandbox="allow-scripts allow-same-origin allow-presentation"`. |
| Referrer | The page keeps `no-referrer`. A YouTube frame needs `referrerpolicy="strict-origin-when-cross-origin"`, or the player fails with error 153. It sends the site origin only, never the repository path. |
| Third parties | Before a click, the browser contacts no embed host. After a click, the provider sees the viewer's IP address and the site origin. |
| Tokens | The editor token is in the same encrypted, HttpOnly cookie. Sign-out revokes both tokens. |
| Logs | Request logs stay off. |

Content Security Policy change (slice 2b); every other directive stays:

```text
frame-src https://www.youtube-nocookie.com https://www.loom.com
          https://player.vimeo.com https://www.figma.com https://docs.google.com
```

Slice 2b uses exactly these five origins. A `curl` check of each frame address
found no header that refuses a frame. The live check of a video, a sheet, and
a CSV file on a deployed canvas comes after the deploy.
`frame-ancestors 'none'` stays: no other site can frame Horsemen.

## Risks

| Risk | Effect | Answer |
| --- | --- | --- |
| A canvas of sections is not better than the reading column. | The direction does not pay back. | Slice 1 tests it before the format work. |
| Facts live only on canvases. | Agents and the records disagree. | Section cards refer, never copy. The skill rule: facts go into records. `read` shows notes on demand. |
| Canvas commits start CI or deploys. | Cost and noise in the user's repository. | Explicit Save; `[skip ci]`. GitHub Actions obeys it; other systems differ. |
| Media makes the repository heavy. | Slow clones, also for agents. | 1 MiB a file, a 20 MiB warning, links for video. |
| The write permission scares users or is misused. | Lost trust. | Opt-in editor app, one write route, user tokens only, clear text at sign-in. |
| Python and JavaScript read the format differently. | A file that one accepts and the other refuses. | Shared fixtures with expected text and errors; the schema as the neutral description. |
| An agent writes bad JSON by hand. | A canvas that does not open. | `canvas_edit` and `canvas apply` validate; `check` and the Stop hook report; the app falls back to the generated canvas. |
| A provider blocks its embed. | An empty frame. | The link card is always there. |
| Large canvases are slow. | A poor first impression. | 500 nodes at most; images load when visible; List view. |
| The pointer hook hides a gate from an agent. | An agent acts against a gate. | Gates stay in the pointer; opt-in first; hook scenarios test it. |
| Another JSON Canvas tool saves the file in its own order. | A large diff once. | `check` warns; `canvas apply` with no ops writes the canonical form. |

## Owner questions

Each question has a proposed answer. "Yes to all" is a valid reply.

| # | Question | Proposed answer | Blocks |
| --- | --- | --- | --- |
| 1 | Is slice 1 (sidebar and generated canvases, read-only) the right first step, with the one-week test? | Yes. | Slice 1 |
| 2 | May the reading view open over the canvas, or must all reading happen in cards? | The reading view stays, as an overlay. | Slice 1 |
| 3 | JSON Canvas 1.0 as the base format, in `.horsemen/canvas/*.canvas`? | Yes. A hidden folder keeps tool files out of the way. Say so if Obsidian must show the canvases; then the folder needs a visible name. | Slice 2 |
| 4 | Media limit: 1 MiB a file, warning at 20 MiB, GIFs included? | Yes. Larger GIFs become video links. | Slice 2 |
| 5 | CSV as the table format, XLSX preview later? | Yes. | Slice 2 |
| 6 | Pointer mode for the session hook: opt-in first, default later? | Opt-in first. | Slice 3 |
| 7 | Local MCP only for now; the hosted endpoint later? | Yes. | Slice 3 |
| 8 | Write permission: a second, opt-in editor app with Contents: Read and write? | Yes (option A). | Slice 4 |
| 9 | Browser editing covers canvases only; record text stays with agents and GitHub? | Yes. | Slice 4 |
| 10 | Saves go to the default branch with `[skip ci]`; protected branches wait for a later slice? | Yes. | Slice 4 |
| 11 | Notes have no author field; Git history shows who wrote what. Is that enough for "canvas discussion"? | Yes for now. Threads with names need a new decision. | Slice 4 |

## Build plan

Each slice is one pull request that merges and deploys alone. Each starts with
its failure list and tests, as CONTRIBUTING.md requires.

| Slice | Contents | Tests | Done when |
| --- | --- | --- | --- |
| **1. Generated canvases** | Sidebar with the switcher and the artifact list. A generated canvas for each artifact. Section cards open the reading view at the section. List view for each canvas. `?canvas=` and `?node=` links. | Rule tests: the layout is the same for the same record, no overlap, stable IDs, repeated headings. View tests. Browser checks, local and hosted, at desktop and phone width, with the keyboard. Worker test: sign-in keeps `canvas` and `node`. | Merged and deployed; the live files match main. Each artifact of a real project opens as a canvas. The owner's one-week answer is recorded in PROGRESS. |
| **2a. Canvas files, read-only** | Format modules in Python and JavaScript. Drawing of notes, section cards, portals, images, link cards, groups, and connectors. Both readers load `.horsemen/canvas/`. `check` rules: `canvas-invalid`, `canvas-not-canonical`, `canvas-dangling-ref`, `canvas-media-too-large`. | Shared fixtures: valid and invalid cases with the expected text and error, run by both languages. The schema accepts and refuses the same cases. Hostile cases: script text, `javascript:` address, CSS in a colour, 5,000 nodes, a 2 MiB file, a path with `..`. The SVG blob test. Browser checks. | An agent writes a canvas file by hand in a real repository and pushes; the hosted viewer shows it. An invalid file shows a message and the generated canvas. |
| **2b. Embeds and tables** | Click-to-load players, the `frame-src` list, CSV and TSV tables. | Worker test for the header. Unit tests: each provider's address to its frame address; unknown hosts stay link cards. Browser check against a local fake player. One live check for each provider. | A real video, a real sheet, and a CSV show on a deployed canvas. |
| **3a. Agent tools** | `horsemen_core` canvas functions. `horsemen show`, `horsemen canvas apply`. The stdio server with `read` and `canvas_edit`. `mcp install` and `mcp status`. Skill text for canvases. | Unit tests: each op, all-or-nothing, placement with `near`, `base_rev`. Server tests through a subprocess: start, list, call, bad JSON, unknown method, output limits. Budget tests. Wheel and skill ZIP checks include the new files. | In Claude Code and in Codex, a new session in a temporary project calls both tools. The receipts are saved with the verification output. |
| **3b. Hooks** | Pointer mode. Stop rules for canvases. Publish covers `.horsemen/`. | New hook scenarios: the pointer is 700 characters or less; gates stay; no canvas line without canvases; legacy mode is byte-for-byte the same; a broken card is reported once. All existing scenarios pass. | The owner's installed skill runs pointer mode in one real project for a week with no missed gate. |
| **4a. Browser editing** | A test of the GitHub commit call on a disposable repository. The editor app and its sign-in. `/write/canvas`. Edit mode: move, add a note, connect, delete, save. Conflict detection with a simple merge. New sign-in page text. | Worker tests: no session, viewer token only, public mode, wrong origin, wrong content type, size, each bad name, an invalid canvas, a conflict, a moved head. Merge unit tests for each row of the conflict table. Browser check against a fake GitHub: edit, save, a commit from outside, merge. A live check on a disposable repository with before and after recordings. | The owner edits a canvas on the hosted site and sees the commit on GitHub. A viewer-only user sees no new permission request. |
| **4b. Media and links in the browser** | Drop or paste an image, GIF, CSV, or address. The public-repository warning. The choice dialog for conflicts. | Worker tests: type checks, size, four files. Browser checks. | A dropped image shows on the canvas after one commit. |
| **4c. Protected branches** | Save to a `horsemen/canvas` branch with a pull request link. | Worker and browser tests with a fake protected branch. | A save on a protected repository ends in an open pull request page. |
| Later, not planned in detail | Hosted MCP for public repositories. XLSX preview. Record text editing. Branch views. Threads with names. | — | A new decision by the owner. |

## Design checks in this pull request

```sh
python3 docs/show-me/canvas-workspace/check.py --schema
```

```text
PASS: 2 canvases, 11 invalid cases (canonical form, references, limits, mock data, JSON Schema)
```

The check covers the two fixture canvases (canonical text, one element on
each line, references, limits), eleven invalid cases (seven that the schema
must refuse and four that only the reference rules can catch), and that the
mock shows the same fixture files. `--schema` runs `check-jsonschema` through
`uvx`. The fixture has one record on purpose, so the viewer does not list it
as a project.

The mock was checked in an isolated browser at 1440 and 390 pixels wide: each
artifact opens, a section opens the reading view, a moved card gives a
one-line change in the commit preview, the List view works, and the page has
no script errors and no sideways scroll on a phone.

## Sources

- [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/): node and edge types;
  no version field; order is the stacking order.
- [Choosing permissions for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app):
  minimum permissions; a user token is limited by the app and the user; a
  permission change needs approval for each installation.
- [Permissions required for GitHub Apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps):
  the contents write call needs Contents: write and accepts user tokens.
- [Repository contents API](https://docs.github.com/en/rest/repos/contents):
  the default branch when no branch is given; `sha` for an update; 1 MB for a
  full read; the workflow scope for `.github/workflows`.
- [GraphQL commits reference](https://docs.github.com/en/graphql/reference/commits):
  `createCommitOnBranch`, `expectedHeadOid`, signed commits.
- [REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api):
  5,000 requests an hour for a user; 80 content requests a minute and 500 an
  hour.
- [GitHub Apps API updates, 2020-10-26](https://github.blog/changelog/2020-10-26-github-apps-api-updates-now-ga):
  the single file permission and its ten paths.
- [MCP transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports):
  stdio messages are JSON-RPC, one on each line.
- [YouTube error 153 notes](https://til.simonwillison.net/youtube/fixing-153-embed):
  the player needs a referrer.
