"""A local MCP server over standard input and output, and its registration with agent hosts.

One JSON-RPC message on each line, as the MCP stdio transport defines. Standard
library only; no network and no token. The server has two tools, `read` and
`canvas_edit`. It reads the working tree, so it sees edits that are not pushed.
"""
import json
import os
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

from . import __version__, agent_tools, legacy

SERVER = 'horsemen'
PROTOCOLS = ('2025-06-18', '2025-03-26', '2024-11-05')
MAX_LINE = 4 * 1024 * 1024
HOSTS = ('claude', 'codex')
PARSE_ERROR, INVALID_REQUEST, NOT_FOUND, INVALID_PARAMS = -32700, -32600, -32601, -32602

# The definitions cost tokens in each session. A test keeps them under 1,200 characters as compact JSON.
TOOLS = [
    {
        'name': 'read',
        'description': 'Read a Horsemen workspace. target: "" = index. "progress" = headings of a record. '
                       '"progress#Shipped" = one section. "progress.canvas" = canvas outline. "progress.canvas#id" = one element.',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'target': {'type': 'string'},
                'max_chars': {'type': 'integer', 'minimum': 200, 'maximum': 8000},
                'offset': {'type': 'integer', 'minimum': 0},
                'if_rev': {'type': 'string'},
            },
            'required': ['target'],
        },
        # `read` changes nothing, so a host can run it with no approval prompt. `canvas_edit` has no mark.
        'annotations': {'readOnlyHint': True},
    },
    {
        'name': 'canvas_edit',
        'description': 'Change elements of one canvas file in .horsemen/canvas. Checks, formats, and writes the file. Does not commit.',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'canvas': {'type': 'string'},
                'ops': {
                    'type': 'array',
                    'maxItems': 50,
                    'items': {
                        'type': 'object',
                        'properties': {
                            'op': {'enum': ['add', 'update', 'remove']},
                            'id': {'type': 'string'},
                            'node': {'type': 'object'},
                            'edge': {'type': 'object'},
                            'near': {'type': 'string'},
                            'side': {'enum': ['right', 'left', 'below', 'above']},
                        },
                        'required': ['op'],
                    },
                },
                'base_rev': {'type': 'string'},
                'dry_run': {'type': 'boolean'},
            },
            'required': ['canvas', 'ops'],
        },
    },
]
ARGUMENTS = {tool['name']: (set(tool['inputSchema']['properties']), tool['inputSchema']['required']) for tool in TOOLS}


def _error(request_id, code, message):
    return {'jsonrpc': '2.0', 'id': request_id, 'error': {'code': code, 'message': message}}


def _result(request_id, result):
    return {'jsonrpc': '2.0', 'id': request_id, 'result': result}


def call_tool(name, arguments, path=None):
    """Run one tool. Returns (text, is_error)."""
    allowed, required = ARGUMENTS[name]
    unknown = sorted(set(arguments) - allowed)
    if unknown:
        return f'unknown argument {agent_tools.clip(str(unknown[0]), 60)}; {name} takes {", ".join(sorted(allowed))}', True
    missing = [key for key in required if key not in arguments]
    if missing:
        return f'{missing[0]} is required', True
    start = Path(path) if path else Path(os.getcwd())
    root = legacy.find_root(start)[0] if start.is_dir() else None
    if root is None:
        text = agent_tools.NO_RECORDS.format('this folder or above it')
        return (text + agent_tools.NOT_WRITTEN if name == 'canvas_edit' else text), True
    if name == 'read':
        reply = agent_tools.read(root, arguments['target'], arguments.get('max_chars'), arguments.get('offset', 0), arguments.get('if_rev'))
    else:
        reply = agent_tools.canvas_edit(root, arguments['canvas'], arguments['ops'], arguments.get('base_rev'), arguments.get('dry_run', False))
    return reply.text, not reply.ok


def handle(line, path=None):
    """The reply to one message line, or None when the message needs no reply."""
    try:
        message = json.loads(line.decode('utf-8'))
    except (ValueError, RecursionError):
        return _error(None, PARSE_ERROR, 'Parse error: each line must be one JSON-RPC message')
    if not isinstance(message, dict):
        return _error(None, INVALID_REQUEST, 'Invalid request: a message must be one JSON object; batches are not supported')
    request_id = message.get('id')
    if isinstance(request_id, bool) or not isinstance(request_id, (str, int, float, type(None))):
        request_id = None
    method = message.get('method')
    if not isinstance(method, str):
        if 'method' not in message and ('result' in message or 'error' in message):
            return None  # A response from the host; this server sends no requests.
        return _error(request_id, INVALID_REQUEST, 'Invalid request: method must be text')
    if 'id' not in message:
        return None  # A notification never gets a reply.
    params = message.get('params')
    if method == 'initialize':
        asked = params.get('protocolVersion') if isinstance(params, dict) else None
        return _result(request_id, {'protocolVersion': asked if asked in PROTOCOLS else PROTOCOLS[0],
                                    'capabilities': {'tools': {}}, 'serverInfo': {'name': SERVER, 'version': __version__}})
    if method == 'ping':
        return _result(request_id, {})
    if method == 'tools/list':
        return _result(request_id, {'tools': TOOLS})
    if method == 'tools/call':
        if not isinstance(params, dict) or not isinstance(params.get('name'), str):
            return _error(request_id, INVALID_PARAMS, 'Invalid params: tools/call needs a tool name')
        if params['name'] not in ARGUMENTS:
            return _error(request_id, INVALID_PARAMS, 'Unknown tool: ' + agent_tools.clip(params['name'], 60))
        arguments = params.get('arguments', {})
        if not isinstance(arguments, dict):
            return _error(request_id, INVALID_PARAMS, 'Invalid params: arguments must be an object')
        try:
            text, is_error = call_tool(params['name'], arguments, path)
        except Exception as error:  # A tool failure must not stop the server or show a local path.
            print(f'horsemen mcp: {type(error).__name__}: {error}', file=sys.stderr)
            text, is_error = 'internal error in the Horsemen tool; nothing written', True
        return _result(request_id, {'content': [{'type': 'text', 'text': text}], 'isError': is_error})
    return _error(request_id, NOT_FOUND, 'Method not found: ' + agent_tools.clip(method, 60))


def serve(path=None, stdin=None, stdout=None):
    """Answer messages until the input ends."""
    stdin = stdin or sys.stdin.buffer
    stdout = stdout or sys.stdout.buffer
    while True:
        line = stdin.readline(MAX_LINE + 1)
        if not line:
            return 0
        if len(line) > MAX_LINE and not line.endswith(b'\n'):
            while line and not line.endswith(b'\n'):  # Drop the rest of the long line.
                line = stdin.readline(MAX_LINE)
            reply = _error(None, INVALID_REQUEST, 'Invalid request: a message is longer than 4 MiB')
        elif not line.strip():
            continue
        else:
            reply = handle(line, path)
        if reply is not None:
            stdout.write(json.dumps(reply, separators=(',', ':')).encode('ascii') + b'\n')
            stdout.flush()


# ---------------------------------------------------------------- registration

def server_command(script_path=None):
    """The command that a host runs to start the server. Prefers the skill script, which needs no installed wheel."""
    python = sys.executable if sys.executable and os.path.isabs(sys.executable) and sys.executable != '/usr/bin/python3' else legacy.find_python()
    if not python:
        raise ValueError('No python3 found for the server command.')
    script = Path(script_path).expanduser().resolve() if script_path else Path(__file__).resolve().parent.parent / 'horsemen.py'
    if script_path and not script.is_file():
        raise ValueError(f'Script not found: {script}. Install the skill first or pass --script-path.')
    if script.is_file():
        return [python, str(script), 'mcp']
    return [python, '-m', 'horsemen_core', 'mcp']


def _host(executable, *args):
    try:
        done = subprocess.run([executable, *args], capture_output=True, text=True, timeout=90, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError) as error:
        return 1, str(error)
    return done.returncode, (done.stderr or done.stdout).strip()


def install(hosts, scope, dry_run, script_path=None):
    """Register the server through each host's own command. This function edits no host file."""
    command = server_command(script_path)
    registered = failed = 0
    for host in hosts:
        add = ['mcp', 'add'] + (['--scope', scope] if host == 'claude' else []) + [SERVER, '--'] + command
        if dry_run:
            print(' '.join(shlex.quote(part) for part in [host] + add))
            continue
        executable = shutil.which(host)
        if not executable:
            print(f'{host}: not found on PATH')
            continue
        if _host(executable, 'mcp', 'get', SERVER)[0] == 0:
            print(f'{host}: already registered. To replace it, run `{host} mcp remove {SERVER}`, then install again.')
            registered += 1
            continue
        code, detail = _host(executable, *add)
        if code:
            print(f"{host}: failed ({agent_tools.clip(detail.splitlines()[0] if detail else 'no message', 200)})")
            failed += 1
        else:
            print(f'{host}: registered {SERVER}' + (f' (scope {scope})' if host == 'claude' else ''))
            registered += 1
    if dry_run:
        return 0
    if registered and not failed:
        print('Start a new agent session to load the tools `read` and `canvas_edit`.')
    return 0 if registered and not failed else 1


def status(hosts):
    registered = 0
    for host in hosts:
        executable = shutil.which(host)
        if not executable:
            print(f'{host}: not found on PATH')
        elif _host(executable, 'mcp', 'get', SERVER)[0] == 0:
            print(f'{host}: registered')
            registered += 1
        else:
            print(f'{host}: not registered')
    try:
        print('server command: ' + ' '.join(shlex.quote(part) for part in server_command()))
    except ValueError as error:
        print(f'server command: {error}')
    return 0 if registered else 1


def cli(argv):
    import argparse
    parser = argparse.ArgumentParser(prog='horsemen mcp', description='Run the local MCP server (no action), or register it with an agent host.')
    parser.add_argument('action', nargs='?', choices=('install', 'status'), help='install or status; without an action, serve on standard input and output')
    parser.add_argument('--path', help='Project directory for the server (default: the folder where the host starts it)')
    parser.add_argument('--host', choices=HOSTS, help='One host only (default: Claude Code and Codex)')
    parser.add_argument('--scope', choices=('user', 'project', 'local'), default='user', help='Claude Code scope for install (default: user)')
    parser.add_argument('--script-path', help='The horsemen.py of the installed skill (default: the script next to this module)')
    parser.add_argument('--dry-run', action='store_true', help='Print the host commands; run nothing')
    args = parser.parse_args(argv)
    hosts = (args.host,) if args.host else HOSTS
    if args.action is None:
        return serve(args.path)
    try:
        if args.action == 'install':
            return install(hosts, args.scope, args.dry_run, args.script_path)
        return status(hosts)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2
