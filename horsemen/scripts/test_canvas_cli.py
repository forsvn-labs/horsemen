"""Subprocess tests for the canvas commands: source CLI, or HORSEMEN_CLI from a built wheel.

Failure modes covered:
- `show`: a target that does not exist, a budget option out of range, output that differs from the `read` tool
- `canvas apply`: bad ops input, a refused edit that still writes, a dry run that writes, a stale `--base-rev`
- `mcp`: the installed command does not start the server
- `mcp install`: a host command that is not on PATH, a host that fails, a host file edited directly,
  a server command that points at a missing script
- `mcp status`: a host without the server reported as ready
- the legacy script (`horsemen.py`) must reach the same commands, and its old commands must not change
"""
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from e2e import Env, healthy_project

SCRIPTS = Path(__file__).resolve().parent
INSTALLED = os.environ.get('HORSEMEN_CLI')
CANVAS = ('{\n"horsemen":{"version":1},\n"nodes":[\n'
          '{"id":"note-plan","type":"text","x":0,"y":0,"width":320,"height":140,"text":"Ask two testers about export."},\n'
          '{"id":"s-up-next","type":"file","x":400,"y":0,"width":320,"height":200,"file":"PROGRESS.md","subpath":"#Up next"}\n'
          '],\n"edges":[\n{"id":"e-plan","fromNode":"note-plan","toNode":"s-up-next","label":"feeds"}\n]\n}\n')
FAKE_HOST = '''#!/bin/sh
printf '%s\\n' "$0 $*" >> "$HOST_LOG"
if [ "$1 $2" = "mcp get" ]; then [ -f "$HOST_STATE/$(basename "$0")" ] && { echo "horsemen: registered"; exit 0; }; echo "No MCP server named horsemen"; exit 1; fi
if [ "$1 $2" = "mcp add" ]; then [ -n "$HOST_FAIL" ] && { echo "host refused" >&2; exit 3; }; : > "$HOST_STATE/$(basename "$0")"; echo "added"; exit 0; fi
exit 0
'''


class CanvasCLI(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name).resolve()
        self.env = Env(self.base)
        self.root = healthy_project(self.env, self.base / 'tiny notes')
        self.folder = self.root / '.horsemen/canvas'
        self.folder.mkdir(parents=True)
        self.canvas = self.folder / 'progress.canvas'
        self.canvas.write_text(CANVAS, encoding='utf-8')

    def run_cli(self, *args, cwd=None, stdin=None, env=None):
        command = [INSTALLED] if INSTALLED else [sys.executable, '-B', '-m', 'horsemen_core']
        environment = dict(self.env.env, PYTHONPATH=str(SCRIPTS), PYTHONDONTWRITEBYTECODE='1', **(env or {}))
        if INSTALLED:
            environment.pop('PYTHONPATH', None)
        return subprocess.run(command + list(args), cwd=cwd or self.root, env=environment, text=True, capture_output=True, input=stdin, timeout=60)

    def ops_file(self, ops):
        path = self.base / 'ops.json'
        path.write_text(json.dumps(ops), encoding='utf-8')
        return str(path)

    # ---- show
    def test_show_index_outline_section_and_element(self):
        p = self.run_cli('show')
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn('workspace tiny notes', p.stdout)
        self.assertIn('canvases: progress 2 nodes 1 edges', p.stdout)
        self.assertIn('next: Hung finishes the editor.', p.stdout)
        self.assertLessEqual(len(p.stdout.rstrip('\n')), 800)
        p = self.run_cli('show', 'progress.canvas')
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn('note-plan note "Ask two testers about export." @0,0 320x140', p.stdout)
        self.assertIn('s-up-next section PROGRESS.md#Up next @400,0 320x200', p.stdout)
        p = self.run_cli('show', 'progress#Up next')
        self.assertIn('**Export to PDF**', p.stdout)
        p = self.run_cli('show', 'progress.canvas#note-plan', '--max-chars', '200')
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertLessEqual(len(p.stdout.rstrip('\n')), 200)
        p = self.run_cli('show', 'progress', '--path', str(self.root), cwd=self.base)
        self.assertIn('## Up next', p.stdout)

    def test_show_from_a_subfolder_and_if_rev(self):
        p = self.run_cli('show', 'progress.canvas', cwd=self.root / 'src/app')
        self.assertEqual(p.returncode, 0, p.stderr)
        rev = p.stdout.split('rev=')[1].split()[0]
        p = self.run_cli('show', 'progress.canvas', '--if-rev', rev)
        self.assertEqual(p.stdout.strip(), 'unchanged rev=' + rev)

    def test_show_errors_exit_2_and_print_nothing_on_stdout(self):
        for args in (('../secret',), ('no-board.canvas',), ('progress#No such heading',), ('progress', '--max-chars', '9000'), ('progress', '--offset', '-1')):
            p = self.run_cli('show', *args)
            self.assertEqual(p.returncode, 2, args)
            self.assertEqual(p.stdout, '')
            self.assertTrue(p.stderr.strip())
        empty = self.base / 'empty'
        empty.mkdir()
        p = self.run_cli('show', cwd=empty)
        self.assertEqual(p.returncode, 2)
        self.assertIn('no Horsemen records', p.stderr)

    # ---- canvas apply
    def test_apply_ops_from_a_file_and_from_stdin(self):
        ops = [{'op': 'add', 'node': {'text': 'Two testers said yes.'}, 'near': 'note-plan', 'side': 'below'}]
        p = self.run_cli('canvas', 'apply', 'progress', '--ops', self.ops_file(ops))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertRegex(p.stdout.strip(), r'^ok rev=[0-9a-f]{8} added=note-1 updated=0 removed=0$')
        self.assertIn('"id":"note-1"', self.canvas.read_text(encoding='utf-8'))
        p = self.run_cli('canvas', 'apply', 'progress', '--ops', '-', stdin=json.dumps({'ops': [{'op': 'remove', 'id': 'note-1'}]}))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(self.canvas.read_text(encoding='utf-8'), CANVAS)

    def test_apply_refused_edit_exits_1_and_writes_nothing(self):
        p = self.run_cli('canvas', 'apply', 'progress', '--ops', self.ops_file([{'op': 'add', 'node': {'text': 'x'}}, {'op': 'remove', 'id': 'ghost'}]))
        self.assertEqual(p.returncode, 1)
        self.assertIn('op 2 (remove)', p.stderr)
        self.assertEqual(self.canvas.read_text(encoding='utf-8'), CANVAS)
        p = self.run_cli('canvas', 'apply', 'progress', '--ops', self.ops_file([{'op': 'remove', 'id': 'e-plan'}]), '--base-rev', '00000000')
        self.assertEqual(p.returncode, 1)
        self.assertIn('conflict', p.stderr)
        self.assertEqual(self.canvas.read_text(encoding='utf-8'), CANVAS)

    def test_apply_bad_input_exits_2(self):
        bad = self.base / 'bad.json'
        bad.write_text('{not json', encoding='utf-8')
        for args in (('progress', '--ops', str(bad)), ('progress', '--ops', str(self.base / 'missing.json')), ('../progress',), ()):
            p = self.run_cli('canvas', 'apply', *args)
            self.assertEqual(p.returncode, 2, args)
        p = self.run_cli('canvas', 'apply', 'progress', '--ops', self.ops_file('remove everything'))
        self.assertEqual(p.returncode, 2)
        self.assertEqual(self.canvas.read_text(encoding='utf-8'), CANVAS)

    def test_apply_dry_run_and_no_ops(self):
        p = self.run_cli('canvas', 'apply', 'progress', '--ops', self.ops_file([{'op': 'remove', 'id': 'e-plan'}]), '--dry-run')
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn('dry run', p.stdout)
        self.assertEqual(self.canvas.read_text(encoding='utf-8'), CANVAS)
        self.canvas.write_text(json.dumps(json.loads(CANVAS), indent=2), encoding='utf-8')
        p = self.run_cli('canvas', 'apply', 'progress')
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(self.canvas.read_text(encoding='utf-8'), CANVAS)

    def test_check_reports_canvas_rules(self):
        self.canvas.write_text(json.dumps(json.loads(CANVAS), indent=2), encoding='utf-8')
        p = self.run_cli('check', str(self.root), '--json')
        self.assertEqual(p.returncode, 0, p.stdout)
        report = json.loads(p.stdout)['report']
        self.assertEqual([w['code'] for w in report['warnings']], ['canvas-not-canonical'])
        self.canvas.write_text(CANVAS.replace('#Up next', '#Renamed'), encoding='utf-8')
        p = self.run_cli('check', str(self.root), '--json')
        self.assertEqual(p.returncode, 1)
        self.assertEqual([e['code'] for e in json.loads(p.stdout)['report']['errors']], ['canvas-dangling-ref'])

    def test_help_lists_the_new_commands(self):
        text = self.run_cli('--help').stdout
        for word in ('show', 'canvas', 'mcp'):
            self.assertIn(word, text)
        self.assertIn('--ops', self.run_cli('canvas', 'apply', '--help').stdout)
        self.assertIn('install', self.run_cli('mcp', '--help').stdout)

    # ---- mcp
    def serve(self, command, cwd=None):
        requests = [{'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2025-06-18', 'capabilities': {}}},
                    {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'},
                    {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call', 'params': {'name': 'read', 'arguments': {'target': 'progress.canvas'}}}]
        env = dict(self.env.env, PYTHONDONTWRITEBYTECODE='1')
        p = subprocess.run(command, cwd=cwd or self.root, env=env, text=True, capture_output=True,
                           input=''.join(json.dumps(r) + '\n' for r in requests), timeout=60)
        self.assertEqual(p.returncode, 0, p.stderr)
        return [json.loads(line) for line in p.stdout.splitlines()]

    def test_mcp_serves_over_stdio(self):
        command = [INSTALLED, 'mcp'] if INSTALLED else [sys.executable, '-B', str(SCRIPTS / 'horsemen.py'), 'mcp']
        replies = self.serve(command)
        self.assertEqual([r['id'] for r in replies], [1, 2, 3])
        self.assertEqual([t['name'] for t in replies[1]['result']['tools']], ['read', 'canvas_edit'])
        self.assertIn('note-plan note', replies[2]['result']['content'][0]['text'])

    def hosts(self, *names):
        bin_dir, state = self.base / 'bin', self.base / 'host-state'
        bin_dir.mkdir(exist_ok=True)
        state.mkdir(exist_ok=True)
        for name in names:
            path = bin_dir / name
            path.write_text(FAKE_HOST)
            path.chmod(path.stat().st_mode | stat.S_IXUSR)
        home = self.base / 'home'
        home.mkdir(exist_ok=True)
        # Only the fake hosts and the system tools are on PATH; the real hosts are never called.
        return {'PATH': f'{bin_dir}:/usr/bin:/bin', 'HOST_LOG': str(self.base / 'host.log'), 'HOST_STATE': str(state), 'HOME': str(home)}

    def log(self):
        path = self.base / 'host.log'
        return path.read_text().splitlines() if path.exists() else []

    def test_mcp_install_uses_the_host_commands(self):
        env = self.hosts('claude', 'codex')
        script = SCRIPTS / 'horsemen.py'
        p = self.run_cli('mcp', 'install', '--script-path', str(script), env=env)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        calls = self.log()
        claude = next(line for line in calls if '/claude mcp add' in line)
        codex = next(line for line in calls if '/codex mcp add' in line)
        self.assertRegex(claude, r'/claude mcp add --scope user horsemen -- \S+ ' + re.escape(str(script)) + ' mcp$')
        self.assertRegex(codex, r'/codex mcp add horsemen -- \S+ ' + re.escape(str(script)) + ' mcp$')
        self.assertEqual(list((self.base / 'home').iterdir()), [], 'install must not write host files itself')
        python = claude.split(' -- ')[1].split(' ')[0]
        self.assertTrue(os.path.isabs(python))
        replies = self.serve([python, '-B', str(script), 'mcp'])
        self.assertEqual(replies[0]['result']['serverInfo']['name'], 'horsemen')
        p = self.run_cli('mcp', 'status', env=env)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn('claude: registered', p.stdout)
        self.assertIn('codex: registered', p.stdout)

    def test_mcp_install_options(self):
        env = self.hosts('claude', 'codex')
        script = SCRIPTS / 'horsemen.py'
        p = self.run_cli('mcp', 'install', '--host', 'claude', '--scope', 'project', '--script-path', str(script), env=env)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(len([line for line in self.log() if ' mcp add ' in line]), 1)
        self.assertIn('--scope project', self.log()[-1])
        before = len(self.log())
        p = self.run_cli('mcp', 'install', '--dry-run', '--script-path', str(script), env=env)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn('claude mcp add --scope user horsemen --', p.stdout)
        self.assertIn('codex mcp add horsemen --', p.stdout)
        self.assertEqual(len(self.log()), before, 'a dry run calls no host')

    def test_mcp_install_failures(self):
        env = self.hosts()
        p = self.run_cli('mcp', 'install', '--script-path', str(SCRIPTS / 'horsemen.py'), env=env)
        self.assertEqual(p.returncode, 1)
        self.assertIn('claude: not found on PATH', p.stdout + p.stderr)
        self.assertIn('codex: not found on PATH', p.stdout + p.stderr)
        env = self.hosts('claude')
        p = self.run_cli('mcp', 'install', '--script-path', str(self.base / 'missing/horsemen.py'), env=env)
        self.assertEqual(p.returncode, 2)
        self.assertEqual(self.log(), [])
        p = self.run_cli('mcp', 'install', '--host', 'claude', '--script-path', str(SCRIPTS / 'horsemen.py'), env=dict(env, HOST_FAIL='1'))
        self.assertEqual(p.returncode, 1)
        self.assertIn('claude: failed', p.stdout + p.stderr)

    def test_mcp_status_without_the_server(self):
        env = self.hosts('claude')
        p = self.run_cli('mcp', 'status', env=env)
        self.assertEqual(p.returncode, 1)
        self.assertIn('claude: not registered', p.stdout)
        self.assertIn('codex: not found on PATH', p.stdout)
        self.assertFalse(any(' mcp add ' in line for line in self.log()))

    # ---- legacy script
    @unittest.skipIf(INSTALLED, 'the legacy script is part of the skill, not the wheel')
    def test_legacy_script_reaches_the_same_commands(self):
        def legacy(*args, stdin=None):
            return subprocess.run([sys.executable, '-B', str(SCRIPTS / 'horsemen.py'), *args], cwd=self.root, env=self.env.env,
                                  text=True, capture_output=True, input=stdin, timeout=60)
        p = legacy('show', 'progress.canvas')
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout, self.run_cli('show', 'progress.canvas').stdout)
        p = legacy('canvas', 'apply', 'progress', '--ops', '-', stdin=json.dumps([{'op': 'remove', 'id': 'e-plan'}]))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertNotIn('e-plan', self.canvas.read_text(encoding='utf-8'))
        p = legacy('mcp', 'install', '--dry-run', '--script-path', str(SCRIPTS / 'horsemen.py'))
        self.assertIn('mcp add', p.stdout)
        # Old commands keep their results.
        p = legacy('nonsense')
        self.assertEqual(p.returncode, 2)
        self.assertIn('horsemen.py check', p.stdout)
        p = legacy('check', str(self.root), '--json')
        self.assertEqual(json.loads(p.stdout)['errors'], [])


if __name__ == '__main__':
    unittest.main()
