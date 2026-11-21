"""Fictional canvas files for the browser checks of the local app and the hosted viewer.

The files are written by hand, as an agent writes them: one element on each line, not always in
canonical order. They name records and headings that both test projects have. Some content is
hostile on purpose: script text, a `javascript:` address, CSS in a colour, a path with `..`,
5,000 nodes, a file of 2 MiB, and an SVG image with a script. The Proof board (slice 2b) has two
players, two tables, an XLSX file, a look-alike host, and a table that is not in the repository. Its
provider addresses are fictional; the browser checks answer them with a local fake player.
"""
import json
import struct
import zlib


def png(width, height, rgb):
    """A small solid PNG, built here so the fixture needs no binary file."""
    chunk = lambda kind, data: struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    rows = b''.join(b'\x00' + bytes(rgb) * width for _ in range(height))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')


def node(id, type, x, y, width, height, **keys):
    return dict(id=id, type=type, x=x, y=y, width=width, height=height, **keys)


def edge(id, start, end, **keys):
    return dict(id=id, fromNode=start, toNode=end, **keys)


def canvas(nodes, edges=()):
    """The text of a canvas file with one element on each line."""
    block = lambda items: '[\n' + ',\n'.join(json.dumps(item, ensure_ascii=False, separators=(',', ':')) for item in items) + '\n]' if items else '[]'
    return '{\n"horsemen":{"version":1},\n"nodes":' + block(list(nodes)) + ',\n"edges":' + block(list(edges)) + '\n}\n'


SCRIPT = '<script>window.pwned=1</script><img src=x onerror="window.pwned=1">'
# An SVG with a script. The app shows it only as an image from a blob: address.
LOGO = b'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" onload="window.pwned=1"><script>window.pwned=1</script><rect width="120" height="80" fill="#22604f"/><circle cx="60" cy="40" r="24" fill="#fbf8f2"/></svg>'
MEDIA = {
    '.horsemen/media/board.png': png(96, 54, (51, 64, 122)),
    '.horsemen/media/logo.svg': LOGO,
    # 40 weeks, so the table scrolls in its card. One note has markup that must stay text.
    '.horsemen/media/signups.csv': ('week,guests,note\n' + ''.join(f'{w},{10 + w * 3},' + ('"<img src=x onerror=""window.pwned=1"">"' if w == 3 else '"Harbour loop, east"' if w == 1 else '') + '\n' for w in range(1, 41))).encode(),
    '.horsemen/media/stops.tsv': b'stop\tminutes\nHarbour, east\t12\nOld gate\t4\n',
    '.horsemen/media/budget.xlsx': b'PK\x03\x04 fictional workbook',
}

# The canvas of the Structure record: a sparse file. It places one section; the app places the others.
STRUCTURE = canvas([
    node('s-map', 'file', 0, 0, 320, 220, color='4', file='STRUCTURE.md', subpath='#Map'),
    node('note-risk', 'text', 0, 300, 320, 200, color='1',
         text='**Risk:** the map is one week old.\n\n' + SCRIPT + '\n\n[Research](docs/research.md) and [a script](javascript:window.pwned=1).'),
    node('g-proof', 'group', 400, -60, 940, 380, label='Proof for the pilot'),
    node('img-board', 'file', 440, 0, 400, 240, alt='Pilot board', file='.horsemen/media/board.png'),
    node('img-logo', 'file', 880, 0, 240, 160, alt='Pilot logo', file='.horsemen/media/logo.svg'),
    node('link-survey', 'link', 880, 190, 380, 110, title='Pilot survey results', url='https://example.com/survey?round=1'),
    node('ref-shipped', 'file', 400, 400, 320, 200, file='PROGRESS.md', subpath='#Shipped'),
    node('doc-research', 'file', 1000, 400, 320, 110, file='docs/research.md'),
    node('sheet-signups', 'file', 1000, 540, 320, 110, file='.horsemen/media/signups.csv'),
    node('to-launch', 'file', 1000, 680, 320, 110, file='.horsemen/canvas/launch-plan.canvas'),
    node('odd', 'sticker', 400, 640, 320, 110, emoji='star'),
], [
    edge('e-proof', 's-map', 'img-board', label='proof'),
    edge('e-risk', 'note-risk', 's-map', label='blocks', color='1', fromSide='top', toSide='bottom'),
    edge('e-hostile', 'ref-shipped', 'doc-research', label='<img src=x onerror=window.pwned=1>', fromEnd='arrow'),
])

# A board. Some elements have the names of records and of built-in keys.
LAUNCH_PLAN = canvas([
    node('g-ideas', 'group', -40, -60, 760, 300, color='6', label='Ideas'),
    node('progress', 'text', 0, 0, 320, 140, text='Invite the pilot guests in one message.'),
    node('constructor', 'text', 360, 0, 320, 140, color='#33407A', text='Ask two partners for a quote.'),
    node('ref-shipped', 'file', 0, 320, 320, 200, file='PROGRESS.md', subpath='#Shipped'),
    node('ref-gone', 'file', 360, 320, 320, 200, file='PROGRESS.md', subpath='#Renamed heading'),
    node('to-structure', 'file', 760, 0, 280, 110, file='.horsemen/canvas/structure.canvas'),
    node('to-nowhere', 'file', 760, 140, 280, 110, file='.horsemen/canvas/not-there.canvas'),
], [
    edge('e-next', 'progress', 'constructor', label='then'),
])

# Players and tables (slice 2b). The video and sheet addresses are fictional.
PROOF = canvas([
    node('g-proof', 'group', -40, -60, 1080, 420, label='Pilot proof'),
    node('vid-demo', 'link', 0, 0, 480, 300, title='Pilot walkthrough (2 min)', url='https://www.youtube.com/watch?v=Pilot-Demo1&t=1m5s'),
    node('sheet-budget', 'link', 520, 0, 480, 300, title='Pilot budget', url='https://docs.google.com/spreadsheets/d/PILOT-BUDGET-FICTIONAL-0001/edit#gid=0'),
    node('table-signups', 'file', 0, 420, 480, 320, file='.horsemen/media/signups.csv'),
    node('table-stops', 'file', 520, 420, 400, 220, file='.horsemen/media/stops.tsv'),
    node('file-budget', 'file', 520, 680, 320, 110, file='.horsemen/media/budget.xlsx'),
    node('link-lookalike', 'link', 960, 420, 320, 120, title='Not a player', url='https://www.youtube.com.example.net/watch?v=Pilot-Demo1'),
    node('table-missing', 'file', 960, 580, 320, 160, file='.horsemen/media/gone.csv'),
], [
    edge('e-demand', 'vid-demo', 'table-signups', label='demand'),
])

# Hostile elements. The reader refuses three of them; the others show as text.
REVIEW = canvas([
    node('ok', 'text', 0, 0, 320, 160, text='This note is valid. ' + SCRIPT),
    node('evil', 'link', 360, 0, 320, 120, url='javascript:window.pwned=1', title='Not a link'),
    node('css', 'text', 0, 200, 320, 140, color='red;background:url(https://example.com/x.png)', text='A colour with CSS.'),
    node('up', 'file', 360, 200, 320, 120, file='../../secrets.md'),
    node('label', 'group', -40, -60, 760, 440, label=SCRIPT),
    node('quoted', 'link', 720, 0, 320, 120, url='https://example.com/?q="><script>window.pwned=1</script>', title=SCRIPT),
])

CANVASES = {
    'structure': STRUCTURE,
    'launch-plan': LAUNCH_PLAN,
    'review': REVIEW,
    'proof': PROOF,
    # The name of a built-in key is a valid file name.
    'constructor': canvas([node('only', 'text', 0, 0, 320, 140, text='A board with an unusual name.')]),
    # A file that is not JSON: the canvas of the Brain record shows a message and the sections of the record.
    'brain': '{\n"nodes":[\n{"id":"a","type":"text","x":0,"y":0,"width":320,"height":140,"text":"The line has no end\n]\n}\n',
    # A reserved name. The file belongs to Home; this slice does not show it, and it is not a board.
    'home': canvas([node('pin', 'text', 0, 0, 320, 140, text='A note for Home.')]),
    # 5,000 nodes: over the limit of 500.
    'crowd': canvas([node(f'n{i}', 'text', i * 10, 0, 320, 140, text='x') for i in range(5000)]),
}
# A file of 2 MiB. The tree lists its size; a reader must refuse it without a request for its content.
HEAVY_SIZE = 2 * 1024 * 1024
BOARDS = ['constructor', 'crowd', 'heavy', 'launch-plan', 'proof', 'review']
# The origins of the players. A browser check answers each of them with a fake player.
PLAYER_ORIGINS = ['https://www.youtube-nocookie.com', 'https://player.vimeo.com', 'https://www.loom.com', 'https://www.figma.com', 'https://docs.google.com', 'https://drive.google.com']
