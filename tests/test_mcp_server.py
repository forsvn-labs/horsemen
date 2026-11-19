"""The stdio MCP server, driven through a subprocess as a host does. All data is fictional.

Failure modes covered:
- start: no handshake reply, a wrong protocol version, output that is not one JSON object on each line
- list: more or fewer than the two tools, definitions over the 1,200 character budget
- call: an unknown tool, missing or wrong arguments, a tool error reported as a protocol error
- bad input: bad JSON, a list, a request without a method, an unknown method, an unknown
  notification, a very long line, blank lines; the server must answer and keep running
- output limits: any `read` reply over 8,000 characters, an index over 800, a `canvas_edit` reply over 400
- the server writes outside the project, or reads a file that the target does not name
- end of input: the server must exit with code 0
- both entry points start the same server: `python3 -m horsemen_core mcp` and `horsemen.py mcp`
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
SCRIPTS = ROOT / 'horsemen/scripts'
sys.path.insert(0, str(SCRIPTS))
from horsemen_core import mcp  # noqa: E402

FIXTURES = ROOT / 'tests/fixtures/canvas'
MODULE = [sys.executable, '-B', '-m', 'horsemen_core', 'mcp']
LEGACY = [sys.executable, '-B', str(SCRIPTS / 'horsemen.py'), 'mcp']


class Server:
    def __init__(self, cwd, command=MODULE, extra=()):
        env = dict(os.environ, PYTHONPATH=str(SCRIPTS), PYTHONDONTWRITEBYTECODE='1')
        self.process = subprocess.Popen([*command, *extra], cwd=cwd, env=env, stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.next_id = 0

    def send_raw(self, data):
        self.process.stdin.write(data)
        self.process.stdin.flush()

    def receive(self):
        line = self.process.stdout.readline()
        if not line:
            raise AssertionError('server closed its output: ' + self.process.stderr.read().decode()[-500:])
        assert line.endswith(b'\n') and line.count(b'\n') == 1
        return json.loads(line)

    def request(self, method, params=None):
        self.next_id += 1
        message = {'jsonrpc': '2.0', 'id': self.next_id, 'method': method}
        if params is not None:
            message['params'] = params
        self.send_raw(json.dumps(message).encode() + b'\n')
        reply = self.receive()
        assert reply.get('id') == self.next_id and reply.get('jsonrpc') == '2.0', reply
        return reply

    def call(self, name, arguments):
        reply = self.request('tools/call', {'name': name, 'arguments': arguments})
        assert 'result' in reply, reply
        content = reply['result']['content']
        assert len(content) == 1 and content[0]['type'] == 'text', content
        return content[0]['text'], reply['result'].get('isError', False)

    def close(self):
        self.process.stdin.close()
        code = self.process.wait(timeout=10)
        rest = self.process.stdout.read()
        self.process.stdout.close()
        self.process.stderr.close()
        return code, rest


class McpServer(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve() / 'lantern-walks'
        shutil.copytree(FIXTURES / 'workspace', self.root)
        self.servers = []

    def start(self, cwd=None, **options):
        server = Server(cwd or self.root, **options)
        self.servers.append(server)
        self.addCleanup(lambda: server.process.poll() is None and server.process.kill())
        self.addCleanup(lambda: [stream.close() for stream in (server.process.stdin, server.process.stdout, server.process.stderr) if stream and not stream.closed])
        return server

    def test_start_list_call_and_exit(self):
        server = self.start()
        reply = server.request('initialize', {'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 'test', 'version': '0'}})
        result = reply['result']
        self.assertEqual(result['protocolVersion'], '2025-06-18')
        self.assertEqual(result['serverInfo']['name'], 'horsemen')
        self.assertEqual(result['capabilities'], {'tools': {}})
        server.send_raw(b'{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
        tools = server.request('tools/list')['result']['tools']
        self.assertEqual([tool['name'] for tool in tools], ['read', 'canvas_edit'])
        text, is_error = server.call('read', {'target': ''})
        self.assertFalse(is_error, text)
        self.assertIn('workspace lantern-walks', text)
        self.assertLessEqual(len(text), 800)
        text, is_error = server.call('canvas_edit', {'canvas': 'progress', 'ops': [
            {'op': 'add', 'node': {'text': 'The insurer answers on Friday.'}, 'near': '#Gates'}]})
        self.assertFalse(is_error, text)
        self.assertRegex(text, r'^ok rev=[0-9a-f]{8} added=s-gates,note-1 updated=0 removed=0$')
        self.assertLessEqual(len(text), 400)
        outline, is_error = server.call('read', {'target': 'progress.canvas'})
        self.assertFalse(is_error)
        self.assertIn('note-1 note "The insurer answers on Friday."', outline)
        self.assertIn(text.split()[1], outline.split('\n')[0])
        self.assertEqual(server.request('ping')['result'], {})
        code, rest = server.close()
        self.assertEqual(code, 0)
        self.assertEqual(rest, b'')
        self.assertIn('"id":"note-1"', (self.root / '.horsemen/canvas/progress.canvas').read_text(encoding='utf-8'))

    def test_tool_definitions_match_the_design_and_the_budget(self):
        compact = json.dumps(mcp.TOOLS, separators=(',', ':'), ensure_ascii=False)
        self.assertLessEqual(len(compact), 1200, len(compact))
        self.assertEqual([tool['name'] for tool in mcp.TOOLS], ['read', 'canvas_edit'])
        read, edit = mcp.TOOLS
        self.assertEqual(read['inputSchema']['required'], ['target'])
        self.assertEqual(set(read['inputSchema']['properties']), {'target', 'max_chars', 'offset', 'if_rev'})
        self.assertEqual(read['inputSchema']['properties']['max_chars'], {'type': 'integer', 'minimum': 200, 'maximum': 8000})
        self.assertEqual(edit['inputSchema']['required'], ['canvas', 'ops'])
        self.assertEqual(set(edit['inputSchema']['properties']), {'canvas', 'ops', 'base_rev', 'dry_run'})
        ops = edit['inputSchema']['properties']['ops']
        self.assertEqual(ops['maxItems'], 50)
        self.assertEqual(ops['items']['properties']['op'], {'enum': ['add', 'update', 'remove']})
        self.assertEqual(ops['items']['properties']['side'], {'enum': ['right', 'left', 'below', 'above']})
        self.assertEqual(self.start().request('tools/list')['result']['tools'], mcp.TOOLS)

    def test_protocol_version(self):
        for asked, given in (('2024-11-05', '2024-11-05'), ('2025-03-26', '2025-03-26'), ('1999-01-01', '2025-06-18'), (None, '2025-06-18')):
            params = {'capabilities': {}} if asked is None else {'protocolVersion': asked, 'capabilities': {}}
            self.assertEqual(self.start().request('initialize', params)['result']['protocolVersion'], given)

    def test_bad_input_gets_an_error_and_the_server_keeps_running(self):
        server = self.start()
        cases = [(b'{not json\n', -32700), (b'[]\n', -32600), (b'[{"jsonrpc":"2.0","id":1,"method":"ping"}]\n', -32600),
                 (b'"text"\n', -32600), (b'5\n', -32600), (b'{"jsonrpc":"2.0","id":7}\n', -32600),
                 (b'{"jsonrpc":"2.0","id":8,"method":5}\n', -32600), (b'\xff\xfe\n', -32700),
                 (b'{"jsonrpc":"2.0","id":9,"method":"resources/list"}\n', -32601),
                 (b'{"jsonrpc":"2.0","id":"abc","method":"no/such/method","params":{}}\n', -32601),
                 (b'{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"shell","arguments":{}}}\n', -32602),
                 (b'{"jsonrpc":"2.0","id":11,"method":"tools/call","params":"read"}\n', -32602),
                 (b'{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"read","arguments":[]}}\n', -32602),
                 (b'{"jsonrpc":"2.0","id":13,"method":"tools/call"}\n', -32602)]
        for data, code in cases:
            server.send_raw(data)
            reply = server.receive()
            self.assertEqual(reply['error']['code'], code, data)
            self.assertEqual(reply['jsonrpc'], '2.0')
            self.assertIn('id', reply)
            self.assertLessEqual(len(reply['error']['message']), 200)
        self.assertEqual(server.request('ping')['result'], {})
        # Notifications and blank lines get no reply.
        server.send_raw(b'\n   \n{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":1}}\n{"jsonrpc":"2.0","method":"no/such/notification"}\n')
        self.assertEqual(server.request('ping')['result'], {})
        self.assertEqual(server.close(), (0, b''))

    def test_request_ids_are_returned_as_sent(self):
        server = self.start()
        for raw in (b'"a-string"', b'0', b'-3', b'12345678901234567890'):
            server.send_raw(b'{"jsonrpc":"2.0","id":' + raw + b',"method":"ping"}\n')
            self.assertEqual(json.dumps(server.receive()['id']).encode(), raw)

    def test_a_very_long_line_is_refused(self):
        server = self.start()
        server.send_raw(b'{"jsonrpc":"2.0","id":1,"method":"ping","params":{"pad":"' + b'x' * (5 * 1024 * 1024) + b'"}}\n')
        self.assertEqual(server.receive()['error']['code'], -32600)
        self.assertEqual(server.request('ping')['result'], {})

    def test_tool_errors_are_results_not_protocol_errors(self):
        server = self.start()
        for name, arguments, word in (('read', {'target': '../secret'}, 'target'), ('read', {}, 'target'), ('read', {'target': 5}, 'target'),
                                      ('read', {'target': 'progress', 'max_chars': 9000}, 'max_chars'),
                                      ('read', {'target': 'progress', 'surprise': 1}, 'surprise'),
                                      ('canvas_edit', {'canvas': 'progress'}, 'ops'), ('canvas_edit', {'ops': []}, 'canvas'),
                                      ('canvas_edit', {'canvas': '../x', 'ops': []}, 'canvas name'),
                                      ('canvas_edit', {'canvas': 'progress', 'ops': [{'op': 'remove', 'id': 'ghost'}]}, 'ghost'),
                                      ('canvas_edit', {'canvas': 'progress', 'ops': [], 'dry_run': 'yes'}, 'dry_run'),
                                      ('canvas_edit', {'canvas': 'progress', 'ops': [], 'base_rev': 5}, 'base_rev')):
            text, is_error = server.call(name, arguments)
            self.assertTrue(is_error, (name, arguments, text))
            self.assertIn(word, text)
            self.assertLessEqual(len(text), 400)
        self.assertEqual(sorted(p.name for p in (self.root / '.horsemen/canvas').iterdir()), ['launch-plan.canvas', 'progress.canvas'])

    def test_output_limits_hold_for_hostile_content(self):
        folder = self.root / '.horsemen/canvas'
        nodes = ','.join('{"id":"n%04d","type":"text","x":%d,"y":0,"width":320,"height":140,"text":"%s"}' % (i, i * 400, 'long text ' * 1900) for i in range(26))
        (folder / 'big.canvas').write_text('{"nodes":[' + nodes + ']}', encoding='utf-8')
        progress = self.root / 'PROGRESS.md'
        progress.write_text(progress.read_text(encoding='utf-8') + '\n## Long\n\n' + 'word ' * 30000 + '\n' + ''.join(f'## H{i} {"t" * 200}\n' for i in range(300)), encoding='utf-8')
        server = self.start()
        for arguments, limit in (({'target': ''}, 800), ({'target': 'progress'}, 1200), ({'target': 'progress#Long'}, 2000),
                                 ({'target': 'big.canvas'}, 2000), ({'target': 'big.canvas#n0001'}, 2000),
                                 ({'target': 'progress#Long', 'max_chars': 8000}, 8000), ({'target': 'big.canvas', 'max_chars': 8000}, 8000),
                                 ({'target': 'big.canvas#n0001', 'max_chars': 8000, 'offset': 100}, 8000), ({'target': 'progress', 'max_chars': 8000}, 1200),
                                 ({'target': 'progress#Long', 'max_chars': 200}, 200)):
            text, is_error = server.call('read', arguments)
            self.assertFalse(is_error, text[:200])
            self.assertLessEqual(len(text), limit, arguments)
        ops = [{'op': 'add', 'node': {'id': 'an-identifier-that-is-quite-long-for-a-note-%04d' % i, 'text': 'x' * 20000}} for i in range(50)]
        text, is_error = server.call('canvas_edit', {'canvas': 'big', 'ops': ops, 'dry_run': True})
        self.assertLessEqual(len(text), 400)
        text, is_error = server.call('canvas_edit', {'canvas': 'big', 'ops': [{'op': 'add', 'node': {'id': 'x' * 100000, 'text': 'x'}}]})
        self.assertTrue(is_error)
        self.assertLessEqual(len(text), 400)

    def test_replies_are_ascii_json_lines(self):
        server = self.start()
        server.send_raw(json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': 'read', 'arguments': {'target': 'launch-plan.canvas#idea-partners'}}}).encode() + b'\n')
        line = server.process.stdout.readline()
        self.assertTrue(line.isascii())
        self.assertIn('harbour cafés', json.loads(line)['result']['content'][0]['text'])

    def test_folder_without_records(self):
        empty = Path(self.temp.name).resolve() / 'empty'
        empty.mkdir()
        server = self.start(cwd=empty)
        text, is_error = server.call('read', {'target': ''})
        self.assertTrue(is_error)
        self.assertIn('no Horsemen records', text)
        text, is_error = server.call('canvas_edit', {'canvas': 'ideas', 'ops': [{'op': 'add', 'node': {'text': 'x'}}]})
        self.assertTrue(is_error)
        self.assertEqual(list(empty.iterdir()), [])

    def test_project_is_found_from_a_subfolder_and_from_path(self):
        (self.root / 'site/pages').mkdir(parents=True)
        text, _ = self.start(cwd=self.root / 'site/pages').call('read', {'target': ''})
        self.assertIn('workspace lantern-walks', text)
        elsewhere = Path(self.temp.name).resolve() / 'elsewhere'
        elsewhere.mkdir()
        text, _ = self.start(cwd=elsewhere, extra=['--path', str(self.root)]).call('read', {'target': ''})
        self.assertIn('workspace lantern-walks', text)

    def test_legacy_entry_point_starts_the_same_server(self):
        server = self.start(command=LEGACY)
        self.assertEqual(server.request('initialize', {'protocolVersion': '2025-06-18', 'capabilities': {}})['result']['serverInfo']['name'], 'horsemen')
        self.assertEqual(server.request('tools/list')['result']['tools'], mcp.TOOLS)
        text, is_error = server.call('read', {'target': 'progress.canvas'})
        self.assertFalse(is_error, text)
        self.assertEqual(server.close(), (0, b''))

    def test_a_record_made_after_the_server_started_is_seen(self):
        empty = Path(self.temp.name).resolve() / 'later'
        empty.mkdir()
        server = self.start(cwd=empty)
        self.assertTrue(server.call('read', {'target': ''})[1])
        (empty / 'PROGRESS.md').write_text('# Progress\n\nNext action: Start.\n\n## Up next\n', encoding='utf-8')
        text, is_error = server.call('read', {'target': ''})
        self.assertFalse(is_error, text)
        self.assertIn('next: Start.', text)


if __name__ == '__main__':
    unittest.main()
