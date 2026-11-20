"""Receipts from real agent sessions: Claude Code and Codex call `read` and `canvas_edit`.

Each host starts a new session in a temporary copy of the fictional project in
`tests/fixtures/canvas/workspace`. The MCP server is set for that one run: a
config file for Claude Code (`--mcp-config` with `--strict-mcp-config`) and
command-line overrides for Codex (`-c`). No host setting and no installed
skill changes.

This command calls the real hosts. It uses the accounts of the person who
runs it, and it costs tokens, so `scripts/verify.py` does not run it.

usage: agent_sessions.py --output DIR [--host claude|codex] [--script PATH] [--timeout SECONDS]
"""
import argparse
import json
import secrets
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "horsemen/scripts"))
from horsemen_core import canvas  # noqa: E402

HOSTS = ("claude", "codex")
SERVER = "horsemen"
FIXTURE = ROOT / "tests/fixtures/canvas/workspace"
CANVAS = "progress"
PROMPT = ('Use only the tools of the {server} MCP server. Step 1: call read with the target "" (empty text). '
          'Step 2: call read with the target "{canvas}.canvas". Step 3: call canvas_edit on the canvas "{canvas}" with one op '
          'that adds a node with the text "{mark}" near "s-shipped" on the side "below". '
          "Then reply with the rev from the edit reply. Do not use other tools, and do not change other files.")


def host_command(host, server, prompt, config):
    """The command for one new session. `config` is the path of the Claude Code MCP config file."""
    if host == "claude":
        return ["claude", "-p", prompt, "--mcp-config", str(config), "--strict-mcp-config", "--setting-sources", "project",
                "--no-session-persistence", "--output-format", "stream-json", "--verbose",
                "--allowedTools", f"mcp__{SERVER}__read", f"mcp__{SERVER}__canvas_edit"]
    key = f"mcp_servers.{SERVER}"
    return ["codex", "exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--json", "--sandbox", "read-only",
            "-c", f"{key}.command={json.dumps(server[0])}", "-c", f"{key}.args={json.dumps(server[1:])}",
            # A run with no person cannot answer an approval prompt. `read` is marked read-only and needs none.
            "-c", f'{key}.tools.canvas_edit.approval_mode="approve"', prompt]


def tool_calls(host, stream):
    """The calls to the Horsemen tools in a host's event stream: {tool, arguments, reply, error}."""
    calls, pending = [], {}
    for line in stream.splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if not isinstance(event, dict):
            continue
        if host == "codex":
            item = event.get("item")
            if event.get("type") == "item.completed" and isinstance(item, dict) and item.get("type") == "mcp_tool_call" \
                    and item.get("server") == SERVER:
                content = (item.get("result") or {}).get("content") or []
                calls.append({"tool": item.get("tool"), "arguments": item.get("arguments"),
                              "reply": "".join(part.get("text", "") for part in content if isinstance(part, dict)),
                              "error": item.get("status") != "completed"})
            continue
        content = (event.get("message") or {}).get("content") if isinstance(event.get("message"), dict) else None
        for part in content if isinstance(content, list) else []:
            if not isinstance(part, dict):
                continue
            prefix = f"mcp__{SERVER}__"
            if part.get("type") == "tool_use" and str(part.get("name", "")).startswith(prefix):
                pending[part.get("id")] = {"tool": part["name"][len(prefix):], "arguments": part.get("input"), "reply": "", "error": True}
                calls.append(pending[part.get("id")])
            elif part.get("type") == "tool_result" and part.get("tool_use_id") in pending:
                reply = part.get("content")
                text = reply if isinstance(reply, str) else "".join(p.get("text", "") for p in reply or [] if isinstance(p, dict))
                pending[part["tool_use_id"]].update(reply=text, error=bool(part.get("is_error")))
    return calls


def judge(calls, data, mark):
    """Reasons why a session is not a receipt. An empty list means that both tools worked."""
    problems = []
    reads = [call for call in calls if call["tool"] == "read" and not call["error"]]
    edits = [call for call in calls if call["tool"] == "canvas_edit" and not call["error"] and call["reply"].startswith("ok rev=")]
    if not reads:
        problems.append("no successful call to read")
    if not edits:
        problems.append("no successful call to canvas_edit")
    result = canvas.check_bytes(data) if data is not None else None
    if result is None or result.text is None or not result.canonical:
        problems.append("the canvas file is not valid canonical text after the session")
    elif not any(node.get("type") == "text" and mark in node.get("text", "") for node in result.doc.get("nodes", [])):
        problems.append("the canvas file does not have the new note")
    elif edits and f"rev={canvas.rev(data)}" not in edits[-1]["reply"]:
        problems.append("the rev of the canvas file is not the rev of the last edit reply")
    return problems


def run_host(host, server, output, timeout):
    receipt = {"host": host, "passed": False}
    executable = shutil.which(host)
    if not executable:
        return dict(receipt, problems=[f"{host} is not on PATH"])
    version = subprocess.run([executable, "--version"], capture_output=True, text=True, timeout=30, stdin=subprocess.DEVNULL)
    receipt["version"] = (version.stdout or version.stderr).strip().splitlines()[0][:80] if (version.stdout or version.stderr).strip() else ""
    mark = "Receipt " + secrets.token_hex(4)
    with tempfile.TemporaryDirectory(prefix="horsemen-agent-") as temporary:
        project = Path(temporary).resolve() / "lantern-walks"
        shutil.copytree(FIXTURE, project)
        config = Path(temporary) / "mcp.json"
        config.write_text(json.dumps({"mcpServers": {SERVER: {"command": server[0], "args": server[1:]}}}))
        command = host_command(host, server, PROMPT.format(server=SERVER, canvas=CANVAS, mark=mark), config)
        command[0] = executable
        try:
            done = subprocess.run(command, cwd=project, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
            stream, receipt["exit_code"] = done.stdout, done.returncode
        except subprocess.TimeoutExpired as error:
            stream = error.stdout.decode("utf-8", "replace") if isinstance(error.stdout, bytes) else error.stdout or ""
            receipt["exit_code"] = None
            receipt["problems"] = [f"no result in {timeout} seconds"]
        (output / f"{host}-events.jsonl").write_text(stream)
        path = project / canvas.FOLDER / (CANVAS + canvas.SUFFIX)
        data = path.read_bytes() if path.is_file() else None
    calls = tool_calls(host, stream)
    receipt["calls"] = [{"tool": call["tool"], "arguments": call["arguments"], "error": call["error"],
                         "reply": call["reply"][:300]} for call in calls if call["tool"] in ("read", "canvas_edit")][:12]
    receipt["problems"] = receipt.get("problems", []) + judge(calls, data, mark)
    receipt["passed"] = not receipt["problems"]
    # The command without the prompt and without local paths: what set the server for this run only.
    receipt["isolation"] = [part for part in command[1:] if part.startswith("--") and part not in ("--verbose",)]
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--output", required=True, type=Path, help="New output directory outside the checkout")
    parser.add_argument("--host", choices=HOSTS, help="One host only (default: both)")
    parser.add_argument("--script", type=Path, default=ROOT / "horsemen/scripts/horsemen.py", help="The horsemen.py that starts the server")
    parser.add_argument("--timeout", type=int, default=300, help="Seconds for one session (default: 300)")
    args = parser.parse_args(argv)
    output = args.output.resolve()
    if output.is_relative_to(ROOT):
        parser.error("Keep receipts outside the checkout")
    if not args.script.is_file():
        parser.error(f"Script not found: {args.script}")
    output.mkdir(parents=True, exist_ok=False)
    server = [sys.executable, str(args.script.resolve()), "mcp"]
    sessions = [run_host(host, server, output, args.timeout) for host in ((args.host,) if args.host else HOSTS)]
    commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    receipt = {"commit": commit, "status": "passed" if all(s["passed"] for s in sessions) else "failed", "sessions": sessions}
    (output / "agent-sessions.json").write_text(json.dumps(receipt, indent=2) + "\n")
    for session in sessions:
        tools = ", ".join(call["tool"] for call in session.get("calls", [])) or "no tool calls"
        print(f"{session['host']}: {'passed' if session['passed'] else 'FAILED: ' + '; '.join(session['problems'])} ({tools})")
    print(f"{receipt['status']}: {output / 'agent-sessions.json'}")
    return 0 if receipt["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
