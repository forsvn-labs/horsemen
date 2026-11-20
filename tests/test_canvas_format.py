"""Canvas format: the shared fixture cases, run by the Python reader.

Failure modes covered (each is a case in tests/fixtures/canvas/cases.json):
- not a canvas: too large, not UTF-8, not JSON, conflict markers, deep nesting,
  numbers that do not fit, half surrogate pairs, a top level that is not an object
- schema rules: ids, types, positions, sizes, colours, paths, addresses, lengths,
  edge ends, sides, and end marks; limits of 500 nodes and 1,000 edges
- rules a schema cannot state: unique ids, edge ends that name a node, files that
  exist, headings that exist, media type and size
- hostile input: script text, javascript: addresses, CSS in a colour, 5,000 nodes,
  a 2 MiB file, paths with "..", keys such as __proto__
- canonical text: order, key order, number text, escapes, a second write is the same
- the two languages must agree, so a JSON Schema validator can run the same cases
  (HORSEMEN_SCHEMA_CHECK=1; needs check-jsonschema or uvx)
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'horsemen/scripts'))
from horsemen_core import canvas  # noqa: E402

FIXTURES = ROOT / 'tests/fixtures/canvas'
DESIGN = ROOT / 'docs/show-me/canvas-workspace/fixture'
MANIFEST = json.loads((FIXTURES / 'cases.json').read_text(encoding='utf-8'))


def build(spec):
    """The input bytes of a case. README.md in the fixture folder defines the parts."""
    if 'file' in spec:
        return (FIXTURES / spec['file']).read_bytes()
    out = []
    for part in spec['build']:
        if 'text' in part:
            out.append(part['text'].encode('utf-8'))
        elif 'hex' in part:
            out.append(bytes.fromhex(part['hex']))
        else:
            items = (part['repeat'].replace('{i}', str(i)) for i in range(part['count']))
            out.append(part.get('join', '').join(items).encode('utf-8'))
    return b''.join(out)


def lookup_for(case):
    if 'workspace' not in case:
        return None
    real = canvas.disk_lookup(FIXTURES / case['workspace'])
    virtual = case.get('virtual', {})

    def lookup(path):
        if path in virtual:
            return {'size': virtual[path]['size'], 'text': None}
        return real(path)
    return lookup


def expected_text(expect, data):
    text = expect.get('text')
    if isinstance(text, dict):
        return (FIXTURES / text['file']).read_text(encoding='utf-8')
    if text is None and expect.get('canonical'):
        return data.decode('utf-8')
    return text


class SharedCases(unittest.TestCase):
    def test_each_case(self):
        self.assertGreaterEqual(len(MANIFEST['cases']), 70)
        for case in MANIFEST['cases']:
            with self.subTest(case=case['name']):
                data = build(case['input'])
                result = canvas.check_bytes(data, lookup_for(case))
                expect = case['expect']
                self.assertEqual(result.errors, expect['errors'])
                if expect['errors']:
                    continue
                self.assertEqual(result.canonical, expect['canonical'])
                self.assertEqual(result.read_only, expect.get('read_only', False))
                want = expected_text(expect, data)
                if want is not None:
                    self.assertEqual(result.text, want)
                self.assertEqual(result.canonical, result.text.encode('utf-8') == data)
                again = canvas.check_bytes(result.text.encode('utf-8'), lookup_for(case))
                self.assertEqual(again.errors, [])
                self.assertTrue(again.canonical, 'a second write must give the same text')
                self.assertEqual(again.text, result.text)

    def test_case_names_are_unique_and_each_has_a_note(self):
        names = [case['name'] for case in MANIFEST['cases']]
        self.assertEqual(len(names), len(set(names)))
        self.assertTrue(all(case.get('note') for case in MANIFEST['cases']))

    def test_required_hostile_cases_exist(self):
        names = {case['name'] for case in MANIFEST['cases']}
        for name in ('valid-script-text', 'schema-script-url', 'hostile-urls', 'schema-bad-colour', 'hostile-colours',
                     'hostile-5000-nodes', 'hostile-2-mib', 'schema-path-escape', 'hostile-paths'):
            self.assertIn(name, names)

    def test_every_error_code_is_a_check_code(self):
        codes = {error['code'] for case in MANIFEST['cases'] for error in case['expect']['errors']}
        self.assertEqual(codes, {'canvas-invalid', 'canvas-dangling-ref', 'canvas-media-too-large'})

    def test_one_element_on_each_line(self):
        for case in MANIFEST['cases']:
            if case['expect']['errors']:
                continue
            result = canvas.check_bytes(build(case['input']), lookup_for(case))
            elements = len(result.doc.get('nodes', [])) + len(result.doc.get('edges', []))
            lines = result.text.split('\n')
            self.assertEqual(sum(line.startswith('{"id":') for line in lines), elements, case['name'])
            self.assertTrue(result.text.endswith('\n}\n'))
            self.assertNotIn('\r', result.text)

    def test_copies_of_the_design_fixture_have_not_changed(self):
        for name in ('PROGRESS.md', '.horsemen/canvas/progress.canvas', '.horsemen/canvas/launch-plan.canvas',
                     '.horsemen/media/pilot-signups.csv', '.horsemen/media/route-map.svg'):
            self.assertEqual((FIXTURES / 'workspace' / name).read_bytes(), (DESIGN / name).read_bytes(), name)
        copied = sorted(p.name for p in (DESIGN / 'invalid').glob('*.json'))
        self.assertEqual(len(copied), 11)
        for name in copied:
            self.assertEqual((FIXTURES / 'files' / name).read_bytes(), (DESIGN / 'invalid' / name).read_bytes(), name)


class Headings(unittest.TestCase):
    def test_slugs(self):
        for case in MANIFEST['slugs']:
            self.assertEqual(canvas.slug(case['heading']), case['slug'], case['heading'])

    def test_generated_section_cards(self):
        for case in MANIFEST['sections']:
            found = [{'title': title, 'id': card} for title, card in canvas.section_cards(case['markdown'])]
            self.assertEqual(found, case['sections'], case['note'])

    def test_subpaths(self):
        for case in MANIFEST['headings']:
            self.assertEqual(canvas.has_heading(case['markdown'], case['subpath']), case['found'],
                             (case['markdown'], case['subpath']))

    def test_section_ids_fit_the_id_rule(self):
        cards = canvas.section_cards(''.join(f'## {"x" * 80} {i}\n' for i in range(30)) + '## é\n' * 12)
        ids = [card for _, card in cards]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(all(canvas.ID.fullmatch(card) for card in ids), ids)


class Lookup(unittest.TestCase):
    """The disk lookup is the boundary between a canvas file and the project files."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve() / 'project'
        (self.root / 'docs').mkdir(parents=True)
        (self.root / 'PROGRESS.md').write_text('# Progress\n\n## Shipped\n', encoding='utf-8')
        self.outside = Path(self.temp.name).resolve() / 'secret.md'
        self.outside.write_text('## Private\n', encoding='utf-8')

    def test_regular_file_inside_the_project(self):
        found = canvas.disk_lookup(self.root)('PROGRESS.md')
        self.assertEqual(found['size'], len('# Progress\n\n## Shipped\n'))
        self.assertIn('## Shipped', found['text'])

    def test_folder_missing_file_and_bad_paths_do_not_exist(self):
        lookup = canvas.disk_lookup(self.root)
        for path in ('docs', 'nothing.md', '../secret.md', '/etc/hosts', 'docs/../../secret.md', ''):
            self.assertIsNone(lookup(path), path)

    def test_link_that_leaves_the_project_does_not_exist(self):
        (self.root / 'escape.md').symlink_to(self.outside)
        (self.root / 'linked').symlink_to(self.outside.parent)
        lookup = canvas.disk_lookup(self.root)
        self.assertIsNone(lookup('escape.md'))
        self.assertIsNone(lookup('linked/secret.md'))
        text = '{"nodes":[{"id":"a","type":"file","x":0,"y":0,"width":320,"height":160,"file":"escape.md","subpath":"#Private"}]}'
        result = canvas.check_bytes(text.encode(), lookup)
        self.assertEqual(result.errors, [{'code': 'canvas-dangling-ref', 'message': 'node a: file escape.md does not exist'}])

    def test_markdown_that_is_not_utf8_has_no_headings(self):
        (self.root / 'bad.md').write_bytes(b'## \xff\xfe\n## Good\n')
        found = canvas.disk_lookup(self.root)('bad.md')
        self.assertTrue(canvas.has_heading(found['text'], '#Good'))


class NumberText(unittest.TestCase):
    def test_javascript_number_text(self):
        for value, text in ((0, '0'), (-0.0, '0'), (1.0, '1'), (1.5, '1.5'), (-2.5, '-2.5'), (1e21, '1e+21'), (1e20, '100000000000000000000'),
                            (1e-6, '0.000001'), (1e-7, '1e-7'), (1.5e-7, '1.5e-7'), (123456789012345680000.0, '123456789012345680000'),
                            (2 ** 53 + 1, '9007199254740992'), (-(2 ** 53) - 1, '-9007199254740992'), (2 ** 53, '9007199254740992'),
                            (5e-324, '5e-324'), (1.7976931348623157e308, '1.7976931348623157e+308'), (0.1, '0.1'), (1234.5678, '1234.5678'),
                            (-1e-7, '-1e-7'), (4.35, '4.35'), (10 ** 22, '1e+22'), (123e30, '1.23e+32')):
            self.assertEqual(canvas.number_text(value), text, value)


@unittest.skipUnless(os.environ.get('HORSEMEN_SCHEMA_CHECK') == '1', 'set HORSEMEN_SCHEMA_CHECK=1 to run a JSON Schema validator')
class SchemaAgrees(unittest.TestCase):
    def test_schema_accepts_and_refuses_the_same_cases(self):
        tool = shutil.which('check-jsonschema')
        command = [tool] if tool else ['uvx', 'check-jsonschema']
        if not tool and not shutil.which('uvx'):
            self.fail('needs check-jsonschema or uvx on PATH')
        schema = ROOT / 'docs/product/canvas.schema.json'
        marked = [case for case in MANIFEST['cases'] if 'schema' in case]
        self.assertGreaterEqual(len(marked), 55)
        with tempfile.TemporaryDirectory() as temporary:
            paths = {}
            for case in marked:
                path = Path(temporary) / (case['name'] + '.json')
                path.write_bytes(build(case['input']))
                paths[case['name']] = path
            valid = [str(paths[case['name']]) for case in marked if case['schema']]
            done = subprocess.run([*command, '--schemafile', str(schema), *valid], capture_output=True, text=True)
            self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
            for case in marked:
                if case['schema']:
                    continue
                done = subprocess.run([*command, '--schemafile', str(schema), str(paths[case['name']])], capture_output=True, text=True)
                self.assertNotEqual(done.returncode, 0, 'the schema accepted ' + case['name'])
                # A case that the schema refuses must also fail the reader with a format error.
                result = canvas.check_bytes(build(case['input']))
                self.assertTrue(any(error['code'] == 'canvas-invalid' for error in result.errors), case['name'])


if __name__ == '__main__':
    unittest.main()
