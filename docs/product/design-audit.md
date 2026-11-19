# Design audit: workspace app and sign-in page

Date: 2026-11-19. Method: the Impeccable skill (version 4.10.0), `audit`
playbook (technical) and `critique` playbook (UX heuristics), on fictional
fixture data only.

> ⚠️ Degraded critique: single context. The owner does not want hidden
> agents, so Assessment A (design review) and Assessment B (detector and
> browser evidence) ran in one context. Assessment A was scored before the
> detector results were read.

## Scope

| Surface | Source | States checked |
| --- | --- | --- |
| Workspace app | `web/` | Rail, canvas, list view, peek with each record view, jump palette, theme menu |
| Hosted sign-in page | `worker/src/index.js` (`page()`, `signInPage()`) | Signed out, light and dark, Engraved and Beacon type |

Widths: desktop 1440 × 1000, tablet 820 × 1180, phone 390 × 844. Colour
themes: Bone, White horse, Pale horse, Ink, Red horse, Black horse. Type
sets: Engraved, Modern, System.

## Result

| # | Audit dimension | Before | After | Main point |
| --- | --- | --- | --- | --- |
| 1 | Accessibility | 2 | 3 | 42 text styles were under 11px; focus looked like selection |
| 2 | Performance | 3 | 3 | Fonts are small; System now downloads none |
| 3 | Theming | 3 | 3 | Strong tokens; the sign-in page still ignores the chosen colour theme |
| 4 | Responsive design | 2 | 3 | Phone canvas was unreadable; tablet canvas still shrinks cards |
| 5 | Implementation integrity | 3 | 3 | Coherent world; some decorative habits remain |
| | **Total** | **13/20** | **16/20** | Acceptable → Good |

Detector (`impeccable detect`), rendered page with fixtures:

| Viewport | Findings before | Findings after |
| --- | --- | --- |
| 1440 × 1000 | 37 (32 undersized text) | 2 |
| 820 × 1180 | 33 (28 undersized text) | 2 |
| 390 × 844 | 28 (24 undersized text) | 2 |

The two findings that remain on each viewport are expected: one 11px mono
meta line, and the engraving hatch (see false positives).

## Findings by severity

"Fixed" means this pull request changes it and a test covers it.

| # | Severity | Finding | Where | Status |
| --- | --- | --- | --- | --- |
| 1 | P1 | 42 text styles used 8.5px to 10.5px, mostly tracked uppercase labels. They are hard to read on any screen and worse at canvas zoom. | `web/style.css` | Fixed. Floor is 11px (10.5px for key caps and the tagline). Tracking on those labels went from 0.16–0.18em to 0.12–0.14em. `tests/test_gui_themes.cjs` fails on any smaller size. |
| 2 | P1 | On a phone, Fit draws the canvas at 39%. Card text is about 4px high. | Canvas at 390px | Fixed. Screens 640px and narrower open in List view. Canvas stays one tap away. Browser check: "A phone opens in List view". |
| 3 | P1 | On a phone, the theme menu opened upward from the top rail, off the screen. When it opened downward, page content covered it. | `.theme-menu`, `.rail` | Fixed. On a phone the menu opens downward above the page and scrolls when it is tall. Browser check: "the theme menu opens on screen". |
| 4 | P2 | Placeholder text used `--ink-3` at 4.4:1 on Bone. The breadcrumb separator also used `--ink-3`. | Search and Jump fields, peek path | Fixed. Both use `--ink-2`. The theme test now rejects `--ink-3` as a text colour. |
| 5 | P2 | Keyboard focus and selection drew the same ring on canvas cards. A keyboard user could not tell them apart. | `.canvas .artifact` | Fixed. Focus is a dashed ring in the focus colour. Focus on a selected card adds an outer ring. |
| 6 | P2 | The sign-in page declared its variable fonts without a weight range. Browsers synthesized the 600 weight. | `page()` | Fixed. Each `@font-face` declares `100 900`. Worker test covers it. |
| 7 | P2 | The sign-in page did not follow the type choice. | `page()` | Fixed. It loads `/theme.js` and has Modern and System rules. |
| 8 | P2 | On tablet portrait and small laptops, Fit draws cards at 64% to 74%. Card body text is 7px to 9px. | Canvas | Not fixed. Needs a design decision (see larger ideas). |
| 9 | P2 | Each record carries a kicker above its title ("II · War · Campaign"), a roman numeral, a seal, and a watermark. Impeccable's craft floor bans kickers above headings. They also add recall load for new readers. | Cards, peek headers | Not fixed. It is part of the owner's engraved identity. See larger ideas. |
| 10 | P3 | The active project and the current peek record had a stripe on one side of a rounded box. | `.project.active`, `.peek-record[aria-current]` | Fixed. They use a full border in the accent colour. |
| 11 | P3 | Link buttons said "1 links". | Card link toggle | Fixed. Canvas rule test covers it. |
| 12 | P3 | The rail tagline wrapped with one word on its second line. | `.wordmark small` | Fixed with balanced wrapping. |
| 13 | P3 | Progress lanes use a thick top border on a rounded box. | `.lane` | Not fixed. The colour carries status; the label also says it. |
| 14 | P3 | Reduced motion removes every animation and transition, also small state feedback. | `@media (prefers-reduced-motion)` | Not fixed. Safe, but blunt. |
| 15 | P3 | The card link toggle is 26px high. It passes the 24px minimum but is under 44px for touch. | `.card-links-toggle` | Not fixed. |
| 16 | P3 | Card footers show "pinned aaaaaaa", which assumes Git knowledge. | Card footer | Not fixed. Copy change needs the owner. |
| 17 | P3 | The sign-in page follows the device light or dark setting, not the chosen colour theme. | `page()` | Not fixed. |

### Detector results that are not defects

- `cream-palette`: bone paper is the owner's chosen world.
- `repeating-stripes-gradient`: the engraving hatch is part of the identity.
- `cramped-padding` on `.cardfoot`: the footer centres its text in a 42px
  minimum height, so it has space.
- `border-accent-on-rounded` on lanes: see finding 13.
- Impeccable's craft floor refuses a system font as a display face. The
  owner asked for a System set that downloads nothing, so the request wins.

## Critique (UX heuristics)

| # | Heuristic | Score | Main issue |
| --- | --- | --- | --- |
| 1 | Visibility of system status | 3 | Scan line and toasts are clear; the canvas does not show which project is loading |
| 2 | Match with the real world | 2 | Horsemen names and roman numerals need learning; "pinned aaaaaaa" is Git language |
| 3 | User control and freedom | 3 | Escape, Back, Reset layout, and path steps work everywhere |
| 4 | Consistency and standards | 3 | Consistent controls; focus and selection looked the same (fixed) |
| 5 | Error prevention | 3 | Read-only by design; Clear workspace only removes the scan |
| 6 | Recognition rather than recall | 3 | Jump field and labels help; the theme and clear buttons are icon-only |
| 7 | Flexibility and efficiency | 4 | Shortcuts, jump field, list and canvas views, saved layouts |
| 8 | Aesthetic and minimalist design | 2 | Many small labels compete on each card |
| 9 | Error recovery | 3 | Errors name the repository and the problem |
| 10 | Help and documentation | 2 | One hint line and the README; no in-app help for canvas gestures |
| | **Total** | **28/40** | Good |

Cognitive load: 2 of 8 checklist items fail (moderate). Visual hierarchy on
cards is weak because the rider line, field labels, and footer all use small
tracked capitals. The theme menu has 10 choices; two labelled groups (Colours
and Type) keep each decision at 7 and 3.

Personas:

- **Power user:** Ctrl/Cmd + K reaches every project, record, view, theme,
  and type set. Canvas keys are complete. No red flags.
- **First-time reader:** "I · Conquest · Direction" means nothing until the
  reader learns the metaphor. "pinned aaaaaaa" is unclear. The hint line is
  the only gesture help.
- **Keyboard and screen reader user:** Cards are real buttons with names.
  Focus and selection looked the same (fixed). Placeholders were below 4.5:1
  (fixed).
- **Solo operator with several projects (from PRODUCT.md):** The Progress card
  and board show the next action first. Good. On a laptop, Fit makes card text
  small enough that the operator must open each peek.

What works: the record views give each record type its own shape; the jump
field is fast; colour tokens are complete and tested in six themes.

## Type sets

Themes replaced the type sets on 2026-11-19; see
[Style themes](#style-themes-2026-11-19). This section is the earlier record.

The theme button and the Ctrl/Cmd + K field both choose a type set. The
choice applies before first paint and is saved in the browser as
`horsemen-type`. Each set changes fonts only, so every colour theme keeps its
tested contrast.

| Set | Fonts | Preloaded | Downloads on first view |
| --- | --- | --- | --- |
| Engraved (default) | Cleft titles, Gravure labels, Halden interface, Vellum reading, Signal code | Cleft, Halden (54.6 KB) | Up to 5 files, 120.0 KB |
| Modern | Beacon for titles, labels, interface, and reading; Signal for code | Beacon (26.1 KB) | Up to 2 files, 42.0 KB |
| System | Device fonts (`system-ui`, `ui-monospace`) | None | None |

Why Beacon: fontzz describes it as a legible sans with generous spacing, a
tailed l, and a serifed capital I. A side-by-side test with the app's own
copy compared it with Halden, Quill, and Meridian. Beacon had the most open
shapes and the clearest I, l, and 1 at 12.5px and 15px. One file covers the
whole set, which keeps the download small.

Licence: Beacon is © 2026 The Beacon Project Authors under the SIL Open Font
License 1.1, with no reserved font name. The OFL permits bundling and
redistribution with software, including in a public repository. The name
table states the licence, and the fontzz repository LICENSE is the OFL 1.1.
The file is unmodified. It already contains only 285 Latin code points, so a
further subset would save little and would make it a modified font.
`web/assets/fonts/NOTICE.txt` and `OFL.txt` list it.

## Larger ideas (not in this change)

1. **Readable canvas at any zoom.** Below about 80%, show a compact card face
   (title, one line, status) instead of scaling the full card. This fixes
   finding 8 without losing the map.
2. **Fewer labels per card.** Keep the seal and the record name. Move the
   rider line to the peek, or show it only on hover. This answers finding 9
   and the minimalism score.
3. **Explain the metaphor once.** A short first-run note or a legend entry
   could say "Vision = Conquest" in plain words.
4. **Plain footer copy.** Replace "pinned aaaaaaa" with "Commit aaaaaaa".
5. **One theme across pages.** Give the sign-in page the chosen colour theme.

## Minimal pass (2026-11-19)

The owner said the workspace was still overwhelming and asked for a simpler
screen and better views inside each record. Method: Impeccable `critique`,
then the `distill`, `quieter`, `layout`, and `typeset` playbooks, then
`critique` again. Fictional fixtures only.

> ⚠️ Degraded critique: single context, for the same reason as above. Each
> design review was scored before the detector results were read.

| # | Heuristic | Before | After | What changed |
| --- | --- | --- | --- | --- |
| 1 | Visibility of system status | 3 | 3 | The status line shows only during discovery, after an error, or after Clear workspace; the menu keeps the last check time |
| 2 | Match with the real world | 2 | 3 | No rider lore or roman numerals; "pinned aaaaaaa" became "commit aaaaaaa" in one meta line |
| 3 | User control and freedom | 3 | 3 | Escape, Back, path steps, and Reset layout (in Jump) still work |
| 4 | Consistency and standards | 3 | 3 | One search (Jump) instead of two; one menu pattern in the rail and the record |
| 5 | Error prevention | 3 | 3 | Clear workspace moved into the menu, away from the header |
| 6 | Recognition rather than recall | 3 | 3 | Canvas tools moved to keys and Jump; the `?` sheet and Jump hints name each key |
| 7 | Flexibility and efficiency | 4 | 4 | Jump now also reaches the canvas tools, linked documents, and the shortcut sheet |
| 8 | Aesthetic and minimalist design | 1 | 3 | Home went from 16 controls (not counting cards and projects) to 8; the record view lost its tabs, kicker, seal, facts box, helper text, and hint line |
| 9 | Error recovery | 3 | 3 | Unchanged |
| 10 | Help and documentation | 2 | 3 | A shortcut sheet from `?` and from Jump |
| | **Total** | **27/40** | **31/40** | Acceptable → Good |

Cognitive load: 4 of 8 checklist items failed before (single focus, visual
hierarchy, minimal choices, progressive disclosure). None fail after.

Detector (`impeccable detect`):

| Scan | Before | After |
| --- | --- | --- |
| Rendered page, 1440 × 900 | 2 (11px text, engraving hatch) | 0 |
| Rendered page, 820 × 1180 | not run | 0 |
| Rendered page, 390 × 844 | 2 (11px text, engraving hatch) | 0 |
| Source, `web/` | 10 | 2 |

The two source findings that remain are expected. `cream-palette` is the
owner's bone paper. `clipped-overflow-container` is the record menu inside
the record view, which clips its content to its rounded corners; the menu is
about 190px high and the record view is at least 480px high, so the menu
always fits.

Changes:

- **Rail:** the brand, the project list (search appears for more than eight
  projects), and one account menu: Refresh GitHub, Choose repositories
  (hosted), colours, type set, Clear workspace, and Sign out (hosted).
- **Header:** the project name with a lock for private repositories, one meta
  line, Jump, Canvas or List, and Copy link (hosted).
- **Canvas:** no legend, hint lines, or tool dock. A small zoom control
  stays. Cards show the record name, a few key lines, and the record colour
  on the icon. No hatching, seals, or lore. Brain and Structure cards show
  source names and top-level paths instead of raw table and tree text.
- **Record view:** one column of about 70 characters; a header with the name,
  stated facts, Open on GitHub, a ⋯ menu (layouts, full document, Markdown
  source), and Close. A compact record list; "On this page" only for long
  records; quiet previous and next arrows at the end of the page. The record
  fills the screen on a phone.
- **Views:** see [artifact views](artifact-views.md). Progress now reads as a
  list by default; the board is the second layout.
- **Type:** five sizes (12, 14, 16.5, 20, and 26px). The theme test now fails
  on any text under 12px.

## Style themes (2026-11-19)

The owner asked for several themes, each with its own style. The account
menu and Jump now show a gallery of eight themes. Method: Impeccable
4.10.0, typeset guidance and the `audit` playbook, in one context with no
sub-agents, on fictional fixtures. The owner's brief named each theme, so no
direction roll ran.

| Theme | Preloaded | Downloads on first view |
| --- | --- | --- |
| Engraved (default) | Cleft, Halden (54.6 KB) | Up to 5 files, 120.0 KB |
| Modern | Beacon (26.1 KB) | Up to 2 files, 42.0 KB |
| Editorial | Opaline, Folio (52.9 KB) | Up to 3 files, 68.8 KB |
| Terminal | Diode (9.1 KB) | 1 file, 9.1 KB; text uses device monospace |
| Swiss | Halden (27.7 KB) | Up to 2 files, 43.5 KB |
| Blueprint | Tessera, Signal (44.4 KB) | 2 files, 44.4 KB |
| Soft | Brioche, Mallow (71.0 KB) | Up to 3 files, 86.9 KB |
| High contrast | Beacon (26.1 KB) | Up to 2 files, 42.0 KB |

The type sets folded into the themes. Modern (Beacon) and High contrast
(Beacon, 112.5% text) are the readable choices. A saved Modern or System type
set opens the Modern theme. One choice is simpler than a theme plus a
separate type control, and the type sets only changed fonts, which Modern and
High contrast already cover.

| # | Audit dimension | Score | Main point |
| --- | --- | --- | --- |
| 1 | Accessibility | 3 | Every theme and mode passes the contrast test; arrow keys move through the 2-column gallery in one line |
| 2 | Performance | 3 | Only the active theme's fonts load; the gallery loads about 268 KB of preview fonts the first time it opens |
| 3 | Theming | 4 | Every colour and shape is a token; no hard-coded colour outside the theme blocks |
| 4 | Responsive design | 3 | Every theme and record view fits at 390px; Swiss and Editorial use the shared, smaller phone type scale |
| 5 | Implementation integrity | 3 | Detector: 3 findings, 1 false positive and 2 that existed before |
| | **Total** | **16/20** | **Good** |

Detector findings (`impeccable detect` on `web/style.css` and
`web/index.html`):

- *Border accent on a rounded element*, Swiss cards: false positive. Swiss
  cards have 0px corners; the heavy top rule is the Swiss section bar.
- *Positioned child clipped by overflow container*, the record ⋯ menu inside
  the record dialog: advisory, from before this change. The menu fits inside
  the dialog.
- *Cream palette*, Engraved Bone: from before this change. Bone paper is the
  owner's chosen identity.

Open items:

| # | Severity | Finding | Recommendation |
| --- | --- | --- | --- |
| 1 | P2 | The gallery loads the preview fonts of every theme the first time it opens (about 268 KB, then cached). | If this matters on slow links, draw previews in the active theme's fonts and show only colour and shape. |
| 2 | P3 | Arrow keys move through the gallery in reading order, not by row and column. | Add 2-D arrow movement in `web/app.js` menu keys. |
| 3 | P3 | The search field clear button in Jump keeps the browser's blue colour in every theme. | Style `::-webkit-search-cancel-button` from tokens. |
| 4 | P3 | Terminal uses monospace as its identity. Impeccable's craft floor calls that a costume on working screens; the owner's brief asked for it. | Keep it as an option, not a default. |

Evidence: `node tests/test_gui_themes.cjs` (16 theme and mode variants),
`python3 scripts/test_gui_e2e.py --output <dir>` (each theme applied,
reloaded, font check, overflow check at 1440px and 390px, and screenshots
`theme-<id>-home.png` and `theme-<id>-progress.png`).

## Reproduce

Run from the repository root. Each command uses fictional fixtures and writes
outside the repository.

```sh
node tests/test_gui_themes.cjs
node tests/test_canvas_state.cjs
node --test tests/test_hosted_reader.cjs worker/test/worker.test.js
python3 scripts/test_gui_e2e.py --output /tmp/horsemen-gui-check
python3 scripts/test_hosted_e2e.py --output /tmp/horsemen-hosted-check
```

The browser check saves screenshots for each record view, each type set
(`desktop-modern.png`, `progress-peek-modern.png`, `desktop-system.png`), and
the phone list (`mobile-list.png`). Screenshots are not kept in Git.

For the detector, start the fixture server that `scripts/test_gui_e2e.py`
builds (`make_server` with the fake GitHub), then run
`impeccable detect --json --viewport 390x844 <url>` for each width.
