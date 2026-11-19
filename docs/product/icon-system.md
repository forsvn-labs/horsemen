# Horsemen icon system

Original SVG artwork for the local web app. The small icons serve controls and
record labels. The workspace does not show the seals by default; they stay
available for larger artwork. The app mark
uses four horse profiles that face inward. No font or external image is required.

## Files

| File in `web/assets/icons/` | Purpose |
| --- | --- |
| `icons.svg` | 41 symbols on a 24 × 24 grid |
| `seals.svg` | Four engraved seals on a 120 × 120 grid |
| `app-icon.svg` | Full colour master on a 1024 × 1024 grid |
| `app-icon.png` | 1024 × 1024 transparent-corner export |
| `apple-touch-icon.png` | 180 × 180 export of the app master |
| `favicon.svg` | Simplified four-head mark on a 32 × 32 grid |

## Use

Serve the sprites from the same origin as the app. External SVG symbols need HTTP;
opening the page through `file://` can block them.

```html
<svg class="icon" aria-hidden="true">
  <use href="/assets/icons/icons.svg#vision"/>
</svg>
<svg class="seal" aria-hidden="true">
  <use href="/assets/icons/seals.svg#seal-vision"/>
</svg>
```

```css
.icon {
  width: 24px;
  height: 24px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
}
.seal {
  width: 120px;
  height: 120px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.3;
}
```

Use 16, 20, or 24 px for controls. Scale strokes with the viewBox; do not add
`vector-effect: non-scaling-stroke`. Caps and joins are round in each symbol.
Seals have a fixed 0.8-unit border hatch. Use seals at 80 px or larger. A watermark
can use 0.06–0.10 opacity. Keep it behind content and out of the pointer path.
Give icon-only buttons an accessible name. Use a text label for status and record
meaning; colour alone is insufficient.

## Record inventory

| Small id | Seal id | Attribute | Pigment |
| --- | --- | --- | --- |
| `vision` | `seal-vision` | Crown, drawn bow and arrow: Conquest | `#B8892B` |
| `progress` | `seal-progress` | Raised sword: War | `#C8402B` |
| `brain` | `seal-brain` | Balance scales: Famine | `#33407A` |
| `structure` | `seal-structure` | Hourglass, with scythe blade in seal: Death | `#4E8C7A` |
| `readme` | — | Open book | Inherit |
| `changelog` | — | Scroll | Inherit |
| `techstack` | — | Anvil | Inherit |

Use bone paper `#F3EEE3` and ink `#16130F` as grounds. All sprite shapes inherit
paint from the consumer. Use bone strokes on dark grounds when a pigment lacks
contrast. The favicon uses lighter versions of the four pigments on ink.

## Control inventory

| Id | Use |
| --- | --- |
| `document` | Generic source file |
| `link` | Connected document |
| `external` | Open an outside source |
| `search` | Find a project or record |
| `github` | GitHub connector; original cat and repository bracket |
| `home` | Home canvas in the rail |
| `canvas` | Canvas view |
| `list` | List view |
| `select` | Selection tool |
| `hand` | Pan tool |
| `plus` | Zoom in or add |
| `minus` | Zoom out |
| `fit` | Fit the canvas |
| `reset` | Restore the layout |
| `expand` | Expand links or a view |
| `collapse` | Collapse links or a view |
| `chevron-right` | Closed disclosure |
| `chevron-down` | Open disclosure |
| `close` | Close a panel |
| `back` | Previous document |
| `arrow-up-right` | Open a record |
| `refresh` | Refresh discovery |
| `clear` | Clear the workspace |
| `check` | Confirmed state |
| `warning` | Attention required |
| `lock` | Private access |
| `globe` | Public access |
| `sun` | Light theme |
| `moon` | Dark theme |
| `device` | Mode that follows the device |
| `share` | Share action |
| `layers` | Record layers |
| `branch` | Linked branch |
| `type` | Type (not used since themes replaced type sets) |

## Origin and limits

All paths were drawn for Horsemen from geometric lines and curves. No third-party
icon set, font glyph, photograph, or traced artwork was used. The four rider
attributes and engraving idea follow the supplied art direction. The seals share
an original horse profile, ring construction, and hatch pattern. The GitHub glyph
is a custom connector symbol, not an official GitHub logo.

The assets are ready for integration; this change does not wire them into the app.
Sprites need explicit consumer fill and stroke. Seals are decorative at small sizes.
The app mark is suitable from 32 px; use the simplified favicon at 16 px. Pigments
are identity accents, not a guarantee of text or control contrast. Apple can apply
its own icon mask; the PNG retains the supplied rounded-square design.
