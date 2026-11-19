"""The canvas_edit tool: edit ops on one canvas file. All data is fictional.

Failure modes covered:
- add: no id (one is made), a used id, a node without its content, an edge to a missing node,
  both `node` and `edge`, neither
- update: unknown id, a new id, a value that breaks a rule, null removes a key
- remove: unknown id; the edges of a removed node go with it
- one bad op in a batch: nothing is written, and the reply names the op and the rule
- base_rev: a changed file, a new file, a file that should not exist
- near: no coordinates needed, no overlap, each side, a taken place, an unknown element,
  a `#Heading` that saves its section card first, a heading that does not exist
- the written file: canonical text, unknown keys kept, other lines unchanged, no temporary file left
- limits: 50 ops, 500 nodes, 20 canvas files, a reply of 400 characters
- files: a missing file, a missing heading, media over 1 MiB, media that is not its type;
  an old broken card elsewhere does not block an edit
- the file on disk: not JSON, a newer version, a bad name, a folder that leaves the project
- dry run: nothing is written
"""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'horsemen/scripts'))
from horsemen_core import agent_tools, canvas  # noqa: E402

FIXTURES = ROOT / 'tests/fixtures/canvas'
REPLY_LIMIT = 400


def overlap(a, b):
    return a['x'] < b['x'] + b['width'] and b['x'] < a['x'] + a['width'] and a['y'] < b['y'] + b['height'] and b['y'] < a['y'] + a['height']


class Edit(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve() / 'lantern-walks'
        shutil.copytree(FIXTURES / 'workspace', self.root)
        self.folder = self.root / '.horsemen/canvas'

    def path(self, name):
        return self.folder / (name + '.canvas')

    def doc(self, name):
        return json.loads(self.path(name).read_text(encoding='utf-8'))

    def node(self, name, node_id):
        return next(n for n in self.doc(name)['nodes'] if n['id'] == node_id)

    def edit(self, name, ops, **options):
        reply = agent_tools.canvas_edit(self.root, name, ops, **options)
        self.assertLessEqual(len(reply.text), REPLY_LIMIT, reply.text)
        return reply

    def refused(self, name, ops, *words, **options):
        before = self.path(name).read_bytes() if self.path(name).exists() else None
        reply = self.edit(name, ops, **options)
        self.assertFalse(reply.ok, reply.text)
        for word in words:
            self.assertIn(word, reply.text)
        self.assertIn('nothing written', reply.text)
        after = self.path(name).read_bytes() if self.path(name).exists() else None
        self.assertEqual(before, after)
        return reply

    def assert_canonical(self, name):
        data = self.path(name).read_bytes()
        result = canvas.check_bytes(data, canvas.disk_lookup(self.root))
        self.assertEqual(result.errors, [])
        self.assertTrue(result.canonical)

    # ---- add
    def test_add_note_makes_an_id_and_a_place(self):
        reply = self.edit('launch-plan', [{'op': 'add', 'node': {'text': 'Ask the harbour office about a permit.'}}])
        self.assertTrue(reply.ok, reply.text)
        self.assertRegex(reply.text, r'^ok rev=[0-9a-f]{8} added=note-1 updated=0 removed=0$')
        added = self.node('launch-plan', 'note-1')
        self.assertEqual(added['type'], 'text')
        others = [n for n in self.doc('launch-plan')['nodes'] if n['id'] != 'note-1' and n['type'] != 'group']
        self.assertFalse(any(overlap(added, other) for other in others))
        self.assert_canonical('launch-plan')
        second = self.edit('launch-plan', [{'op': 'add', 'node': {'text': 'Second.'}}, {'op': 'add', 'node': {'text': 'Third.'}}])
        self.assertIn('added=note-2,note-3', second.text)

    def test_add_each_kind_takes_its_type_from_its_keys(self):
        ops = [{'op': 'add', 'node': {'url': 'https://example.com/lantern-walks/press', 'title': 'Press page'}},
               {'op': 'add', 'node': {'file': '.horsemen/media/route-map.svg', 'alt': 'Route map'}},
               {'op': 'add', 'node': {'file': '.horsemen/media/pilot-signups.csv'}},
               {'op': 'add', 'node': {'file': '.horsemen/canvas/progress.canvas'}},
               {'op': 'add', 'node': {'file': 'README.md'}},
               {'op': 'add', 'node': {'type': 'group', 'label': 'Later'}},
               {'op': 'add', 'node': {'file': 'PROGRESS.md', 'subpath': '#Gates'}}]
        reply = self.edit('launch-plan', ops)
        self.assertTrue(reply.ok, reply.text)
        self.assertIn('added=link-1,img-1,sheet-1,to-1,ref-1,g-1,s-gates', reply.text)
        nodes = {n['id']: n for n in self.doc('launch-plan')['nodes']}
        self.assertEqual([nodes[i]['type'] for i in ('link-1', 'img-1', 'sheet-1', 'to-1', 'ref-1', 'g-1', 's-gates')],
                         ['link', 'file', 'file', 'file', 'file', 'group', 'file'])
        placed = [n for n in nodes.values() if n['type'] != 'group']
        for i, a in enumerate(placed):
            for b in placed[i + 1:]:
                self.assertFalse(overlap(a, b), (a['id'], b['id']))
        self.assert_canonical('launch-plan')

    def test_add_with_a_used_id_is_refused(self):
        self.refused('progress', [{'op': 'add', 'node': {'id': 'note-risk', 'text': 'Again.'}}], 'op 1', 'note-risk')
        self.refused('progress', [{'op': 'add', 'node': {'id': 'e-demo', 'text': 'An edge has this id.'}}], 'op 1', 'e-demo')

    def test_add_without_content_is_refused_with_the_rule(self):
        reply = self.refused('progress', [{'op': 'add', 'node': {'type': 'text'}}], 'op 1 (add)', 'text must be a string')
        self.assertTrue(reply.text.startswith('error'))
        self.refused('progress', [{'op': 'add', 'node': {'url': 'javascript:alert(1)'}}], 'op 1', 'url must be an http or https address')
        self.refused('progress', [{'op': 'add', 'node': {'text': 'x', 'color': 'red'}}], 'op 1', 'color must be')
        self.refused('progress', [{'op': 'add', 'node': {'text': 'x', 'x': 0.5, 'y': 0}}], 'op 1', 'x must be a whole number')
        self.refused('progress', [{'op': 'add', 'node': {'id': 'bad id', 'text': 'x'}}], 'op 1', 'id must be')
        self.refused('progress', [{'op': 'add', 'node': {}}], 'op 1', 'type')

    def test_add_edge(self):
        reply = self.edit('progress', [{'op': 'add', 'node': {'id': 'note-new', 'text': 'New.'}, 'near': 'note-risk', 'side': 'below'},
                                       {'op': 'add', 'edge': {'fromNode': 'note-new', 'toNode': 'note-risk', 'label': 'adds to'}}])
        self.assertTrue(reply.ok, reply.text)
        self.assertIn('added=note-new,e-1', reply.text)
        edge = next(e for e in self.doc('progress')['edges'] if e['id'] == 'e-1')
        self.assertEqual((edge['fromNode'], edge['toNode'], edge['label']), ('note-new', 'note-risk', 'adds to'))
        self.refused('progress', [{'op': 'add', 'edge': {'fromNode': 'note-risk', 'toNode': 'ghost'}}], 'op 1', 'ghost is not a node')
        self.refused('progress', [{'op': 'add', 'edge': {'fromNode': 'note-risk', 'toNode': 'e-demo'}}], 'op 1', 'e-demo is not a node')
        self.refused('progress', [{'op': 'add', 'edge': {'fromNode': 'note-risk'}}], 'op 1', 'toNode must be an id')
        self.refused('progress', [{'op': 'add', 'edge': {'fromNode': 'note-risk', 'toNode': 's-shipped', 'fromSide': 'middle'}}], 'op 1', 'fromSide')

    def test_add_needs_one_of_node_or_edge(self):
        self.refused('progress', [{'op': 'add'}], 'op 1', 'node or edge')
        self.refused('progress', [{'op': 'add', 'node': {'text': 'x'}, 'edge': {'fromNode': 'note-risk', 'toNode': 's-shipped'}}], 'op 1', 'node or edge')
        self.refused('progress', [{'op': 'add', 'node': 'text'}], 'op 1')

    # ---- update
    def test_update_changes_only_the_named_keys(self):
        before = self.path('progress').read_text(encoding='utf-8').split('\n')
        reply = self.edit('progress', [{'op': 'update', 'id': 'note-risk', 'node': {'text': 'The gate now stays open.', 'color': None}},
                                       {'op': 'update', 'id': 'e-risk', 'edge': {'label': 'was blocking'}}])
        self.assertRegex(reply.text, r'^ok rev=[0-9a-f]{8} added=- updated=2 removed=0$')
        node = self.node('progress', 'note-risk')
        self.assertEqual(node['text'], 'The gate now stays open.')
        self.assertNotIn('color', node)
        self.assertEqual((node['x'], node['y'], node['width'], node['height']), (-380, 430, 320, 140))
        after = self.path('progress').read_text(encoding='utf-8').split('\n')
        changed = [i for i, (a, b) in enumerate(zip(before, after)) if a != b]
        self.assertEqual(len(before), len(after))
        self.assertEqual(len(changed), 2, 'one line for each changed element')
        self.assert_canonical('progress')

    def test_update_refusals(self):
        self.refused('progress', [{'op': 'update', 'id': 'ghost', 'node': {'text': 'x'}}], 'op 1 (update)', 'ghost')
        self.refused('progress', [{'op': 'update', 'id': 'note-risk', 'node': {'id': 'note-other'}}], 'op 1', 'id does not change')
        self.refused('progress', [{'op': 'update', 'id': 'note-risk', 'node': {'width': 4}}], 'op 1', 'width must be a whole number')
        self.refused('progress', [{'op': 'update', 'id': 'note-risk', 'node': {'text': None}}], 'op 1', 'text must be a string')
        self.refused('progress', [{'op': 'update', 'node': {'text': 'x'}}], 'op 1', 'id')
        self.refused('progress', [{'op': 'update', 'id': 'note-risk'}], 'op 1', 'keys to change')
        self.refused('progress', [{'op': 'update', 'id': 'note-risk', 'edge': {'label': 'x'}}], 'op 1', 'note-risk is a node')
        self.refused('progress', [{'op': 'update', 'id': 'e-risk', 'node': {'text': 'x'}}], 'op 1', 'e-risk is an edge')
        self.refused('progress', [{'op': 'update', 'id': 'e-risk', 'edge': {'toNode': 'ghost'}}], 'op 1', 'ghost is not a node')

    def test_update_with_near_moves_the_node(self):
        reply = self.edit('progress', [{'op': 'update', 'id': 'note-risk', 'near': 's-shipped', 'side': 'left'}])
        self.assertTrue(reply.ok, reply.text)
        moved, anchor = self.node('progress', 'note-risk'), self.node('progress', 's-shipped')
        self.assertLessEqual(moved['x'] + moved['width'], anchor['x'])
        self.assertEqual(moved['text'].split('\n')[0], '**Risk:** the old gate closes at 21:00 in winter.')

    # ---- remove
    def test_remove_node_takes_its_edges(self):
        reply = self.edit('progress', [{'op': 'remove', 'id': 's-in-progress'}])
        self.assertRegex(reply.text, r'^ok rev=[0-9a-f]{8} added=- updated=0 removed=4$')
        doc = self.doc('progress')
        self.assertNotIn('s-in-progress', [n['id'] for n in doc['nodes']])
        self.assertEqual(sorted(e['id'] for e in doc['edges']), ['e-demo', 'e-signups', 'e-start', 'e-survey'])
        self.assert_canonical('progress')

    def test_remove_edge_and_unknown_id(self):
        reply = self.edit('progress', [{'op': 'remove', 'id': 'e-demo'}])
        self.assertIn('removed=1', reply.text)
        self.assertEqual(len(self.doc('progress')['nodes']), 11)
        self.refused('progress', [{'op': 'remove', 'id': 'e-demo'}], 'op 1 (remove)', 'e-demo')
        self.refused('progress', [{'op': 'remove'}], 'op 1', 'id')

    def test_remove_everything_keeps_an_empty_file(self):
        ids = [n['id'] for n in self.doc('launch-plan')['nodes']]
        reply = self.edit('launch-plan', [{'op': 'remove', 'id': i} for i in ids])
        self.assertTrue(reply.ok, reply.text)
        self.assertEqual(self.path('launch-plan').read_text(encoding='utf-8'), '{\n"horsemen":{"version":1},\n"nodes":[],\n"edges":[]\n}\n')

    # ---- all or nothing
    def test_one_bad_op_means_nothing_is_written(self):
        ops = [{'op': 'add', 'node': {'id': 'note-ok', 'text': 'Good.'}},
               {'op': 'update', 'id': 'note-risk', 'node': {'text': 'Changed.'}},
               {'op': 'remove', 'id': 'ghost'}]
        reply = self.refused('progress', ops, 'op 3 (remove)', 'ghost')
        self.assertNotIn('note-ok', self.path('progress').read_text(encoding='utf-8'))
        self.assertEqual(reply.text.count('\n'), 0)

    def test_a_bad_first_op_on_a_new_canvas_makes_no_file(self):
        self.refused('ideas', [{'op': 'add', 'node': {'text': 'x', 'color': '9'}}], 'op 1')
        self.assertFalse(self.path('ideas').exists())
        self.assertEqual(sorted(p.name for p in self.folder.iterdir()), ['launch-plan.canvas', 'progress.canvas'])

    def test_unknown_op_and_wrong_shapes(self):
        self.refused('progress', [{'op': 'move', 'id': 'note-risk'}], 'op 1', 'add, update, or remove')
        self.refused('progress', [{'id': 'note-risk'}], 'op 1', 'add, update, or remove')
        self.refused('progress', ['remove note-risk'], 'op 1')
        self.refused('progress', {'op': 'remove', 'id': 'note-risk'}, 'ops must be a list')
        self.refused('progress', [{'op': 'add', 'node': {'text': 'x'}, 'side': 'under'}], 'op 1', 'side')
        self.refused('progress', [{'op': 'add', 'node': {'text': 'x'}}] * 51, '50 ops')

    # ---- base_rev
    def test_base_rev(self):
        current = canvas.rev(self.path('progress').read_bytes())
        self.refused('progress', [{'op': 'remove', 'id': 'e-demo'}], 'conflict', 'rev=' + current, base_rev='00000000')
        reply = self.edit('progress', [{'op': 'remove', 'id': 'e-demo'}], base_rev=current)
        self.assertTrue(reply.ok, reply.text)
        self.assertIn('rev=' + canvas.rev(self.path('progress').read_bytes()), reply.text)
        self.refused('progress', [{'op': 'remove', 'id': 'e-risk'}], 'conflict', base_rev=current)
        self.refused('progress', [{'op': 'remove', 'id': 'e-risk'}], 'conflict', base_rev='new')
        made = self.edit('ideas', [{'op': 'add', 'node': {'text': 'First idea.'}}], base_rev='new')
        self.assertTrue(made.ok, made.text)
        self.refused('later', [{'op': 'add', 'node': {'text': 'x'}}], 'conflict', base_rev=current)
        self.assertFalse(self.path('later').exists())

    # ---- near
    def test_near_each_side_has_no_overlap(self):
        for side in ('right', 'left', 'below', 'above', None):
            op = {'op': 'add', 'node': {'id': 'n-' + str(side).lower(), 'text': 'Beside the shipped card.'}, 'near': 's-shipped'}
            if side:
                op['side'] = side
            reply = self.edit('progress', [op])
            self.assertTrue(reply.ok, reply.text)
            doc = self.doc('progress')
            added = next(n for n in doc['nodes'] if n['id'] == op['node']['id'])
            anchor = next(n for n in doc['nodes'] if n['id'] == 's-shipped')
            for other in doc['nodes']:
                if other['id'] != added['id'] and other['type'] != 'group':
                    self.assertFalse(overlap(added, other), (side, added, other))
            if side in ('right', None):
                self.assertGreaterEqual(added['x'], anchor['x'] + anchor['width'])
            if side == 'left':
                self.assertLessEqual(added['x'] + added['width'], anchor['x'])
            if side == 'below':
                self.assertGreaterEqual(added['y'], anchor['y'] + anchor['height'])
            if side == 'above':
                self.assertLessEqual(added['y'] + added['height'], anchor['y'])

    def test_near_is_the_same_each_time_and_fills_free_space(self):
        ops = [{'op': 'add', 'node': {'text': f'Note {i}.'}, 'near': 'note-risk'} for i in range(6)]
        first = agent_tools.canvas_edit(self.root, 'progress', ops, dry_run=True)
        second = agent_tools.canvas_edit(self.root, 'progress', ops, dry_run=True)
        self.assertEqual(first.text, second.text)
        self.assertTrue(self.edit('progress', ops).ok)
        notes = [n for n in self.doc('progress')['nodes'] if n['type'] != 'group']
        for i, a in enumerate(notes):
            for b in notes[i + 1:]:
                self.assertFalse(overlap(a, b), (a['id'], b['id']))

    def test_near_stays_beside_the_anchor_when_one_direction_is_taken(self):
        # A card is just below the free place. The closer free place is a little higher, not far below.
        doc = ('{"nodes":[{"id":"anchor","type":"text","x":0,"y":0,"width":320,"height":200,"text":"Anchor."},'
               '{"id":"taken","type":"text","x":380,"y":150,"width":320,"height":140,"text":"In the way."}]}')
        self.path('board').write_text(doc, encoding='utf-8')
        self.assertTrue(self.edit('board', [{'op': 'add', 'node': {'id': 'new', 'text': 'New.'}, 'near': 'anchor'}]).ok)
        new, anchor, taken = self.node('board', 'new'), self.node('board', 'anchor'), self.node('board', 'taken')
        self.assertFalse(overlap(new, taken))
        self.assertEqual(new['x'], anchor['x'] + anchor['width'] + 40)
        self.assertLess(new['y'], anchor['y'] + anchor['height'], 'the note must stay beside the anchor')
        self.assertLess(abs(new['y'] - anchor['y']), 200)
        # Below or above an anchor, the same rule applies from left to right.
        self.assertTrue(self.edit('board', [{'op': 'add', 'node': {'id': 'under', 'text': 'Under.'}, 'near': 'taken', 'side': 'above'}]).ok)
        under = self.node('board', 'under')
        self.assertFalse(any(overlap(under, self.node('board', other)) for other in ('anchor', 'taken', 'new')))

    def test_near_unknown_element_is_refused(self):
        self.refused('progress', [{'op': 'add', 'node': {'text': 'x'}, 'near': 'ghost'}], 'op 1', 'near', 'ghost')
        self.refused('progress', [{'op': 'add', 'node': {'text': 'x'}, 'near': 'e-demo'}], 'op 1', 'near')
        self.refused('progress', [{'op': 'add', 'edge': {'fromNode': 'note-risk', 'toNode': 's-shipped'}, 'near': 's-shipped'}], 'op 1', 'near')

    def test_near_heading_saves_the_section_card_first(self):
        self.assertNotIn('s-gates', self.path('progress').read_text(encoding='utf-8'))
        reply = self.edit('progress', [{'op': 'add', 'node': {'text': 'The insurer answers on Friday.'}, 'near': '#Gates', 'side': 'right'}])
        self.assertTrue(reply.ok, reply.text)
        self.assertIn('added=s-gates,note-1', reply.text)
        card = self.node('progress', 's-gates')
        self.assertEqual((card['type'], card['file'], card['subpath']), ('file', 'PROGRESS.md', '#Gates'))
        note = self.node('progress', 'note-1')
        self.assertGreaterEqual(note['x'], card['x'] + card['width'])
        for other in self.doc('progress')['nodes']:
            if other['id'] not in ('s-gates', 'note-1') and other['type'] != 'group':
                self.assertFalse(overlap(card, other), other['id'])
        self.assert_canonical('progress')

    def test_near_heading_uses_a_saved_card_in_any_letter_case(self):
        reply = self.edit('progress', [{'op': 'add', 'node': {'text': 'Proof.'}, 'near': '#shipped'}])
        self.assertIn('added=note-1 ', reply.text + ' ')
        self.assertEqual(sum(n.get('subpath', '').lower() == '#shipped' for n in self.doc('progress')['nodes']), 1)

    def test_heading_refusals(self):
        self.refused('progress', [{'op': 'add', 'node': {'text': 'x'}, 'near': '#Renamed heading'}], 'op 1', 'heading #Renamed heading')
        self.refused('launch-plan', [{'op': 'add', 'node': {'text': 'x'}, 'near': '#Shipped'}], 'op 1', 'record')

    def test_edge_end_can_name_a_heading(self):
        reply = self.edit('progress', [{'op': 'add', 'edge': {'fromNode': 'note-risk', 'toNode': '#Up next', 'label': 'delays'}}])
        self.assertTrue(reply.ok, reply.text)
        self.assertIn('added=s-up-next,e-1', reply.text)
        edge = next(e for e in self.doc('progress')['edges'] if e['id'] == 'e-1')
        self.assertEqual(edge['toNode'], 's-up-next')

    def test_first_edit_of_a_record_canvas_without_a_file(self):
        (self.root / 'README.md').write_text('# Lantern Walks\n\n## What it is\n\nWalks.\n\n## Get started\n\nBook.\n', encoding='utf-8')
        reply = self.edit('readme', [{'op': 'add', 'node': {'text': 'Add a photo here.'}, 'near': '#Get started'}])
        self.assertTrue(reply.ok, reply.text)
        self.assertIn('added=s-get-started,note-1', reply.text)
        self.assertEqual(len(self.doc('readme')['nodes']), 2)
        self.assert_canonical('readme')

    # ---- the written file
    def test_unknown_keys_and_types_are_kept(self):
        self.path('board').write_bytes((FIXTURES / 'files/unknown-keys.canvas').read_bytes())
        reply = self.edit('board', [{'op': 'update', 'id': 'note-1', 'node': {'text': 'Changed.'}}])
        self.assertTrue(reply.ok, reply.text)
        want = (FIXTURES / 'expected/unknown-keys.canvas').read_text(encoding='utf-8').replace('"text":"Kept."', '"text":"Changed."')
        self.assertEqual(self.path('board').read_text(encoding='utf-8'), want)

    def test_no_ops_writes_the_canonical_text(self):
        self.path('board').write_bytes((FIXTURES / 'files/pretty.canvas').read_bytes())
        reply = self.edit('board', [])
        self.assertTrue(reply.ok, reply.text)
        self.assertEqual(self.path('board').read_bytes(), (FIXTURES / 'expected/pretty.canvas').read_bytes())
        self.refused('nothing-here', [], 'no canvas file')

    def test_no_temporary_file_is_left(self):
        self.edit('progress', [{'op': 'add', 'node': {'text': 'x'}}])
        self.refused('progress', [{'op': 'remove', 'id': 'ghost'}])
        self.assertEqual(sorted(p.name for p in self.folder.iterdir()), ['launch-plan.canvas', 'progress.canvas'])

    def test_dry_run_writes_nothing(self):
        before = self.path('progress').read_bytes()
        reply = self.edit('progress', [{'op': 'add', 'node': {'text': 'Maybe.'}}], dry_run=True)
        self.assertTrue(reply.ok, reply.text)
        self.assertIn('dry run', reply.text)
        self.assertIn('added=note-1', reply.text)
        self.assertEqual(before, self.path('progress').read_bytes())
        made = self.edit('ideas', [{'op': 'add', 'node': {'text': 'Maybe.'}}], dry_run=True)
        self.assertTrue(made.ok, made.text)
        self.assertFalse(self.path('ideas').exists())

    # ---- limits
    def test_reply_stays_short(self):
        ops = [{'op': 'add', 'node': {'id': 'a-very-long-identifier-for-a-note-on-this-canvas-number-' + str(i).zfill(4), 'text': 'x'}} for i in range(50)]
        reply = self.edit('progress', ops)
        self.assertTrue(reply.ok, reply.text)
        self.assertLessEqual(len(reply.text), REPLY_LIMIT)
        self.assertIn('+', reply.text)
        long_text = self.refused('progress', [{'op': 'add', 'node': {'id': 'x' * 5000, 'text': 'x'}}], 'op 1')
        self.assertLessEqual(len(long_text.text), REPLY_LIMIT)

    def test_node_limit(self):
        nodes = ','.join('{"id":"n%d","type":"text","x":%d,"y":0,"width":16,"height":16,"text":"x"}' % (i, i * 40) for i in range(500))
        self.path('full').write_text('{"nodes":[' + nodes + ']}', encoding='utf-8')
        self.refused('full', [{'op': 'add', 'node': {'text': 'One too many.'}}], 'more than 500 nodes')

    def test_canvas_file_limit(self):
        for i in range(18):
            self.path(f'board-{i}').write_text('{}', encoding='utf-8')
        self.refused('one-more', [{'op': 'add', 'node': {'text': 'x'}}], '20 canvas files')
        self.assertTrue(self.edit('board-3', [{'op': 'add', 'node': {'text': 'An old board still takes edits.'}}]).ok)

    # ---- files
    def test_file_nodes_are_checked(self):
        self.refused('progress', [{'op': 'add', 'node': {'file': '.horsemen/media/not-there.png'}}], 'op 1', 'does not exist')
        self.refused('progress', [{'op': 'add', 'node': {'file': '../outside.md'}}], 'op 1', 'file must be a path inside the project')
        self.refused('progress', [{'op': 'add', 'node': {'file': 'PROGRESS.md', 'subpath': '#Renamed heading'}}], 'op 1', 'heading #Renamed heading')
        self.refused('progress', [{'op': 'update', 'id': 's-shipped', 'node': {'subpath': '#Gone'}}], 'op 1', 'heading #Gone')
        (self.root / '.horsemen/media/big.png').write_bytes(b'\x89PNG\r\n\x1a\n' + b'0' * (1024 * 1024))
        self.refused('progress', [{'op': 'add', 'node': {'file': '.horsemen/media/big.png'}}], 'op 1', 'larger than 1 MiB')
        (self.root / '.horsemen/media/fake.png').write_text('<script>alert(1)</script>', encoding='utf-8')
        self.refused('progress', [{'op': 'add', 'node': {'file': '.horsemen/media/fake.png'}}], 'op 1', 'is not a PNG')
        (self.root / '.horsemen/media/notes.txt').write_text('notes', encoding='utf-8')
        self.refused('progress', [{'op': 'add', 'node': {'file': '.horsemen/media/notes.txt'}}], 'op 1', 'not a supported media type')
        (self.root / '.horsemen/media/photo.png').write_bytes(b'\x89PNG\r\n\x1a\n' + b'0' * 64)
        self.assertTrue(self.edit('progress', [{'op': 'add', 'node': {'file': '.horsemen/media/photo.png', 'alt': 'A lantern'}}]).ok)

    def test_an_old_broken_card_is_a_warning_not_a_block(self):
        progress = self.root / 'PROGRESS.md'
        progress.write_text(progress.read_text(encoding='utf-8').replace('## Shipped', '## Delivered'), encoding='utf-8')
        reply = self.edit('progress', [{'op': 'add', 'node': {'text': 'Unrelated note.'}}])
        self.assertTrue(reply.ok, reply.text)
        self.assertIn('warning', reply.text)
        self.assertIn('s-shipped', reply.text)
        repaired = self.edit('progress', [{'op': 'update', 'id': 's-shipped', 'node': {'subpath': '#Delivered'}}])
        self.assertTrue(repaired.ok, repaired.text)
        self.assertNotIn('warning', repaired.text)

    def test_at_most_five_warnings(self):
        cards = ','.join('{"id":"c%d","type":"file","x":%d,"y":0,"width":320,"height":100,"file":"PROGRESS.md","subpath":"#Gone %d"}' % (i, i * 400, i) for i in range(9))
        self.path('board').write_text('{"nodes":[' + cards + ']}', encoding='utf-8')
        reply = self.edit('board', [{'op': 'add', 'node': {'text': 'x'}}])
        self.assertTrue(reply.ok, reply.text)
        self.assertLessEqual(reply.text.count('warning:'), 5)
        self.assertIn('9 warnings', reply.text)

    # ---- the file on disk
    def test_a_broken_file_is_not_changed(self):
        self.path('board').write_bytes((FIXTURES / 'files/conflict-markers.canvas').read_bytes())
        self.refused('board', [{'op': 'add', 'node': {'text': 'x'}}], 'conflict markers')
        self.refused('board', [], 'conflict markers')
        self.path('newer').write_bytes((FIXTURES / 'files/version-2.canvas').read_bytes())
        self.refused('newer', [{'op': 'add', 'node': {'text': 'x'}}], 'version 2')

    def test_canvas_names(self):
        for name in ('../progress', 'Progress', 'a' * 65, '', 'pro gress', 'progress.canvas', '-x', 'a/b', '.', 5, None):
            reply = agent_tools.canvas_edit(self.root, name, [{'op': 'add', 'node': {'text': 'x'}}])
            self.assertFalse(reply.ok, name)
            self.assertIn('canvas name', reply.text)
        self.assertEqual(sorted(p.name for p in self.folder.iterdir()), ['launch-plan.canvas', 'progress.canvas'])
        self.assertFalse((self.root / '.horsemen/progress.canvas').exists())

    def test_a_canvas_folder_that_leaves_the_project_is_refused(self):
        outside = Path(self.temp.name).resolve() / 'outside'
        outside.mkdir()
        shutil.rmtree(self.root / '.horsemen')
        (self.root / '.horsemen').symlink_to(outside)
        reply = agent_tools.canvas_edit(self.root, 'ideas', [{'op': 'add', 'node': {'text': 'x'}}])
        self.assertFalse(reply.ok, reply.text)
        self.assertEqual(list(outside.iterdir()), [])

    def test_a_project_without_a_horsemen_folder_gets_one(self):
        shutil.rmtree(self.root / '.horsemen')
        reply = self.edit('ideas', [{'op': 'add', 'node': {'text': 'First.'}}])
        self.assertTrue(reply.ok, reply.text)
        self.assert_canonical('ideas')


if __name__ == '__main__':
    unittest.main()
