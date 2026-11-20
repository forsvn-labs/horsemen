"""Canvas files: read, check, canonical text, edit ops, and placement.

A canvas is a JSON Canvas 1.0 file with the Horsemen profile, in
`.horsemen/canvas/<name>.canvas`. The JavaScript reader follows the same rules;
`tests/fixtures/canvas/` in the source repository holds the shared cases.

Standard library only, and no import from this package: the legacy script and
the hooks load this module on their own.
"""
import copy
import hashlib
import json
import os
import re
from collections import namedtuple
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlsplit

MAX_BYTES = 512 * 1024
MAX_NODES = 500
MAX_EDGES = 1000
MAX_FILES = 20
MAX_MEDIA = 1024 * 1024
MAX_MEDIA_FOLDER = 20 * 1024 * 1024
MAX_TEXT = 20000
MAX_DEPTH = 32
MAX_ERRORS = 20
MAX_OPS = 50
FOLDER = '.horsemen/canvas'
MEDIA_FOLDER = '.horsemen/media'
SUFFIX = '.canvas'

INVALID = 'canvas-invalid'
NOT_CANONICAL = 'canvas-not-canonical'
DANGLING = 'canvas-dangling-ref'
MEDIA_TOO_LARGE = 'canvas-media-too-large'

NAME = re.compile(r'[a-z0-9][a-z0-9-]{0,63}')
ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}')
COLOR = re.compile(r'[1-6]|#[0-9A-Fa-f]{6}')
RECORDS = {'vision': 'VISION.md', 'progress': 'PROGRESS.md', 'brain': 'BRAIN.md', 'structure': 'STRUCTURE.md',
           'readme': 'README.md', 'changelog': 'CHANGELOG.md', 'techstack': 'TECHSTACK.md'}
MEDIA = {'.png': 'PNG', '.jpg': 'JPEG', '.jpeg': 'JPEG', '.gif': 'GIF', '.webp': 'WebP', '.svg': 'SVG',
         '.csv': 'CSV', '.tsv': 'TSV', '.xlsx': 'XLSX'}
IMAGES = ('.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg')
SHEETS = ('.csv', '.tsv', '.xlsx')
NODE_FIRST = ('id', 'type', 'x', 'y', 'width', 'height')
TYPES = ('text', 'file', 'link', 'group')
# The outline names kinds. A kind is not a type; an edit op that sends one gets the type to use.
KIND_TYPES = {'note': 'text', 'section': 'file', 'record': 'file', 'canvas': 'file', 'image': 'file', 'sheet': 'file',
              'video': 'link', 'embed': 'link'}
EDGE_FIRST = ('id', 'fromNode', 'toNode')
SIDES = ('top', 'right', 'bottom', 'left')
ENDS = ('none', 'arrow')
NEAR_SIDES = ('right', 'left', 'below', 'above')
STYLES = ('cover', 'ratio', 'repeat')
GAP = 40
SIZES = {'note': (320, 140), 'section': (320, 200), 'record': (320, 120), 'canvas': (320, 100), 'image': (400, 250),
         'sheet': (480, 250), 'link': (320, 120), 'video': (480, 270), 'embed': (480, 270), 'group': (640, 360), 'file': (320, 120)}
PREFIXES = {'note': 'note', 'record': 'ref', 'canvas': 'to', 'image': 'img', 'sheet': 'sheet', 'link': 'link',
            'video': 'link', 'embed': 'link', 'group': 'g', 'file': 'file'}

_CONTROL = re.compile('[\x00-\x1f]')
_SURROGATE = re.compile('[\ud800-\udfff]')
# White space that ECMAScript `\s` matches and that is not below U+0020.
_URL_SPACE = re.compile('[    -     　﻿]')
_CONFLICT = re.compile(r'(?m)^(?:<{7}|={7}|>{7})')
_FENCE = re.compile(r'[ \t]*(?:```|~~~)')
_HEADING = re.compile(r'(#{1,6})[ \t]+(.*)', re.S)

ID_RULE = 'id must be 1 to 64 letters, digits, "_" or "-", and start with a letter or digit'
PATH_RULE = '{} must be a path inside the project (no leading "/", no "." or ".." part, no backslash)'
URL_RULE = 'url must be an http or https address of 2,048 characters or less'
COLOR_RULE = 'color must be "1" to "6" or #RRGGBB'
XY_RULE = '{} must be a whole number from -1,000,000 to 1,000,000'
SIZE_RULE = '{} must be a whole number from 16 to 8,192'
TYPE_RULE = 'type must be a string of 1 to 32 characters'
TEXT_RULE = 'text must be a string of 20,000 characters or less'
SUBPATH_RULE = 'subpath must start with "#" and have 1 to 300 more characters'
VERSION_RULE = 'horsemen must be an object with a whole-number version of 1 or more'
DEEP = 'file is nested deeper than 32 levels'

Result = namedtuple('Result', 'errors doc text canonical read_only')


def problem(code, message):
    return {'code': code, 'message': message}


def rev(data):
    """The first eight characters of the content hash. Tools use it to see a change."""
    return hashlib.sha256(data).hexdigest()[:8]


# ---------------------------------------------------------------- read

def _parse_int(text):
    # Python refuses very long integers; JavaScript reads them as Infinity. Both then fail the number rule.
    return int(text) if len(text) <= 300 else float(text)


def _no_constant(name):
    raise ValueError(name)  # NaN and Infinity are not JSON.


def load(data):
    """(document, None), or (None, message) for bytes that are not a canvas file."""
    if len(data) > MAX_BYTES:
        return None, 'file is larger than 512 KiB'
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError:
        return None, 'file is not valid UTF-8'
    if text.startswith('﻿'):
        text = text[1:]
    try:
        doc = json.loads(text, parse_int=_parse_int, parse_constant=_no_constant)
    except RecursionError:
        return None, DEEP
    except ValueError:
        return None, 'file has Git conflict markers' if _CONFLICT.search(text) else 'file is not valid JSON'
    deep = number = unicode_error = False
    stack = [(doc, 1)]
    while stack:
        value, depth = stack.pop()
        if isinstance(value, (dict, list)):
            if depth > MAX_DEPTH:
                deep = True
                break
            if isinstance(value, dict):
                unicode_error = unicode_error or any(_SURROGATE.search(key) for key in value)
                stack.extend((item, depth + 1) for item in value.values())
            else:
                stack.extend((item, depth + 1) for item in value)
        elif isinstance(value, str):
            unicode_error = unicode_error or bool(_SURROGATE.search(value))
        elif isinstance(value, float):
            number = number or value != value or value in (float('inf'), float('-inf'))
    if deep:
        return None, DEEP
    if number:
        return None, 'file has a number that is too large'
    if unicode_error:
        return None, 'file has text that is not valid Unicode'
    if not isinstance(doc, dict):
        return None, 'file must be a JSON object'
    return doc, None


def _whole(value, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    if isinstance(value, float) and not value.is_integer():
        return False
    return low <= value <= high


def _text(value, limit):
    return isinstance(value, str) and len(value) <= limit


def path_ok(value):
    return (isinstance(value, str) and 1 <= len(value) <= 1024 and not value.startswith('/') and '\\' not in value
            and not _CONTROL.search(value) and not any(part in ('.', '..') for part in value.split('/')))


def url_ok(value):
    if not isinstance(value, str) or len(value) > 2048 or _CONTROL.search(value) or _URL_SPACE.search(value):
        return False
    return any(value.startswith(scheme) and len(value) > len(scheme) for scheme in ('http://', 'https://'))


def subpath_ok(value):
    return isinstance(value, str) and value.startswith('#') and 1 <= len(value) - 1 <= 300 and not _CONTROL.search(value)


def _id_ok(value):
    return isinstance(value, str) and ID.fullmatch(value) is not None


def node_errors(node, position):
    """Rule messages for one node, in the fixed order."""
    if not isinstance(node, dict):
        return [f'node at position {position}: must be an object']
    name = f"node {node['id']}" if _id_ok(node.get('id')) else f'node at position {position}'
    found = []
    if not _id_ok(node.get('id')):
        found.append(ID_RULE)
    kind = node.get('type')
    typed = isinstance(kind, str) and 1 <= len(kind) <= 32
    if not typed:
        found.append(TYPE_RULE)
    found += [XY_RULE.format(key) for key in ('x', 'y') if not _whole(node.get(key), -1000000, 1000000)]
    found += [SIZE_RULE.format(key) for key in ('width', 'height') if not _whole(node.get(key), 16, 8192)]
    if 'color' in node and not (isinstance(node['color'], str) and COLOR.fullmatch(node['color'])):
        found.append(COLOR_RULE)
    if typed and kind == 'text':
        if not _text(node.get('text'), MAX_TEXT):
            found.append(TEXT_RULE)
    elif typed and kind == 'file':
        if not path_ok(node.get('file')):
            found.append(PATH_RULE.format('file'))
        if 'subpath' in node and not subpath_ok(node['subpath']):
            found.append(SUBPATH_RULE)
        if 'alt' in node and not _text(node['alt'], 500):
            found.append('alt must be a string of 500 characters or less')
    elif typed and kind == 'link':
        if not url_ok(node.get('url')):
            found.append(URL_RULE)
        if 'title' in node and not _text(node['title'], 200):
            found.append('title must be a string of 200 characters or less')
    elif typed and kind == 'group':
        if 'label' in node and not _text(node['label'], 200):
            found.append('label must be a string of 200 characters or less')
        if 'background' in node and not path_ok(node['background']):
            found.append(PATH_RULE.format('background'))
        if 'backgroundStyle' in node and node['backgroundStyle'] not in STYLES:
            found.append('backgroundStyle must be "cover", "ratio", or "repeat"')
    return [f'{name}: {rule}' for rule in found]


def edge_errors(edge, position):
    """Rule messages for one edge, in the fixed order."""
    if not isinstance(edge, dict):
        return [f'edge at position {position}: must be an object']
    name = f"edge {edge['id']}" if _id_ok(edge.get('id')) else f'edge at position {position}'
    found = []
    if not _id_ok(edge.get('id')):
        found.append(ID_RULE)
    found += [f'{key} must be an id' for key in ('fromNode', 'toNode') if not _id_ok(edge.get(key))]
    found += [f'{key} must be "top", "right", "bottom", or "left"' for key in ('fromSide', 'toSide') if key in edge and edge[key] not in SIDES]
    found += [f'{key} must be "none" or "arrow"' for key in ('fromEnd', 'toEnd') if key in edge and edge[key] not in ENDS]
    if 'color' in edge and not (isinstance(edge['color'], str) and COLOR.fullmatch(edge['color'])):
        found.append(COLOR_RULE)
    if 'label' in edge and not _text(edge['label'], 200):
        found.append('label must be a string of 200 characters or less')
    return [f'{name}: {rule}' for rule in found]


def dangling_edges(doc):
    """Messages for edge ends that are valid ids but name no node."""
    nodes = {node['id'] for node in doc.get('nodes', []) if isinstance(node, dict) and _id_ok(node.get('id'))}
    found = []
    for position, edge in enumerate(doc.get('edges', []), 1):
        if not isinstance(edge, dict):
            continue
        name = f"edge {edge['id']}" if _id_ok(edge.get('id')) else f'edge at position {position}'
        for key in ('fromNode', 'toNode'):
            if _id_ok(edge.get(key)) and edge[key] not in nodes:
                found.append(f'{name}: {key} {edge[key]} is not a node')
    return found


def format_errors(doc):
    """The `canvas-invalid` messages of a parsed file: shape, limits, each element, and repeated ids."""
    found = []
    version = doc.get('horsemen', {'version': 1})
    if not isinstance(version, dict) or not _whole(version.get('version'), 1, float('inf')):
        return [VERSION_RULE]
    for key in ('nodes', 'edges'):
        if not isinstance(doc.get(key, []), list):
            found.append(f'{key} must be a list')
    if found:
        return found
    nodes, edges = doc.get('nodes', []), doc.get('edges', [])
    if len(nodes) > MAX_NODES:
        found.append('more than 500 nodes')
    if len(edges) > MAX_EDGES:
        found.append('more than 1,000 edges')
    if found:
        return found
    for position, node in enumerate(nodes, 1):
        found += node_errors(node, position)
    for position, edge in enumerate(edges, 1):
        found += edge_errors(edge, position)
    seen, repeated = set(), []
    for item in nodes + edges:
        if isinstance(item, dict) and _id_ok(item.get('id')):
            if item['id'] in seen and item['id'] not in repeated:
                repeated.append(item['id'])
            seen.add(item['id'])
    return found + [f'duplicate id {item}' for item in repeated]


def extension(path):
    """The lower-case extension of the file name, with its dot, or ''."""
    name = path.rsplit('/', 1)[-1]
    dot = name.rfind('.')
    return name[dot:].lower() if dot > 0 else ''


def media_matches(kind, head):
    """True when the first bytes of a file fit its media extension."""
    if kind == 'PNG':
        return head.startswith(b'\x89PNG\r\n\x1a\n')
    if kind == 'JPEG':
        return head.startswith(b'\xff\xd8\xff')
    if kind == 'GIF':
        return head[:6] in (b'GIF87a', b'GIF89a')
    if kind == 'WebP':
        return head[:4] == b'RIFF' and head[8:12] == b'WEBP'
    if kind == 'SVG':
        return b'<svg' in head.lower()
    if kind == 'XLSX':
        return head.startswith(b'PK\x03\x04')
    if b'\x00' in head:  # CSV and TSV are text.
        return False
    try:
        head.decode('utf-8')
    except UnicodeDecodeError as error:
        return error.start >= len(head) - 3  # A character cut at the end of the sample is not an error.
    return True


def node_references(node, lookup):
    """Problems with the files that one valid node names. `lookup` maps a project path to a file or None."""
    found = []
    if not isinstance(node, dict) or not _id_ok(node.get('id')):
        return found
    keys = {'file': ('file',), 'group': ('background',)}.get(node.get('type'), ())
    for key in keys:
        path = node.get(key)
        if not path_ok(path):
            continue
        name = f"node {node['id']}"
        target = lookup(path)
        kind = MEDIA.get(extension(path))
        if target is None:
            found.append(problem(DANGLING, f'{name}: {key} {path} does not exist'))
        elif path.startswith(MEDIA_FOLDER + '/') and not kind:
            found.append(problem(INVALID, f'{name}: {key} {path} is not a supported media type'))
        elif key == 'file' and extension(path) == '.md' and subpath_ok(node.get('subpath')) \
                and not has_heading(target.get('text') or '', node['subpath']):
            found.append(problem(DANGLING, f"{name}: heading {node['subpath']} is not in {path}"))
        elif kind and target['size'] > MAX_MEDIA:
            found.append(problem(MEDIA_TOO_LARGE, f'{name}: {key} {path} is larger than 1 MiB'))
        elif kind and target.get('head') is not None and not media_matches(kind, target['head']):
            found.append(problem(INVALID, f'{name}: {key} {path} is not a {kind} file'))
    return found


def reference_errors(doc, lookup):
    found = []
    for node in doc.get('nodes', []):
        found += node_references(node, lookup)
    return found


def check_bytes(data, lookup=None):
    """Read and check one canvas file. `text` is the canonical text when the format rules pass."""
    doc, message = load(data)
    if message:
        return Result([problem(INVALID, message)], None, None, False, False)
    errors = [problem(INVALID, message) for message in format_errors(doc)]
    if errors:
        return Result(errors[:MAX_ERRORS], doc, None, False, False)
    errors = [problem(DANGLING, message) for message in dangling_edges(doc)]
    if lookup is not None:
        errors += reference_errors(doc, lookup)
    text = canonical(doc)
    version = doc.get('horsemen', {}).get('version', 1)
    return Result(errors[:MAX_ERRORS], doc, text, text.encode('utf-8') == data, version > 1)


# ---------------------------------------------------------------- write

def number_text(value):
    """The text that JavaScript gives for a number, so both readers write the same file."""
    if isinstance(value, int) and abs(value) <= 2 ** 53:
        return str(value)
    value = float(value)
    if value == 0:
        return '0'
    if value.is_integer() and abs(value) < 2 ** 53:
        return str(int(value))
    sign, digits, exponent = Decimal(repr(abs(value))).normalize().as_tuple()
    digits = ''.join(map(str, digits))
    point = len(digits) + exponent  # The value is 0.DIGITS times 10 to the power `point`.
    if len(digits) <= point <= 21:
        text = digits + '0' * (point - len(digits))
    elif 0 < point <= 21:
        text = digits[:point] + '.' + digits[point:]
    elif -6 < point <= 0:
        text = '0.' + '0' * -point + digits
    else:
        power = point - 1
        text = digits[0] + ('.' + digits[1:] if len(digits) > 1 else '') + 'e' + ('+' if power > 0 else '-') + str(abs(power))
    return ('-' if value < 0 else '') + text


def _utf16(key):
    return key.encode('utf-16-be', 'surrogatepass')


def dumps(value):
    """Compact JSON with sorted keys, as `JSON.stringify` writes it."""
    if value is None:
        return 'null'
    if value is True:
        return 'true'
    if value is False:
        return 'false'
    if isinstance(value, (int, float)):
        return number_text(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return '[' + ','.join(dumps(item) for item in value) + ']'
    return '{' + ','.join(dumps(key) + ':' + dumps(value[key]) for key in sorted(value, key=_utf16)) + '}'


def element_line(item, first):
    keys = [key for key in first if key in item] + sorted((key for key in item if key not in first), key=_utf16)
    return '{' + ','.join(dumps(key) + ':' + dumps(item[key]) for key in keys) + '}'


def _block(name, items, first):
    if not items:
        return dumps(name) + ':[]'
    return dumps(name) + ':[\n' + ',\n'.join(element_line(item, first) for item in items) + '\n]'


def canonical(doc):
    """One element on each line. Groups first, then nodes by id; then edges by id."""
    nodes = sorted(doc.get('nodes', []), key=lambda node: (node.get('type') != 'group', node['id']))
    edges = sorted(doc.get('edges', []), key=lambda edge: edge['id'])
    parts = ['"horsemen":' + dumps(doc.get('horsemen', {'version': 1})), _block('nodes', nodes, NODE_FIRST), _block('edges', edges, EDGE_FIRST)]
    parts += [dumps(key) + ':' + dumps(doc[key]) for key in sorted(doc, key=_utf16) if key not in ('horsemen', 'nodes', 'edges')]
    return '{\n' + ',\n'.join(parts) + '\n}\n'


# ---------------------------------------------------------------- Markdown headings

def headings(markdown):
    """(level, title, line index) for each heading outside fenced code."""
    found, fenced = [], False
    for index, row in enumerate(markdown.split('\n')):
        if row.endswith('\r'):
            row = row[:-1]
        if _FENCE.match(row):
            fenced = not fenced
            continue
        match = None if fenced else _HEADING.fullmatch(row)
        if match:
            title = re.sub(r'(?:^|[ \t])#+$', '', match.group(2).strip(' \t')).strip(' \t')
            if title:
                found.append((len(match.group(1)), title, index))
    return found


def find_heading(found, subpath):
    """The index in `found` of the heading that `#A#B` names, or None."""
    want = [part.strip(' \t').lower() for part in subpath.split('#')[1:]]
    at, level, hit = 0, 0, None
    for name in want:
        for index in range(at, len(found)):
            if level and found[index][0] <= level:
                return None
            if found[index][1].lower() == name:
                at, level, hit = index + 1, found[index][0], index
                break
        else:
            return None
    return hit


def has_heading(markdown, subpath):
    return find_heading(headings(markdown), subpath) is not None


def section_text(markdown, subpath):
    """(title, text) of the section that a subpath names: the lines below its heading, up to the next
    heading of the same or a higher level. None when the heading does not exist."""
    found = headings(markdown)
    hit = find_heading(found, subpath)
    if hit is None:
        return None
    rows = [row[:-1] if row.endswith('\r') else row for row in markdown.split('\n')]
    level, title, start = found[hit]
    end = next((line for other, _, line in found[hit + 1:] if other <= level), len(rows))
    return title, '\n'.join(rows[start + 1:end]).strip('\n')


def slug(title):
    return re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')[:58].rstrip('-')


def free_id(base, used):
    """`base`, or `base-2`, `base-3`, ... : the first id that is not in `used`."""
    candidate, count = base, 1
    while candidate in used:
        count += 1
        tail = f'-{count}'
        candidate = base[:64 - len(tail)] + tail
    return candidate


def section_cards(markdown):
    """(title, card id) for each second-level heading: the generated section cards of a record."""
    cards, used = [], set()
    for level, title, _ in headings(markdown):
        if level == 2:
            card = free_id('s-' + (slug(title) or 'section'), used)
            used.add(card)
            cards.append((title, card))
    return cards


# ---------------------------------------------------------------- element kinds

def provider(url):
    """(kind, name) of a link: a video or embed provider, or ('link', host)."""
    try:
        parts = urlsplit(url if isinstance(url, str) else '')
        host = (parts.hostname or '').lower()
    except ValueError:
        return 'link', ''
    host = host[4:] if host.startswith('www.') else host
    if host in ('youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com'):
        return 'video', 'youtube'
    if host == 'loom.com':
        return 'video', 'loom'
    if host in ('vimeo.com', 'player.vimeo.com'):
        return 'video', 'vimeo'
    if host == 'figma.com':
        return 'embed', 'figma'
    if host == 'docs.google.com':
        for prefix, name in (('/spreadsheets/', 'google-sheets'), ('/document/', 'google-docs'), ('/presentation/', 'google-slides')):
            if parts.path.startswith(prefix):
                return 'embed', name
    return 'link', host


def kind(node):
    """What the app shows for a node: note, group, section, record, canvas, image, sheet, video, embed, link, file, or unsupported."""
    kinds = {'text': 'note', 'group': 'group'}
    if node.get('type') in kinds:
        return kinds[node['type']]
    if node.get('type') == 'link':
        return provider(node.get('url'))[0]
    if node.get('type') == 'file':
        ending = extension(node['file']) if isinstance(node.get('file'), str) else ''
        if ending == '.md':
            return 'section' if node.get('subpath') else 'record'
        return 'canvas' if ending == SUFFIX else 'image' if ending in IMAGES else 'sheet' if ending in SHEETS else 'file'
    return 'unsupported'


# ---------------------------------------------------------------- placement

def _rect(node):
    return int(node['x']), int(node['y']), int(node['width']), int(node['height'])


def _blocked(x, y, width, height, rects, margin):
    for bx, by, bw, bh in rects:
        if x < bx + bw + margin and bx < x + width + margin and y < by + bh + margin and by < y + height + margin:
            return bx, by, bw, bh
    return None


def _slide(x, y, width, height, rects, down, forward=True):
    """Move a taken place along one axis until it is free. Each element can block one time only."""
    for _ in range(len(rects) + 1):
        hit = _blocked(x, y, width, height, rects, GAP // 2)
        if hit is None:
            break
        if down:
            y = hit[1] + hit[3] + GAP if forward else hit[1] - GAP - height
        else:
            x = hit[0] + hit[2] + GAP if forward else hit[0] - GAP - width
    return x, y


def place(nodes, anchor, side, width, height, skip=None):
    """A free position beside `anchor`. A place that is taken moves along the side of the anchor, down or
    up (right, left) or to the right or left (below, above), to the free place that is nearer."""
    ax, ay, aw, ah = _rect(anchor)
    x, y = {'right': (ax + aw + GAP, ay), 'left': (ax - GAP - width, ay),
            'below': (ax, ay + ah + GAP), 'above': (ax, ay - GAP - height)}[side]
    rects = [_rect(node) for node in nodes if node.get('type') != 'group' and node.get('id') != skip]
    down = side in ('right', 'left')
    first = _slide(x, y, width, height, rects, down)
    second = _slide(x, y, width, height, rects, down, forward=False)
    moved = (lambda place: abs(place[1] - y)) if down else (lambda place: abs(place[0] - x))
    return second if moved(second) < moved(first) else first


def place_free(nodes, width, height):
    """A position to the right of all elements, level with the highest one."""
    if not nodes:
        return 0, 0
    rects = [_rect(node) for node in nodes]
    return max(x + w for x, _, w, _ in rects) + GAP, min(y for _, y, _, _ in rects)


# ---------------------------------------------------------------- edit ops

class EditError(Exception):
    """An op that breaks a rule. `op` is the position of the op, from 1."""
    def __init__(self, message, op=None, verb=None):
        super().__init__(message)
        self.message, self.op, self.verb = message, op, verb


def _used(doc):
    return {item.get('id') for item in doc['nodes'] + doc['edges']}


def _numbered(prefix, used):
    count = 1
    while f'{prefix}-{count}' in used:
        count += 1
    return f'{prefix}-{count}'


def _section_card(doc, ref, record, added):
    """The id of the section card for `#Heading`. The card is saved first when the canvas has none."""
    if record is None:
        raise EditError(f'{ref} needs the canvas of a record (for example progress); name an element id on this canvas')
    filename, markdown = record
    found = headings(markdown)
    hit = find_heading(found, ref) if subpath_ok(ref) else None
    if hit is None:
        raise EditError(f'heading {ref} is not in {filename}')
    for node in doc['nodes']:
        if node.get('type') == 'file' and node.get('file') == filename and subpath_ok(node.get('subpath')) \
                and find_heading(found, node['subpath']) == hit:
            return node['id']
    level, title, line = found[hit]
    sections = [(other_title, other_line) for other_level, other_title, other_line in found if other_level == 2]
    generated = dict(zip((other_line for _, other_line in sections), (card for _, card in section_cards(markdown))))
    parts = [part.strip(' \t') for part in ref.split('#')[1:]]
    subpath = '#' + title if len(parts) == 1 else '#' + '#'.join(parts)
    card_id = free_id(generated.get(line) or 's-' + (slug(' '.join(parts)) or 'section'), _used(doc))
    width, height = SIZES['section']
    shown = {find_heading(found, node['subpath']) for node in doc['nodes']
             if node.get('type') == 'file' and node.get('file') == filename and subpath_ok(node.get('subpath'))}
    missing = [other_line for other_title, other_line in sections if find_heading(found, '#' + other_title) not in shown]
    if line in missing and doc['nodes']:
        # Where the app draws a section that has no saved card: a column to the left of the saved elements.
        x = min(_rect(node)[0] for node in doc['nodes']) - 380
        y = min(_rect(node)[1] for node in doc['nodes']) + missing.index(line) * 230
    elif line in missing:
        x, y = (missing.index(line) % 3) * 360, (missing.index(line) // 3) * 240
    else:
        x, y = place_free(doc['nodes'], width, height)
    x, y = _slide(x, y, width, height, [_rect(node) for node in doc['nodes'] if node.get('type') != 'group'], True)
    doc['nodes'].append({'id': card_id, 'type': 'file', 'x': x, 'y': y, 'width': width, 'height': height, 'file': filename, 'subpath': subpath})
    added.append(card_id)
    return card_id


def _anchor(doc, near, record, added):
    if not isinstance(near, str) or not near:
        raise EditError('near must be an element id or #Heading')
    if near.startswith('#'):
        near = _section_card(doc, near, record, added)
    node = next((item for item in doc['nodes'] if item.get('id') == near), None)
    if node is None:
        raise EditError(f'near {_short(near)} is not a node on this canvas')
    return node


def _short(value, limit=80):
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return text if len(text) <= limit else text[:limit - 1] + '…'


def _first(messages):
    if messages:
        raise EditError(_short(messages[0], 300))


def _check_node(doc, node, lookup):
    _first(node_errors(node, len(doc['nodes'])))
    if lookup is not None:
        _first([item['message'] for item in node_references(node, lookup)])


def _check_edge(doc, edge):
    _first(edge_errors(edge, len(doc['edges'])))
    nodes = {node.get('id') for node in doc['nodes']}
    _first([f"edge {edge['id']}: {key} {edge[key]} is not a node" for key in ('fromNode', 'toNode') if edge[key] not in nodes])


def _check_type(value):
    """An op can make only the four JSON Canvas types. A node of another tool keeps its own type."""
    if isinstance(value, str) and value not in TYPES:
        hint = f'; a {value} is type {KIND_TYPES[value]}' if value in KIND_TYPES else ''
        raise EditError(f'type must be text, file, link, or group, not {_short(value, 32)}{hint}')


def _resolve_ends(doc, edge, record, added):
    for key in ('fromNode', 'toNode'):
        if isinstance(edge.get(key), str) and edge[key].startswith('#'):
            edge[key] = _section_card(doc, edge[key], record, added)


def _add(doc, op, record, lookup, summary):
    node, edge = op.get('node'), op.get('edge')
    if (node is None) == (edge is None) or not isinstance(node if edge is None else edge, dict):
        raise EditError('add needs one of node or edge, as an object')
    item = copy.deepcopy(node if edge is None else edge)
    if isinstance(item.get('id'), str) and item['id'] in _used(doc):
        raise EditError(f"id {_short(item['id'])} is in use on this canvas")
    if edge is not None:
        if 'near' in op or 'side' in op:
            raise EditError('near and side are for nodes')
        _resolve_ends(doc, item, record, summary['added'])
        item.setdefault('id', _numbered('e', _used(doc)))
        _check_edge(doc, item)
        doc['edges'].append(item)
        if len(doc['edges']) > MAX_EDGES:
            raise EditError('more than 1,000 edges')
    else:
        if 'type' not in item:
            guess = [name for key, name in (('text', 'text'), ('url', 'link'), ('file', 'file')) if key in item]
            if len(guess) != 1:
                raise EditError('node needs a type, or one of text, url, or file')
            item['type'] = guess[0]
        _check_type(item['type'])
        what = kind(item) if isinstance(item.get('type'), str) else 'unsupported'
        size = SIZES.get(what, SIZES['file'])
        item.setdefault('width', size[0])
        item.setdefault('height', size[1])
        anchor = _anchor(doc, op['near'], record, summary['added']) if 'near' in op else None
        if 'id' not in item:
            if what == 'section' and subpath_ok(item.get('subpath')):
                item['id'] = free_id('s-' + (slug(item['subpath'][1:].replace('#', ' ')) or 'section'), _used(doc))
            else:
                item['id'] = _numbered(PREFIXES.get(what, 'el'), _used(doc))
        sized = all(_whole(item.get(key), 16, 8192) for key in ('width', 'height'))
        if anchor is not None and sized:
            item['x'], item['y'] = place(doc['nodes'], anchor, op.get('side', 'right'), int(item['width']), int(item['height']))
        elif 'x' not in item and 'y' not in item and sized:
            item['x'], item['y'] = place_free(doc['nodes'], int(item['width']), int(item['height']))
        doc['nodes'].append(item)
        _check_node(doc, item, lookup)
        if len(doc['nodes']) > MAX_NODES:
            raise EditError('more than 500 nodes')
    summary['added'].append(item['id'])


def _update(doc, op, record, lookup, summary):
    target = op.get('id')
    if not isinstance(target, str):
        raise EditError('update needs the id of an element')
    node = next((item for item in doc['nodes'] if item.get('id') == target), None)
    edge = next((item for item in doc['edges'] if item.get('id') == target), None)
    if node is None and edge is None:
        raise EditError(f'id {_short(target)} is not on this canvas')
    if node is not None and 'edge' in op:
        raise EditError(f'{target} is a node; give the keys to change in node')
    if edge is not None and ('node' in op or 'near' in op):
        raise EditError(f'{target} is an edge; give the keys to change in edge')
    patch = op.get('node' if node is not None else 'edge')
    if patch is None and 'near' not in op:
        raise EditError('update needs the keys to change in node or edge, or near')
    if patch is not None and not isinstance(patch, dict):
        raise EditError('the keys to change must be an object')
    item = node if node is not None else edge
    if patch and 'id' in patch and patch['id'] != target:
        raise EditError('an id does not change after it is made')
    if node is not None and patch and patch.get('type') != node.get('type'):
        _check_type(patch.get('type'))
    for key, value in copy.deepcopy(patch or {}).items():
        if value is None:
            item.pop(key, None)
        else:
            item[key] = value
    if edge is not None:
        _resolve_ends(doc, item, record, summary['added'])
        _first(edge_errors(item, 0))
        _check_edge(doc, item)
    else:
        _first(node_errors(item, 0))
        if 'near' in op:
            anchor = _anchor(doc, op['near'], record, summary['added'])
            if anchor is item:
                raise EditError('near names the element itself')
            item['x'], item['y'] = place(doc['nodes'], anchor, op.get('side', 'right'), int(item['width']), int(item['height']), skip=target)
        _check_node(doc, item, lookup)
    summary['updated'] += 1


def _remove(doc, op, summary):
    target = op.get('id')
    if not isinstance(target, str):
        raise EditError('remove needs the id of an element')
    if any(node.get('id') == target for node in doc['nodes']):
        kept = [edge for edge in doc['edges'] if target not in (edge.get('fromNode'), edge.get('toNode'))]
        summary['removed'] += 1 + len(doc['edges']) - len(kept)
        doc['nodes'] = [node for node in doc['nodes'] if node.get('id') != target]
        doc['edges'] = kept
    elif any(edge.get('id') == target for edge in doc['edges']):
        doc['edges'] = [edge for edge in doc['edges'] if edge.get('id') != target]
        summary['removed'] += 1
    else:
        raise EditError(f'id {_short(target)} is not on this canvas')


def apply_ops(doc, ops, record=None, lookup=None):
    """Apply edit ops to a copy of a valid document. Returns (document, summary); raises EditError and changes nothing.

    `record` is (file name, Markdown) when the canvas belongs to a record, so an op can name `#Heading`.
    """
    if not isinstance(ops, list):
        raise EditError('ops must be a list')
    if len(ops) > MAX_OPS:
        raise EditError('at most 50 ops in one call')
    doc = copy.deepcopy(doc)
    doc.setdefault('nodes', [])
    doc.setdefault('edges', [])
    summary = {'added': [], 'updated': 0, 'removed': 0}
    for position, op in enumerate(ops, 1):
        verb = op.get('op') if isinstance(op, dict) else None
        verb = verb if verb in ('add', 'update', 'remove') else None
        try:
            if verb is None:
                raise EditError('op must be add, update, or remove')
            unknown = sorted(set(op) - {'op', 'id', 'node', 'edge', 'near', 'side'})
            if unknown:
                raise EditError(f'unknown key {_short(unknown[0])}')
            if 'side' in op and op['side'] not in NEAR_SIDES:
                raise EditError('side must be right, left, below, or above')
            if verb == 'add':
                _add(doc, op, record, lookup, summary)
            elif verb == 'update':
                _update(doc, op, record, lookup, summary)
            else:
                _remove(doc, op, summary)
        except EditError as error:
            raise EditError(error.message, position, verb) from None
    _first(format_errors(doc) + dangling_edges(doc))
    return doc, summary


# ---------------------------------------------------------------- project files

def inside(root, path):
    """The resolved path when it is inside the resolved root, or None."""
    try:
        real = Path(path).resolve()
    except (OSError, RuntimeError):
        return None
    return real if real == root or root in real.parents else None


def read_inside(root, relative, limit):
    """Up to `limit` + 1 bytes of a regular file inside the project, or None. A link out of the project is not read."""
    real = inside(root, root / relative)
    try:
        if real is None or not real.is_file():
            return None
        with open(real, 'rb') as handle:
            return handle.read(limit + 1)
    except OSError:
        return None


def disk_lookup(root):
    """A lookup for the reference rules: project path to {'size', 'text', 'head'}, or None when it names no file."""
    root = Path(root).resolve()
    seen = {}

    def lookup(path):
        if path in seen:
            return seen[path]
        found = None
        if path_ok(path) and '' not in path.split('/'):
            real = inside(root, root / path)
            try:
                if real is not None and real.is_file():
                    ending = extension(path)
                    found = {'size': real.stat().st_size, 'text': None, 'head': None}
                    if ending == '.md' or ending in MEDIA:
                        with open(real, 'rb') as handle:
                            data = handle.read(2 * 1024 * 1024 if ending == '.md' else 4096)
                        if ending == '.md':
                            found['text'] = data.decode('utf-8', 'replace')
                        else:
                            found['head'] = data
            except OSError:
                found = None
        seen[path] = found
        return found
    return lookup


def canvas_names(root):
    """(names of canvas files, state). State is None, 'missing', or 'outside' for a folder that leaves the project."""
    root = Path(root).resolve()
    folder = root / FOLDER
    if not os.path.lexists(folder):
        return [], 'missing'
    real = inside(root, folder)
    if real is None or not real.is_dir():
        return [], 'outside'
    try:
        return sorted(name for name in os.listdir(real) if name.endswith(SUFFIX)), None
    except OSError:
        return [], 'missing'


def check_project(root):
    """Findings for `check`: (level, code, file, message) for each canvas file of a project."""
    root = Path(root).resolve()
    names, state = canvas_names(root)
    found = []
    if state == 'outside':
        return [('error', INVALID, FOLDER, 'The canvas folder is not a folder inside the project. It was not read.')]
    if len(names) > MAX_FILES:
        found.append(('error', INVALID, FOLDER, f'{len(names)} canvas files. A workspace holds at most {MAX_FILES}.'))
    lookup = disk_lookup(root)
    for name in names[:MAX_FILES * 2]:
        relative = f'{FOLDER}/{name}'
        if not NAME.fullmatch(name[:-len(SUFFIX)]):
            found.append(('error', INVALID, relative, 'The file name must be 1 to 64 lower-case letters, digits, or "-", then `.canvas`.'))
            continue
        data = read_inside(root, relative, MAX_BYTES)
        if data is None:
            found.append(('error', INVALID, relative, 'Not a regular file inside the project. It was not read.'))
            continue
        result = check_bytes(data, lookup)
        found += [('error', item['code'], relative, item['message'][:1].upper() + item['message'][1:] + '.') for item in result.errors]
        if result.text is not None and not result.canonical and not result.read_only:
            found.append(('warning', NOT_CANONICAL, relative, 'Valid, but not in canonical form. '
                          f'Run `horsemen canvas apply {name[:-len(SUFFIX)]}` with no ops to rewrite it.'))
    media = inside(root, root / MEDIA_FOLDER)
    if media is not None and media.is_dir():
        try:
            total = sum(entry.stat().st_size for entry in os.scandir(media) if entry.is_file(follow_symlinks=False))
        except OSError:
            total = 0
        if total > MAX_MEDIA_FOLDER:
            found.append(('warning', MEDIA_TOO_LARGE, MEDIA_FOLDER, f'The media folder holds {total // (1024 * 1024)} MiB. Keep it under 20 MiB; use links for large files.'))
    return found
