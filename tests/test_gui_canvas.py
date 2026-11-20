"""Canvas files in the local workspace reader. All projects, canvases, and files are fictional.

The reader finds `.horsemen/canvas/<name>.canvas` in each project root, loads the text, and
registers the files that a canvas names. The browser checks and draws the text.

Failure modes covered: a canvas file outside the canvas folder of a project root, in a sub-folder,
with a bad name, or behind a symlink is listed; more than 20 files load; a file larger than
512 KiB is fetched (the 2 MiB case); a blob larger than its listed size, bad base64, or text that
is not UTF-8 stops the project; a canvas failure hides the records; the project list carries
canvas paths; a path with `..`, a leading `/`, a backslash, or a control character becomes a
readable link; text that is not JSON, or 5,000 nodes, stops the reader; a file that no loaded
canvas names can be read; a failed canvas load is cached; the page files of the canvas are not served."""
import base64
import json
import threading
import unittest
from pathlib import Path
from urllib.request import Request, urlopen
from test_gui import Fake
from horsemen_core.gui import GitHubReader, ScanState, ProviderError, make_server, discover_roots, discover_canvases, MAX_FILE, MAX_CANVASES
from horsemen_core.gui_links import canvas_links

PNG = b'\x89PNG\r\n\x1a\n' + b'\x00' * 24
REV = 'a' * 40

def entries(paths, **extra):
    return [dict({'path': p, 'type': 'blob', 'mode': '100644', 'sha': 'x', 'size': 1}, **extra) for p in paths]

def node(**extra):
    return dict({'id': 'a', 'type': 'file', 'x': 0, 'y': 0, 'width': 320, 'height': 160}, **extra)

CANVAS = json.dumps({'nodes': [
    node(id='img', file='img/board.png', alt='Pilot board'), node(id='s-shipped', file='PROGRESS.md', subpath='#Shipped'),
    node(id='doc', file='docs/research.md'), node(id='up', file='../outside.png'), node(id='abs', file='/etc/passwd'),
    node(id='portal', file='.horsemen/canvas/launch-plan.canvas'), {'id': 'note', 'type': 'text', 'x': 0, 'y': 0, 'width': 320, 'height': 160, 'text': 'A note.'}]})

class CanvasFake(Fake):
    """One project with two canvas files and one image."""
    def __init__(self):
        super().__init__()
        self.canvases = {'progress': CANVAS.encode(), 'launch-plan': b'{"nodes":[]}'}
        self.sizes = {}
    def blob(self, data): return {'encoding': 'base64', 'content': base64.b64encode(data).decode()}
    def __call__(self, path, paginate=False):
        if '/git/blobs/canvas-' in path:
            self.calls.append(path)
            name = path.rsplit('/git/blobs/canvas-', 1)[1]
            data = self.canvases[name]
            return data if isinstance(data, dict) else self.blob(data)
        if '/contents/img/board.png?' in path:
            self.calls.append(path)
            return {'type': 'file', 'sha': 'e' * 40, 'size': len(PNG), 'encoding': 'base64', 'content': base64.b64encode(PNG).decode()}
        if '/contents/docs/research.md?' in path:
            self.calls.append(path)
            return {'type': 'file', 'sha': 'f' * 40, 'size': 20, 'encoding': 'base64', 'content': base64.b64encode(b'# Research\nBody').decode()}
        if '/contents/' in path: raise ProviderError('Repository or record is no longer accessible.', 404)
        result = super().__call__(path, paginate)
        if '/git/trees/' in path:
            result['tree'] += [{'path': f'.horsemen/canvas/{name}.canvas', 'type': 'blob', 'mode': '100644', 'sha': 'canvas-' + name,
                                'size': self.sizes.get(name, len(data) if isinstance(data, bytes) else 10)} for name, data in self.canvases.items()]
        return result

def loaded(fake=None):
    f = fake or CanvasFake(); s = ScanState(GitHubReader(f)); s.scan_sync(); pid = s.snapshot()['projects'][0]['id']
    return f, s, pid, s.load_project(pid)

class DiscoveryTests(unittest.TestCase):
    def test_canvas_files_belong_to_a_project_root(self):
        paths = ['VISION.md', 'PROGRESS.md', '.horsemen/canvas/progress.canvas', '.horsemen/canvas/launch-plan.canvas',
                 'apps/web/VISION.md', 'apps/web/BRAIN.md', 'apps/web/.horsemen/canvas/brain.canvas',
                 'other/.horsemen/canvas/x.canvas', '.horsemen/canvas/sub/deep.canvas', '.horsemen/canvas/Bad.canvas', '.horsemen/canvas/a_b.canvas',
                 '.horsemen/canvas/.canvas', '.horsemen/canvas/x.json', '.horsemen/media/x.canvas', 'docs/.horsemen/canvas/y.canvas', 'x.horsemen/canvas/z.canvas',
                 '.horsemen/canvas/' + 'a' * 64 + '.canvas', '.horsemen/canvas/' + 'a' * 65 + '.canvas']
        tree = entries(paths) + [{'path': '.horsemen/canvas/link.canvas', 'type': 'blob', 'mode': '120000', 'sha': 'x', 'size': 1},
                                 {'path': '.horsemen/canvas/tree.canvas', 'type': 'tree', 'mode': '040000', 'sha': 'x'}]
        found = discover_canvases(tree, discover_roots(tree))
        self.assertEqual({root: sorted(files) for root, files in found.items()}, {'': ['a' * 64, 'launch-plan', 'progress'], 'apps/web': ['brain']})
        self.assertEqual(found['']['progress'], {'path': '.horsemen/canvas/progress.canvas', 'sha': 'x', 'size': 1})
    def test_at_most_twenty_files_in_name_order(self):
        tree = entries(['VISION.md', 'PROGRESS.md'] + [f'.horsemen/canvas/board-{i:02d}.canvas' for i in range(29, -1, -1)])
        found = discover_canvases(tree, discover_roots(tree))['']
        self.assertEqual(MAX_CANVASES, 20)
        self.assertEqual(list(found), [f'board-{i:02d}' for i in range(20)])
    def test_scan_lists_canvases_but_the_project_list_does_not(self):
        f = CanvasFake(); reader = GitHubReader(f); project = reader.scan_repo(f('/user/repos')[0])[0]
        self.assertEqual(sorted(project['canvases']), ['launch-plan', 'progress'])
        self.assertNotIn('content', project['canvases']['progress'])
        s = ScanState(reader); s.scan_sync()
        self.assertNotIn('canvases', s.snapshot()['projects'][0]); self.assertNotIn('files', s.snapshot()['projects'][0])

class LoadTests(unittest.TestCase):
    def test_canvas_text_and_links(self):
        f, s, pid, data = loaded()
        self.assertNotIn('canvases', data['project'])
        canvas = data['canvases']['progress']
        self.assertEqual(canvas['content'], CANVAS)
        self.assertEqual([canvas['name'], canvas['path'], canvas['url']], ['progress', '.horsemen/canvas/progress.canvas', f'https://github.com/example/alpha/blob/{REV}/.horsemen/canvas/progress.canvas'])
        self.assertEqual([(l['path'], l['kind'], l['title']) for l in canvas['connections']],
                         [('img/board.png', 'attachment', 'Pilot board'), ('PROGRESS.md', 'document', 'PROGRESS.md'), ('docs/research.md', 'document', 'research.md')])
        self.assertEqual(data['canvases']['launch-plan']['connections'], [])
        self.assertIn('content', data['records']['vision'])
    def test_files_that_a_canvas_names_can_be_read(self):
        f, s, pid, data = loaded()
        links = {l['path']: l for l in data['canvases']['progress']['connections']}
        image = s.load_image(pid, links['img/board.png']['id'])
        self.assertEqual([image['type'], image['bytes']], ['image/png', PNG])
        self.assertTrue(f.calls[-1].endswith('/contents/img/board.png?ref=' + REV))
        self.assertEqual(s.load_document(pid, links['docs/research.md']['id'])['content'], '# Research\nBody')
        with self.assertRaises(ProviderError): s.load_image(pid, links['docs/research.md']['id'])
        with self.assertRaises(ProviderError): s.load_image(pid, 'f' * 24)
    def test_a_file_over_the_limit_is_not_fetched(self):
        f = CanvasFake(); f.sizes['progress'] = 2 * 1024 * 1024
        f, s, pid, data = loaded(f)
        self.assertEqual(data['canvases']['progress']['error'], 'The canvas file is larger than 512 KiB.')
        self.assertNotIn('content', data['canvases']['progress'])
        self.assertFalse(any('canvas-progress' in call for call in f.calls), 'the reader does not fetch a file that is too large')
        self.assertIn('content', data['canvases']['launch-plan']); self.assertIn('content', data['records']['vision'])
    def test_bad_blobs_fail_one_canvas_only(self):
        cases = {'big': b'x' * (MAX_FILE + 1), 'binary': b'\xff\xfe\x00', 'encoding': {'encoding': 'utf-8', 'content': '{}'}, 'base64': {'encoding': 'base64', 'content': '!bad!'},
                 'missing': {'encoding': 'base64'}, 'bom': b'\xef\xbb\xbf{"nodes":[]}', 'not-json': b'not json', 'edge': b'{"nodes":[],"pad":"' + b'x' * (MAX_FILE - 21) + b'"}'}
        f = CanvasFake(); f.canvases = dict(cases); f.sizes = {name: 10 for name in cases}
        f, s, pid, data = loaded(f)
        errors = {name: canvas.get('error') for name, canvas in data['canvases'].items()}
        self.assertEqual(errors, {'big': 'The canvas file is larger than 512 KiB.', 'binary': 'The canvas file could not be decoded as UTF-8 text.', 'encoding': 'Unsupported canvas encoding.',
                                  'base64': 'The canvas file could not be decoded as UTF-8 text.', 'missing': 'The canvas file could not be decoded as UTF-8 text.', 'bom': None, 'not-json': None, 'edge': None})
        self.assertEqual(data['canvases']['bom']['content'], '{"nodes":[]}')
        self.assertEqual([data['canvases']['not-json']['content'], data['canvases']['not-json']['connections']], ['not json', []], 'the browser reports text that is not JSON')
        self.assertEqual(len(data['canvases']['edge']['content'].encode()), MAX_FILE)
        self.assertIn('content', data['records']['vision'])
    def test_a_provider_failure_on_a_canvas_is_not_cached(self):
        f = CanvasFake(); real = f.blob; state = {'fail': True}
        def blob(data):
            if state['fail'] and data == f.canvases['launch-plan']: raise ProviderError('GitHub denied access or reached a rate limit. Check access, then retry.', 403)
            return real(data)
        f.blob = blob
        f, s, pid, data = loaded(f)
        self.assertEqual(data['canvases']['launch-plan']['error'], 'GitHub denied access or reached a rate limit. Check access, then retry.')
        self.assertIn('content', data['canvases']['progress'])
        state['fail'] = False
        self.assertIn('content', s.load_project(pid)['canvases']['launch-plan'], 'the next load reads the canvas again')
        count = len(f.calls); s.load_project(pid)
        self.assertEqual(len([c for c in f.calls[count:] if '/git/blobs/' in c]), 0, 'a complete load is cached')

class LinkTests(unittest.TestCase):
    def links(self, nodes, root=''):
        return canvas_links(json.dumps({'nodes': nodes}), (root + '/' if root else '') + '.horsemen/canvas/progress.canvas', root, 'example/alpha', REV)
    def test_only_safe_file_nodes_become_links(self):
        bad = ['../outside.png', 'a/../../b.png', '/etc/passwd', 'a\\b.png', 'a\nb.png', 'a\x00.png', './a.png', 'a/./b.png', 'a//b.png', 'a/', '', 'x' * 1025, '..', '.', 7, None, ['a.png'], '\ud800.png']
        nodes = [node(id=f'n{i}', file=target) for i, target in enumerate(bad)] + [{'id': 'l', 'type': 'link', 'url': 'https://example.com/a.png', 'file': 'x.png'}, {'id': 't', 'type': 'text', 'file': 'y.png'}, 'node', None, 7, ['a']]
        self.assertEqual(self.links(nodes), [])
        self.assertEqual([l['path'] for l in self.links([node(file='a b/é 😀.png'), node(file='x' * 1024), node(file='.horsemen/media/route-map.svg'), node(file='a..b/c...png')])],
                         ['a b/é 😀.png', 'x' * 1024, '.horsemen/media/route-map.svg', 'a..b/c...png'])
    def test_link_fields(self):
        one, two, three = self.links([node(file='img/a b.png', alt='A board'), node(file='docs/Guide.MD', subpath='#Start'), node(file='notes/x.markdown', alt='')], 'apps/web')
        self.assertEqual(one, {'id': one['id'], 'title': 'A board', 'href': f'https://github.com/example/alpha/blob/{REV}/apps/web/img/a%20b.png', 'path': 'apps/web/img/a b.png', 'kind': 'attachment', 'source': 'apps/web/.horsemen/canvas/progress.canvas'})
        self.assertRegex(one['id'], r'^[0-9a-f]{24}$')
        self.assertEqual([two['kind'], two['title'], three['kind'], three['title']], ['document', 'Guide.MD', 'document', 'x.markdown'])
    def test_portals_and_repeats_are_not_links(self):
        found = self.links([node(file='.horsemen/canvas/launch-plan.canvas'), node(file='a.png'), node(id='b', file='a.png', alt='Again')])
        self.assertEqual([(l['path'], l['title']) for l in found], [('a.png', 'a.png')])
    def test_text_that_is_not_a_canvas_gives_no_links(self):
        for text in ['', 'not json', '[]', 'null', '7', '{"nodes":{}}', '{"nodes":"x"}', '{"nodes":[{"type":"file","file":"a.png","x":NaN}]}', '{"nodes":[{"type":"file","file":"a.png","x":Infinity}]}',
                     '[' * 100000 + ']' * 100000, '{"nodes":' + '[' * 100000 + ']' * 100000 + '}',
                     json.dumps({'nodes': [node(id=f'n{i}', file=f'img/{i}.png') for i in range(5000)]}), json.dumps({'nodes': [node(id=f'n{i}', file=f'img/{i}.png') for i in range(501)]})]:
            self.assertEqual(canvas_links(text, '.horsemen/canvas/x.canvas', '', 'example/alpha', REV), [], text[:40])
        self.assertEqual(len(self.links([node(id=f'n{i}', file=f'img/{i}.png') for i in range(500)])), 500)

class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.server = make_server(0, ScanState(GitHubReader(CanvasFake())), Path(__file__).resolve().parents[1] / 'web')
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start(); self.base = 'http://127.0.0.1:' + str(self.server.server_port)
    def tearDown(self): self.server.shutdown(); self.server.server_close(); self.thread.join()
    def get(self, path): return urlopen(Request(self.base + path, headers={'X-Horsemen-Session': self.server.session}))
    def test_project_has_canvases_and_page_files(self):
        self.server.state.scan_sync(); pid = self.server.state.snapshot()['projects'][0]['id']
        data = json.load(self.get('/api/project?id=' + pid))
        self.assertEqual(sorted(data['canvases']), ['launch-plan', 'progress']); self.assertEqual(data['canvases']['progress']['content'], CANVAS)
        link = next(l for l in data['canvases']['progress']['connections'] if l['path'] == 'img/board.png')
        image = self.get(f'/api/image?id={pid}&link={link["id"]}')
        self.assertEqual([image.headers['Content-Type'], image.read()], ['image/png', PNG])
        page = urlopen(self.base + '/').read().decode()
        for name in ['/canvas-format.js', '/canvas-view.js']:
            self.assertIn(f'<script src="{name}" defer>', page)
            r = urlopen(self.base + name); self.assertEqual([r.status, r.headers['Content-Type']], [200, 'text/javascript; charset=utf-8'])

if __name__ == '__main__': unittest.main()
