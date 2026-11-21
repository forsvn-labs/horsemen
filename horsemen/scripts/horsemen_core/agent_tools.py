"""The two agent tools, `read` and `canvas_edit`, as plain functions.

The CLI (`horsemen show`, `horsemen canvas apply`) and the MCP server call these
functions, so each interface gives the same text. Each reply is plain text with a
character budget (docs/product/canvas-workspace.md in the source repository).
"""
import hashlib
import json
import os
import re
import secrets
from collections import namedtuple
from pathlib import Path
from urllib.parse import urlencode

from . import canvas, legacy

INDEX_LIMIT = 800
HEADINGS_LIMIT = 1200
DEFAULT_LIMIT = 2000
MIN_LIMIT, MAX_LIMIT = 200, 8000
EDIT_LIMIT = 400
LINE = 100
RECORD_LIMIT = 2 * 1024 * 1024
NOT_WRITTEN = '; nothing written'
TARGETS = 'use "" (index), a record (progress), a section (progress#Shipped), a canvas (progress.canvas), or an element (progress.canvas#id)'
NO_RECORDS = 'no Horsemen records (VISION, BRAIN, PROGRESS, STRUCTURE) in {}. Ask the user before you set them up.'

Reply = namedtuple('Reply', 'ok text code')  # code: 0 done, 1 refused, 2 input that cannot be used

_RECORD = re.compile(r'([A-Za-z]+)(?:\.md)?(#.+)?', re.S)
_CANVAS = re.compile(r'([a-z0-9][a-z0-9-]{0,63})\.canvas(?:#(.+))?', re.S)
_BREAKS = re.compile('[\\s\x00-\x1f\x7f-\x9f  ]+')
_cache = {}


def clip(text, limit):
    return text if len(text) <= limit else text[:max(limit - 1, 0)] + '…'


def flat(text):
    """One line of plain text for an outline: no line ends, no Markdown marks, no double quotes."""
    return _BREAKS.sub(' ', re.sub(r'\*\*|__|`', '', text)).replace('"', "'").strip()


def _fail(text, code=2, limit=EDIT_LIMIT):
    return Reply(False, clip(text, limit), code)


def _refuse(message, code=1):
    return Reply(False, clip(message, EDIT_LIMIT - len(NOT_WRITTEN)) + NOT_WRITTEN, code)


def is_workspace(root):
    return any((Path(root) / name).is_file() for name in legacy.MARKERS)


def _file_bytes(root, relative, limit):
    """Bytes of a regular file inside the project, or None. Kept in memory by path, size, and change time."""
    real = canvas.inside(root, root / relative)
    try:
        if real is None or not real.is_file():
            return None
        stat = real.stat()
        key = (stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_ino)
        hit = _cache.get(str(real))
        if hit and hit[0] == key:
            return hit[1]
        with open(real, 'rb') as handle:
            data = handle.read(limit + 1)
        if len(_cache) > 64:
            _cache.clear()
        _cache[str(real)] = (key, data)
        return data
    except OSError:
        return None


def record_file(root, name):
    """(file name, bytes) of a record, or (file name, None). Legacy STATUS.md stands in for a missing PROGRESS.md."""
    filename = canvas.RECORDS[name]
    data = _file_bytes(root, filename, RECORD_LIMIT)
    if data is None and name == 'progress':
        legacy_data = _file_bytes(root, legacy.LEGACY_PROGRESS, RECORD_LIMIT)
        if legacy_data is not None:
            return legacy.LEGACY_PROGRESS, legacy_data
    return filename, data


def _markdown(data):
    return data.decode('utf-8', 'replace')


def _page(head, body, offset, limit):
    """`head`, then the part of `body` from `offset` that fits in `limit` characters. A page ends at a line end."""
    head = clip(head, 160)
    room = limit - len(head) - 1
    rest = body[offset:]
    if not rest:
        return head
    if len(rest) <= room:
        return head + '\n' + rest
    room -= len('\nmore: offset=') + len(str(len(body)))
    chunk = rest[:max(room, 1)]
    cut = chunk.rfind('\n')
    if cut > 0:
        chunk = chunk[:cut + 1]
    shown = chunk[:-1] if chunk.endswith('\n') else chunk
    return f'{head}\n{shown}\nmore: offset={offset + len(chunk)}'


def _wrap(prefix, items, separator):
    """Lines of at most LINE characters: `prefix` and the items, then continuation lines that start with two spaces."""
    lines, current = [], prefix
    for item in items:
        piece = item if current in (prefix, '  ') else separator + item
        if len(current) + len(piece) > LINE and current not in (prefix, '  '):
            lines.append(current + separator.rstrip())
            current, piece = '  ', item
        current += clip(piece, LINE - len(current) - len(separator.rstrip()))
    return lines + [current]


# ---------------------------------------------------------------- read

def _git_state(root):
    top = legacy.git_top(root)
    if not top:
        return ''
    branch = (legacy.git(root, 'rev-parse', '--abbrev-ref', 'HEAD') or '').strip()
    head = (legacy.git(root, 'rev-parse', '--short=7', 'HEAD') or '').strip()
    if not head:
        return ' @ ' + clip(branch or 'no commits', 40) if branch else ''
    text = f' @ {clip(branch, 40)} {head}'
    ahead = (legacy.git(root, 'rev-list', '--count', '@{upstream}..HEAD') or '').strip()
    if ahead.isdigit() and int(ahead):
        text += f", {legacy.plural(int(ahead), 'commit')} not pushed"
    names = [name for name in sorted(legacy.RECORD_FILES) if (root / name).exists()] + ['.horsemen']
    if (legacy.git(root, 'status', '--porcelain', '--', *names) or '').strip():
        text += ', uncommitted changes'
    return text


def _canvas_summary(root, name):
    data = _file_bytes(root, f'{canvas.FOLDER}/{name}{canvas.SUFFIX}', canvas.MAX_BYTES)
    if data is None or not canvas.NAME.fullmatch(name):
        return f'{name} (invalid)'
    result = canvas.check_bytes(data)
    if result.text is None:
        return f'{name} (invalid)'
    return f"{name} {len(result.doc.get('nodes', []))} nodes {len(result.doc.get('edges', []))} edges"


def _index(root):
    counts, missing = [], []
    for name in canvas.RECORDS:
        filename, data = record_file(root, name)
        if data is None:
            if filename in legacy.RECORDS:
                missing.append(filename[:-3])
            continue
        sections = sum(level == 2 for level, _, _ in canvas.headings(_markdown(data)))
        counts.append(f"{filename[:-3]} {sections}{'' if counts else ' sections'}")
    lines = ['records: ' + ' · '.join(counts) + (' · missing: ' + ', '.join(missing) if missing else '')]
    progress = record_file(root, 'progress')[1]
    action = re.search(r'(?m)^\**Next action:?\**:?[ \t]*(\S.*)$', legacy.split_progress(_markdown(progress))[0]) if progress else None
    next_line = 'next: ' + clip(flat(action.group(1)), 240) if action else ''
    names, _ = canvas.canvas_names(root)
    names = [name[:-len(canvas.SUFFIX)] for name in names]
    head = f'workspace {clip(flat(root.name), 60)} rev='
    state = _git_state(root)
    if names:
        room = INDEX_LIMIT - len(head) - 8 - len(state) - len(lines[0]) - len(next_line) - 3
        full = 'canvases: ' + ' · '.join(_canvas_summary(root, name) for name in names[:canvas.MAX_FILES])
        if len(names) > canvas.MAX_FILES:
            full += f' · +{len(names) - canvas.MAX_FILES} more'
        if len(full) > room:
            full, shown = f'canvases: {len(names)} canvases, read NAME.canvas for each:', 0
            for name in names:
                tail = f' +{len(names) - shown - 1} more' if shown + 1 < len(names) else ''
                if len(full) + len(name) + 2 + len(tail) > room:
                    break
                full += (' ' if not shown else ', ') + name
                shown += 1
            full += f' +{len(names) - shown} more' if shown < len(names) else ''
        lines.append(clip(full, max(room, 20)))
    if next_line:
        lines.append(next_line)
    body = '\n'.join(lines)
    stamp = hashlib.sha256((head + state + '\n' + body).encode('utf-8', 'replace')).hexdigest()[:8]
    return stamp, head + stamp + state, body


def _record(root, name):
    filename, data = record_file(root, name)
    if data is None:
        return None, f'{filename} is not in this workspace'
    return (filename, data, _markdown(data)), None


def _headings(root, name):
    found, error = _record(root, name)
    if error:
        return error
    filename, data, markdown = found
    rows = markdown.split('\n')
    items = canvas.headings(markdown)
    lines = []
    for position, (level, title, line) in enumerate(items):
        end = next((other_line for other_level, _, other_line in items[position + 1:] if other_level <= level), len(rows))
        size = len('\n'.join(rows[line + 1:end]).strip('\n'))
        lines.append(f"{'#' * level} {clip(flat(title), 80)} ({size})")
    return canvas.rev(data), f'{filename} rev={canvas.rev(data)} {len(items)} headings (section size in characters)', '\n'.join(lines)


def _section(root, name, subpath):
    found, error = _record(root, name)
    if error:
        return error
    filename, data, markdown = found
    section = canvas.section_text(markdown, subpath) if canvas.subpath_ok(subpath) else None
    if section is None:
        return f'section {clip(flat(subpath), 80)} is not in {filename}; read "{name}" for its headings'
    title, text = section
    return canvas.rev(data), f'{filename}#{clip(flat(title), 80)} rev={canvas.rev(data)} {len(text)} characters', text


def _node_line(node, missing):
    kind = canvas.kind(node)
    tail = f" @{int(node['x'])},{int(node['y'])} {int(node['width'])}x{int(node['height'])}"
    label, quote, plain = kind, None, None
    if kind == 'note':
        quote = node['text']
    elif kind == 'group':
        quote = node.get('label')
    elif kind == 'section':
        plain = clip(node['file'], 40) + clip(flat(node['subpath']), 40) + (' (not found)' if missing else '')
    elif kind == 'canvas':
        path = node['file']
        plain = path[len(canvas.FOLDER) + 1:-len(canvas.SUFFIX)] if path.startswith(canvas.FOLDER + '/') else clip(path, 50)
        plain += ' (not found)' if missing else ''
    elif kind in ('record', 'image', 'sheet', 'file'):
        plain = clip(node['file'], 50) + (' (not found)' if missing else '')
        quote = node.get('alt') if kind == 'image' else None
    elif kind in ('video', 'embed', 'link'):
        label = kind + ' ' + clip(canvas.provider(node['url'])[1] or 'address', 30)
        quote = node.get('title')
    else:
        label = 'unsupported ' + clip(flat(node['type']), 32)
    line = f"{node['id']} {label}" + (' ' + flat(plain) if plain else '')
    if isinstance(quote, str) and flat(quote):
        room = LINE - len(line) - len(tail) - 3
        if room >= 4:
            line += f' "{clip(flat(quote), room)}"'
    return line + tail


def _edge_text(edge):
    label = flat(edge['label']) if isinstance(edge.get('label'), str) else ''
    return f"{edge['fromNode']}>{edge['toNode']}" + (f' "{clip(label, 30)}"' if label else '')


def _load_canvas(root, name):
    """(data, result) of a canvas file; (None, None) when there is no file; or an error text."""
    relative = f'{canvas.FOLDER}/{name}{canvas.SUFFIX}'
    path = root / relative
    if not os.path.lexists(path):
        return None, None
    data = _file_bytes(root, relative, canvas.MAX_BYTES)
    if data is None:
        return f'{name}.canvas is not a regular file inside the project; it was not read'
    result = canvas.check_bytes(data)
    if result.text is None:
        messages = [item['message'] for item in result.errors]
        more = f' (+{len(messages) - 2} more)' if len(messages) > 2 else ''
        return f"{name}.canvas is not valid: {'; '.join(messages[:2])}{more}. Correct the file, then run check."
    return data, result


def _record_context(root, name):
    """(file name, Markdown) of the record that a canvas name belongs to, or None."""
    if name not in canvas.RECORDS:
        return None
    filename, data = record_file(root, name)
    return (filename, _markdown(data)) if data is not None else None


def _not_placed(doc, record):
    filename, markdown = record
    found = canvas.headings(markdown)
    shown = {canvas.find_heading(found, node['subpath']) for node in doc.get('nodes', [])
             if node.get('type') == 'file' and node.get('file') == filename and canvas.subpath_ok(node.get('subpath'))}
    return ['#' + clip(flat(title), 60) for index, (level, title, _) in enumerate(found) if level == 2 and index not in shown]


def _outline(root, name):
    loaded = _load_canvas(root, name)
    if isinstance(loaded, str):
        return loaded
    data, result = loaded
    record = _record_context(root, name)
    if data is None:
        if record is None:
            where = f'{canvas.RECORDS[name]} is not in this workspace, and there is no {name}.canvas' if name in canvas.RECORDS \
                else f'{name}.canvas is not in {canvas.FOLDER}'
            return where
        lines = _wrap('not placed: ', _not_placed({}, record), ', ')
        return 'new', f'{name}.canvas rev=new 0 nodes 0 edges (no file; the canvas is generated from {record[0]})', '\n'.join(lines)
    doc = result.doc
    lookup = canvas.disk_lookup(root)
    broken = {item['message'].split(':')[0][5:] for item in canvas.reference_errors(doc, lookup) if item['code'] == canvas.DANGLING}
    nodes = sorted(doc.get('nodes', []), key=lambda node: (node.get('type') != 'group', int(node['y']), int(node['x']), node['id']))
    lines = [_node_line(node, node['id'] in broken) for node in nodes]
    edges = sorted(doc.get('edges', []), key=lambda edge: edge['id'])
    if edges:
        lines += _wrap('edges: ', [_edge_text(edge) for edge in edges], '; ')
    if record is not None:
        missing = _not_placed(doc, record)
        if missing:
            lines += _wrap('not placed: ', missing, ', ')
    version = doc.get('horsemen', {}).get('version', 1)
    head = f"{name}.canvas rev={canvas.rev(data)} {len(nodes)} nodes {len(edges)} edges" + (f' (version {int(version)}, read-only)' if result.read_only else '')
    return canvas.rev(data), head, '\n'.join(lines)


def _value(value):
    return flat(value) if isinstance(value, str) else json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def _element(root, name, element):
    loaded = _load_canvas(root, name)
    if isinstance(loaded, str):
        return loaded
    data, result = loaded
    if data is None:
        return f'{name}.canvas has no file, so it has no saved elements; read "{name}.canvas" for the generated canvas'
    doc, stamp = result.doc, canvas.rev(data)
    edges = sorted(doc.get('edges', []), key=lambda edge: edge['id'])
    node = next((item for item in doc.get('nodes', []) if item['id'] == element), None)
    if node is not None:
        kind = canvas.kind(node)
        head = f"{name}.canvas#{element} rev={stamp} {kind} @{int(node['x'])},{int(node['y'])} {int(node['width'])}x{int(node['height'])}"
        head += f" color={node['color']}" if 'color' in node else ''
        lines = [node['text']] if kind == 'note' else []
        skip = canvas.NODE_FIRST + ('color',) + (('text',) if kind == 'note' else ())
        lines += [f'{clip(flat(key), 40)}: {_value(node[key])}' for key in sorted(node) if key not in skip]
        if kind == 'section' and node['file'] in canvas.RECORDS.values():
            lines.append(f"read: {node['file'][:-3].lower()}{flat(node['subpath'])}")
        touching = [_edge_text(edge) for edge in edges if element in (edge['fromNode'], edge['toNode'])]
        if touching:
            lines += _wrap('edges: ', touching, '; ')
        return stamp, head, '\n'.join(lines)
    edge = next((item for item in edges if item['id'] == element), None)
    if edge is None:
        return f'{element} is not on {name}.canvas; read "{name}.canvas" for its elements'
    lines = [f'{clip(flat(key), 40)}: {_value(edge[key])}' for key in sorted(edge) if key not in canvas.EDGE_FIRST]
    top = legacy.git_top(root)
    remote = (legacy.git(root, 'remote', 'get-url', 'origin') or '').strip() if top else ''
    repo = re.fullmatch(r'(?:https://github\.com/|git@github\.com:|ssh://git@github\.com/)([\w.-]+/[\w.-]+)', remote)
    prefix = 'https://horsemen.forsvn.com/' + repo[1].removesuffix('.git') if repo else ''
    params = {'root': root.relative_to(top).as_posix()} if top and root != top else {}
    by_id = {node['id']:node for node in doc.get('nodes', [])}
    for endpoint in ('fromNode', 'toNode'):
        target = edge[endpoint]
        node = by_id.get(target, {})
        board = Path(node.get('file', '')).stem if canvas.kind(node) == 'canvas' else None
        if not prefix:
            lines.append('read: ' + (f'{board}.canvas' if board else f'{name}.canvas#{target}'))
            continue
        query = dict(params, canvas=board or name)
        if not board:
            query['node'] = target
        lines.append(f"[{target}]({prefix}?{urlencode(query)})")
    return stamp, f"{name}.canvas#{element} rev={stamp} edge {edge['fromNode']}>{edge['toNode']}", '\n'.join(lines)


def read(root, target, max_chars=None, offset=0, if_rev=None):
    """The `read` tool. Returns a Reply; the text is within the budget of its kind."""
    if not isinstance(target, str):
        return _fail('target must be text; ' + TARGETS)
    if max_chars is not None and (isinstance(max_chars, bool) or not isinstance(max_chars, int) or not MIN_LIMIT <= max_chars <= MAX_LIMIT):
        return _fail('max_chars must be a whole number from 200 to 8,000')
    if isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
        return _fail('offset must be a whole number, 0 or more')
    if if_rev is not None and not isinstance(if_rev, str):
        return _fail('if_rev must be the rev text of an earlier reply')
    root = Path(root).resolve()
    if not is_workspace(root):
        return _fail(NO_RECORDS.format(clip(str(root), 160)))
    limit = max_chars or DEFAULT_LIMIT
    record, board = _RECORD.fullmatch(target), _CANVAS.fullmatch(target)
    if target == '':
        found, limit = _index(root), min(limit, INDEX_LIMIT)
    elif record and record.group(1).lower() in canvas.RECORDS and not record.group(2):
        found, limit = _headings(root, record.group(1).lower()), min(limit, HEADINGS_LIMIT)
    elif record and record.group(1).lower() in canvas.RECORDS:
        found = _section(root, record.group(1).lower(), record.group(2))
    elif board and board.group(2) is None:
        found = _outline(root, board.group(1))
    elif board and canvas.ID.fullmatch(board.group(2)):
        found = _element(root, board.group(1), board.group(2))
    else:
        return _fail(f'unknown target {clip(flat(target), 60)!r}; {TARGETS}')
    if isinstance(found, str):
        return _fail(found)
    stamp, head, body = found
    if if_rev is not None and if_rev == stamp:
        return Reply(True, 'unchanged rev=' + stamp, 0)
    return Reply(True, clip(_page(head, body, offset, limit), limit), 0)


# ---------------------------------------------------------------- canvas_edit

def _write(root, path, text, before):
    """Replace the canvas file. Refuses when the file changed after it was read."""
    folder = path.parent
    folder.mkdir(parents=True, exist_ok=True)
    if canvas.inside(root, folder) is None:
        return 'the canvas folder is not inside the project'
    temporary = folder / f'.{path.name}.{secrets.token_hex(6)}.tmp'
    try:
        with open(temporary, 'x', encoding='utf-8', newline='') as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        current = path.read_bytes() if os.path.lexists(path) else None
        if current != before:
            return 'the file changed while the edit ran; read it again'
        os.replace(temporary, path)
    finally:
        try:
            temporary.unlink()
        except OSError:
            pass
    _cache.pop(str(path), None)
    return None


def canvas_edit(root, name, ops, base_rev=None, dry_run=False):
    """The `canvas_edit` tool: apply ops to one canvas file, all or nothing. Does not commit."""
    if not isinstance(name, str) or not canvas.NAME.fullmatch(name):
        return _refuse('error: canvas name must be 1 to 64 lower-case letters, digits, or "-", for example progress or launch-plan', 2)
    if base_rev is not None and not isinstance(base_rev, str):
        return _refuse('error: base_rev must be the rev text of an earlier reply', 2)
    if not isinstance(dry_run, bool):
        return _refuse('error: dry_run must be true or false', 2)
    if not isinstance(ops, list):
        return _refuse('error: ops must be a list', 2)
    root = Path(root).resolve()
    if not is_workspace(root):
        return _refuse('error: ' + NO_RECORDS.format(clip(str(root), 160)), 2)
    names, state = canvas.canvas_names(root)
    if state == 'outside' or (os.path.lexists(root / '.horsemen') and canvas.inside(root, root / '.horsemen') is None):
        return _refuse(f'error: {canvas.FOLDER} is not a folder inside the project')
    path = root / canvas.FOLDER / (name + canvas.SUFFIX)
    loaded = _load_canvas(root, name)
    if isinstance(loaded, str):
        return _refuse('error: ' + loaded.replace(' Correct the file, then run check.', ' Correct the file by hand first'))
    data, result = loaded
    current = canvas.rev(data) if data is not None else 'new'
    if base_rev is not None and base_rev != current:
        return _refuse(f'conflict: {name}.canvas is rev={current}, not base_rev={clip(flat(base_rev), 40)}; read it again')
    if data is None:
        if not ops:
            return _refuse(f'error: there is no canvas file {name}.canvas and no ops')
        if len(names) >= canvas.MAX_FILES:
            return _refuse(f'error: this workspace has {len(names)} canvas files; the limit is {canvas.MAX_FILES} canvas files')
        doc = {'nodes': [], 'edges': []}
    elif result.read_only:
        return _refuse(f"error: {name}.canvas has version {int(result.doc['horsemen']['version'])}, which is newer than this tool; update Horsemen")
    else:
        doc = result.doc
    lookup = canvas.disk_lookup(root)
    try:
        doc, summary = canvas.apply_ops(doc, ops, _record_context(root, name), lookup)
    except canvas.EditError as error:
        where = f'error op {error.op} ({error.verb or "unknown"}): ' if error.op else 'error: '
        return _refuse(where + error.message)
    text = canvas.canonical(doc)
    encoded = text.encode('utf-8')
    checked = canvas.check_bytes(encoded, lookup)
    if checked.text is None:
        return _refuse('error: ' + checked.errors[0]['message'])
    if not dry_run and encoded != data:
        problem = _write(root, path, text, data)
        if problem:
            return _refuse('conflict: ' + problem)
    added = summary['added']
    shown = []
    for item in added:
        if len(','.join(shown + [item])) > 150:
            break
        shown.append(item)
    listed = ','.join(shown) + (f',+{len(added) - len(shown)}' if len(shown) < len(added) else '') if added else '-'
    reply = f"ok{' (dry run)' if dry_run else ''} rev={canvas.rev(encoded)} added={listed} updated={summary['updated']} removed={summary['removed']}"
    warnings = [item['message'] for item in checked.errors]
    count = 0
    for message in warnings[:5]:
        line = '\nwarning: ' + clip(message, 120)
        if len(reply) + len(line) > EDIT_LIMIT - 40:
            break
        reply += line
        count += 1
    if count < len(warnings):
        reply += f'\n{len(warnings)} warnings in all; run check'
    return Reply(True, clip(reply, EDIT_LIMIT), 0)


# ---------------------------------------------------------------- command line

def workspace_root(path=None):
    """The project root for a path (default: the current folder), or None when no record is found."""
    start = Path(path).expanduser() if path else Path.cwd()
    return legacy.find_root(start)[0] if start.is_dir() else None


def cli_show(argv):
    import argparse
    import sys
    parser = argparse.ArgumentParser(prog='horsemen show', description='Print a part of the workspace as short plain text. This is the `read` tool.')
    parser.add_argument('target', nargs='?', default='', help='"" index; progress; progress#Shipped; progress.canvas; progress.canvas#id')
    parser.add_argument('--path', help='Project directory (default: current project)')
    parser.add_argument('--max-chars', type=int, help='Reply size, 200 to 8,000 characters')
    parser.add_argument('--offset', type=int, default=0, help='Continue from this offset, as a "more:" line says')
    parser.add_argument('--if-rev', help='Print "unchanged" when the rev is still this one')
    args = parser.parse_args(argv)
    root = workspace_root(args.path)
    reply = read(root, args.target, args.max_chars, args.offset, args.if_rev) if root else _fail(NO_RECORDS.format(args.path or 'this folder or above it'))
    print(reply.text, file=sys.stdout if reply.ok else sys.stderr)
    return 0 if reply.ok else 2


def cli_canvas(argv):
    import argparse
    import sys
    parser = argparse.ArgumentParser(prog='horsemen canvas', description='Change one canvas file in .horsemen/canvas. This is the `canvas_edit` tool.')
    sub = parser.add_subparsers(dest='action', required=True)
    apply = sub.add_parser('apply', help='Check, format, and write a canvas file; does not commit')
    apply.add_argument('canvas', help='Canvas name, for example progress or launch-plan')
    apply.add_argument('--ops', help='JSON file with a list of ops, or "-" for standard input. Without it, only rewrite the file in canonical form')
    apply.add_argument('--base-rev', help='Refuse when the file is not at this rev')
    apply.add_argument('--dry-run', action='store_true', help='Check the ops and print the result; write nothing')
    apply.add_argument('--path', help='Project directory (default: current project)')
    args = parser.parse_args(argv)
    ops = []
    if args.ops:
        try:
            raw = sys.stdin.read() if args.ops == '-' else Path(args.ops).read_text(encoding='utf-8')
            ops = json.loads(raw)
        except (OSError, ValueError) as error:
            print(f'Cannot read ops: {clip(str(error), 200)}', file=sys.stderr)
            return 2
        ops = ops['ops'] if isinstance(ops, dict) and isinstance(ops.get('ops'), list) else ops
    root = workspace_root(args.path)
    reply = canvas_edit(root, args.canvas, ops, args.base_rev, args.dry_run) if root \
        else _refuse('error: ' + NO_RECORDS.format(args.path or 'this folder or above it'), 2)
    print(reply.text, file=sys.stdout if reply.ok else sys.stderr)
    return reply.code
