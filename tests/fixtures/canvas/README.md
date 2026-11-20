# Shared canvas fixtures

These cases keep the Python reader (`horsemen/scripts/horsemen_core/canvas.py`)
and the JavaScript reader the same. Each reader runs each case and must give
the same errors and the same canonical text. All data is fictional.

The rules come from [the canvas design](../../../docs/product/canvas-workspace.md)
and [the schema](../../../docs/product/canvas.schema.json). Where the design
does not state a detail, this page states it.

| Path | Contents |
| --- | --- |
| `cases.json` | The cases and their expected results |
| `files/` | Input files for cases |
| `expected/` | Expected canonical text for inputs that are valid but not canonical |
| `workspace/` | A fictional project for the reference rules: one record, two canvases, two media files |

Python runs the cases with `python3 -B -m unittest tests.test_canvas_format`.

## Case format

`cases.json` has four lists: `cases`, `slugs`, `sections`, and `headings`.

A case in `cases` has these keys:

| Key | Meaning |
| --- | --- |
| `name`, `note` | The name of the case and what it shows |
| `input` | `{"file": PATH}` or `{"build": [PART, ...]}`. The input is bytes |
| `workspace` | A folder in this directory. When present, also run the reference rules against its files |
| `virtual` | Files to add to the workspace for this case: `{PATH: {"size": BYTES}}`. A virtual file has a size and no content |
| `expect.errors` | The full, ordered list of `{"code", "message"}`. An empty list means the file is valid |
| `expect.canonical` | For a valid file: `true` when the input bytes are already the canonical text |
| `expect.text` | For a valid file: the canonical text, inline or as `{"file": PATH}`. Absent for some large inputs |
| `expect.read_only` | `true` when `horsemen.version` is higher than 1 |
| `schema` | What `docs/product/canvas.schema.json` says about the input, when the input is JSON that a validator can read |

For each valid file, also check that the canonical text gives the same text
when it is read and written again.

A `build` input joins its parts in order:

| Part | Bytes |
| --- | --- |
| `{"text": T}` | `T` as UTF-8 |
| `{"hex": H}` | The bytes that the hexadecimal text `H` names |
| `{"repeat": T, "count": N, "join": J}` | `T` written `N` times with `J` between (`J` is optional). Each `{i}` in `T` becomes the index, from 0 |

## Read and check, in this order

A check returns at most 20 errors. Steps 1 to 7 stop at the first error.
Steps 10 and 11 run only when steps 1 to 9 gave no error.

1. More than 524,288 bytes: `file is larger than 512 KiB`.
2. Not UTF-8: `file is not valid UTF-8`. One byte order mark at the start is
   removed.
3. Not JSON: `file has Git conflict markers` when a line starts with
   `<<<<<<<`, `=======`, or `>>>>>>>`; or else `file is not valid JSON`.
   `NaN` and `Infinity` are not JSON. A repeated key keeps its last value.
   When the parser runs out of stack, use the error of step 4.
4. Containers nested deeper than 32 levels (the top object is level 1):
   `file is nested deeper than 32 levels`.
5. A number that is not finite after parsing: `file has a number that is too large`.
   A string or key with half of a surrogate pair:
   `file has text that is not valid Unicode`.
6. The top level is not an object: `file must be a JSON object`.
7. `horsemen` is present but is not an object with an integer `version` of 1
   or more. Then `nodes` and `edges`: each must be a list when present, with
   at most 500 nodes and 1,000 edges. When a count is over its limit, do not
   check the elements.
8. Each node in file order, then each edge in file order. The rules for one
   element run in the order of the tables below. An element with a valid `id`
   is named `node ID` or `edge ID`; otherwise `node at position N` or
   `edge at position N`, where N starts at 1.
9. Each ID that occurs again, across nodes and edges: `duplicate id ID`, once
   for each ID, in the order of the second occurrence.
10. Each edge end that is a valid ID but names no node:
    `edge ID: fromNode X is not a node` (code `canvas-dangling-ref`).
11. With a workspace, the reference rules for each node in file order.

All errors of steps 1 to 9 have the code `canvas-invalid`.

### Node rules

| Key | Rule | Message after `node ID: ` |
| --- | --- | --- |
| (the node) | An object | `must be an object` |
| `id` | `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`, the whole string | `id must be 1 to 64 letters, digits, "_" or "-", and start with a letter or digit` |
| `type` | A string of 1 to 32 characters | `type must be a string of 1 to 32 characters` |
| `x`, `y` | A whole number from -1,000,000 to 1,000,000 | `x must be a whole number from -1,000,000 to 1,000,000` |
| `width`, `height` | A whole number from 16 to 8,192 | `width must be a whole number from 16 to 8,192` |
| `color` | When present: `"1"` to `"6"`, or `#` and six hexadecimal digits | `color must be "1" to "6" or #RRGGBB` |
| `text` (type `text`) | Required. A string of 20,000 characters or less | `text must be a string of 20,000 characters or less` |
| `file` (type `file`) | Required. A path (below) | `file must be a path inside the project (no leading "/", no "." or ".." part, no backslash)` |
| `subpath` (type `file`) | When present: `#` and 1 to 300 characters, none below U+0020 | `subpath must start with "#" and have 1 to 300 more characters` |
| `alt` (type `file`) | When present: a string of 500 characters or less | `alt must be a string of 500 characters or less` |
| `url` (type `link`) | Required. An address (below) | `url must be an http or https address of 2,048 characters or less` |
| `title` (type `link`) | When present: a string of 200 characters or less | `title must be a string of 200 characters or less` |
| `label` (type `group`) | When present: a string of 200 characters or less | `label must be a string of 200 characters or less` |
| `background` (type `group`) | When present: a path | `background must be a path inside the project (...)`, as for `file` |
| `backgroundStyle` (type `group`) | When present: `cover`, `ratio`, or `repeat` | `backgroundStyle must be "cover", "ratio", or "repeat"` |

- A whole number is a JSON number with no fraction part. `1.0` and `3.2e2`
  are whole numbers. `true` and `"1"` are not numbers.
- A key that is present with the value `null` fails its rule.
- Lengths count Unicode characters (code points), not UTF-16 units.
- Keys of another type are not checked: a `url` on a `text` node is unknown
  data. A node with an unknown `type` is valid when its six base keys and its
  `color` are valid.
- A path is a string of 1 to 1,024 characters with no leading `/`, no part
  that is `.` or `..`, no backslash, and no character below U+0020.
- An address starts with `http://` or `https://` in lower case, has one
  character or more after that, has 2,048 characters or less, and has no
  character below U+0020 and none of these white space characters: U+0020,
  U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000,
  U+FEFF.

### Edge rules

| Key | Rule | Message after `edge ID: ` |
| --- | --- | --- |
| (the edge) | An object | `must be an object` |
| `id` | As for a node | As for a node |
| `fromNode`, `toNode` | Required. A string in the ID pattern | `fromNode must be an id` |
| `fromSide`, `toSide` | When present: `top`, `right`, `bottom`, or `left` | `fromSide must be "top", "right", "bottom", or "left"` |
| `fromEnd`, `toEnd` | When present: `none` or `arrow` | `fromEnd must be "none" or "arrow"` |
| `color` | As for a node | As for a node |
| `label` | When present: a string of 200 characters or less | `label must be a string of 200 characters or less` |

### Reference rules

The caller gives a lookup from a project path to a regular file inside the
project: its size, and its text when it is Markdown. A folder, a missing
file, a path with an empty part (`a//b`, `a/`), and a link that leaves the
project are all "does not exist". The extension of a path is the text from
the last `.` of the file name, in lower case, when that `.` is not the first
character of the name.

For a `file` node, check `file`. For a `group` node, check `background` when
present. The first rule that fails ends the checks for that key.

| Rule | Code | Message after `node ID: ` |
| --- | --- | --- |
| The file exists | `canvas-dangling-ref` | `file PATH does not exist` |
| A file in `.horsemen/media/` has a media extension | `canvas-invalid` | `file PATH is not a supported media type` |
| For `file` with a `subpath` on a `.md` file: the heading exists | `canvas-dangling-ref` | `heading #Heading is not in PATH` |
| A file with a media extension has 1,048,576 bytes or less | `canvas-media-too-large` | `file PATH is larger than 1 MiB` |

Media extensions, in any letter case: `.png`, `.jpg`, `.jpeg`, `.gif`,
`.webp`, `.svg`, `.csv`, `.tsv`, `.xlsx`. A `subpath` on a file that is not
Markdown is not checked. The Python tools also check that the content of a
media file matches its extension; that check needs the bytes and is not part
of these cases.

## Canonical text

```text
{
"horsemen":{"version":1},
"nodes":[
{"id":"g","type":"group","x":0,"y":0,"width":640,"height":360,"label":"Frame"},
{"id":"a","type":"text","x":0,"y":0,"width":320,"height":140,"text":"Note"}
],
"edges":[
{"id":"e","fromNode":"a","toNode":"g"}
]
}
```

- UTF-8, no byte order mark, line feeds, a final line feed, no spaces.
- `horsemen` first (`{"version":1}` when the file has none), then `nodes`,
  then `edges`, then the other top-level keys in order, each on one line.
- An empty list is `"nodes":[]` on one line.
- Nodes: groups first, then the others; each set by `id`. Edges by `id`.
  IDs are ASCII, so the order is by character code: `-`, digits, upper case,
  `_`, lower case.
- Node keys: `id`, `type`, `x`, `y`, `width`, `height`, then the others in
  order. Edge keys: `id`, `fromNode`, `toNode`, then the others in order.
- "In order" for keys means by UTF-16 code unit, which is the default sort
  in JavaScript. Keys of nested objects are sorted the same way. Lists keep
  their order.
- Strings: `\"`, `\\`, `\b`, `\f`, `\n`, `\r`, `\t`, and `\u00XX` in lower
  case for other characters below U+0020. Each other character is written as
  itself. This is the output of `JSON.stringify`.
- Numbers: the text that JavaScript gives for the number after `JSON.parse`.
  A whole number has no fraction and no exponent below 10^21. `1.0` is `1`,
  `-0` is `0`, `1e21` is `1e+21`, and `9007199254740993` is
  `9007199254740992`.

## Headings and section cards

- Split Markdown on line feeds. Remove one carriage return at the end of a
  line.
- A line that starts with three backticks or three tildes, after optional
  spaces and tabs, starts or ends fenced code. A heading inside is ignored.
- A heading is 1 to 6 `#` at the start of the line, then a space or tab,
  then the title. Remove white space at both ends of the title. Then remove
  a closing run of `#` when a space or tab is before it. A line with no
  title is not a heading.
- A subpath `#A#B` names heading `B` below heading `A`. Compare titles after
  trimming and lower-casing. Take the first heading that matches `A`; then
  look for `B` after it, and stop at the next heading of the same or a
  higher level than `A`. The `headings` list has cases.
- A generated section card exists for each second-level heading. The rule
  is the live rule of slice 1 in `web/canvas-sections.js`, so a card that an
  agent saves has the same ID as the card that the browser draws:
  - Remove HTML comments. Split on line feeds. A line that starts with three
    backticks, after optional white space, starts or ends fenced code; a
    `~~~` line does not. A card heading is `##`, white space, then the title.
  - The title is the heading text without Markdown marks: no HTML tags, link
    text instead of links, no `*` or backticks, white space removed at both
    ends.
  - The ID is `s-` plus the slug of the title: decompose (NFKD), remove the
    combining marks U+0300 to U+036F, lower-case, join each run of other
    characters than `a-z` and `0-9` with `-`, remove `-` at both ends, cut
    to 56 characters, and remove a `-` at the end again. An empty slug is
    `section`. The second card with the same slug gets `-2`, the third
    `-3`; an ID that is in use takes the next free number.
  - The `slugs` and `sections` lists have cases.
- The subpath rules above trim spaces and tabs only, not other white space.
  Heading references are checked in `.md` files only; a `.markdown` file is
  a document, and its headings are not checked.

## Change a case

Edit `cases.json` by hand and write the expected value from the rules, not
from the output of a reader. `tests/test_canvas_format.py` also checks that
the files copied from the design fixture have not changed.
