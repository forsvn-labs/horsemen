"""The receipt command for real agent sessions, with fake hosts. No real host runs here.

Each fake host reads the server command that the run gives it, starts the real
MCP server, calls the tools, and prints events in the format of that host.

Failure modes covered:
- a host that is not on PATH
- a session with no tool call, with `read` only, or with a refused edit
- a session that says "ok" but leaves the file unchanged
- a session that does not end
- a command that would change a host setting (`mcp add`), or that lacks the options that
  keep the server for one run only
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import agent_sessions  # noqa: E402

FAKE = r'''#!{python}
import json, os, re, subprocess, sys, time
host, argv, mode = "{host}", sys.argv[1:], os.environ.get("FAKE_MODE", "ok")
open(os.environ["FAKE_LOG"], "a").write(json.dumps([host] + argv) + "\n")
if argv == ["--version"]:
    print("fake " + host + " 1.0"); raise SystemExit(0)
if mode == "hang":
    time.sleep(60)
if host == "claude":
    server = json.load(open(argv[argv.index("--mcp-config") + 1]))["mcpServers"]["horsemen"]
    command, prompt = [server["command"]] + server["args"], argv[argv.index("-p") + 1]
else:
    values = dict(part.split("=", 1) for part in argv if part.startswith("mcp_servers.horsemen."))
    command = [json.loads(values["mcp_servers.horsemen.command"])] + json.loads(values["mcp_servers.horsemen.args"])
    prompt = argv[-1]
mark = re.search(r'"(Receipt [0-9a-f]+)"', prompt).group(1)
server = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
count = 0
def call(tool, arguments):
    global count
    count += 1
    server.stdin.write(json.dumps({{"jsonrpc": "2.0", "id": count, "method": "tools/call", "params": {{"name": tool, "arguments": arguments}}}}) + "\n")
    server.stdin.flush()
    result = json.loads(server.stdout.readline())["result"]
    if host == "codex":
        print(json.dumps({{"type": "item.completed", "item": {{"id": "item_%d" % count, "type": "mcp_tool_call", "server": "horsemen", "tool": tool,
              "arguments": arguments, "result": {{"content": result["content"]}}, "status": "failed" if result["isError"] else "completed"}}}}))
    else:
        print(json.dumps({{"type": "assistant", "message": {{"content": [{{"type": "tool_use", "id": "t%d" % count, "name": "mcp__horsemen__" + tool, "input": arguments}}]}}}}))
        print(json.dumps({{"type": "user", "message": {{"content": [{{"type": "tool_result", "tool_use_id": "t%d" % count, "is_error": result["isError"], "content": result["content"]}}]}}}}))
print("not json")
if mode != "silent":
    call("read", {{"target": ""}})
if mode in ("ok", "refused", "dry"):
    node = {{"text": mark}} if mode != "refused" else {{"type": "sticker", "text": mark}}
    call("canvas_edit", {{"canvas": "progress", "ops": [{{"op": "add", "node": node, "near": "s-shipped", "side": "below"}}], "dry_run": mode == "dry"}})
server.stdin.close()
server.wait()
'''


class AgentSessions(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.bin = self.base / "bin"
        self.bin.mkdir()
        self.log = self.base / "host.log"
        self.saved = dict(os.environ)
        self.addCleanup(lambda: (os.environ.clear(), os.environ.update(self.saved)))
        os.environ.update(PATH=f"{self.bin}{os.pathsep}/usr/bin:/bin", FAKE_LOG=str(self.log), FAKE_MODE="ok")

    def fake(self, *hosts):
        for host in hosts:
            path = self.bin / host
            path.write_text(FAKE.format(python=sys.executable, host=host))
            path.chmod(0o755)

    def run_command(self, *args, name="out"):
        output = self.base / name
        code = subprocess.run([sys.executable, "-B", str(ROOT / "scripts/agent_sessions.py"), "--output", str(output), *args],
                              capture_output=True, text=True, timeout=120)
        receipt = json.loads((output / "agent-sessions.json").read_text())
        return code, receipt

    def test_both_hosts_call_both_tools(self):
        self.fake("claude", "codex")
        done, receipt = self.run_command()
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertEqual(receipt["status"], "passed")
        for session in receipt["sessions"]:
            self.assertTrue(session["passed"], session)
            self.assertEqual([call["tool"] for call in session["calls"]], ["read", "canvas_edit"])
            self.assertTrue(session["calls"][1]["reply"].startswith("ok rev="))
            self.assertEqual(session["version"], f"fake {session['host']} 1.0")
        self.assertIn("claude: passed", done.stdout)
        self.assertTrue((self.base / "out/codex-events.jsonl").is_file())
        # The receipt holds no path of this computer.
        self.assertNotIn(str(self.base), json.dumps(receipt))
        self.assertNotIn(str(Path.home()), json.dumps(receipt))

    def test_the_server_is_set_for_one_run_only(self):
        self.fake("claude", "codex")
        self.run_command()
        runs = [json.loads(line) for line in self.log.read_text().splitlines()]
        for run in runs:
            self.assertNotIn("add", run, "the command must not register the server with the host")
            self.assertNotIn("install", run)
        claude = next(run for run in runs if run[0] == "claude" and "-p" in run)
        self.assertIn("--strict-mcp-config", claude)
        self.assertEqual(claude[claude.index("--setting-sources") + 1], "project")
        self.assertIn("--no-session-persistence", claude)
        codex = next(run for run in runs if run[0] == "codex" and "exec" in run)
        for option in ("--ephemeral", "--ignore-user-config"):
            self.assertIn(option, codex)
        self.assertEqual(codex[codex.index("--sandbox") + 1], "read-only")
        approvals = [part for part in codex if "approval" in part]
        self.assertEqual(approvals, ['mcp_servers.horsemen.tools.canvas_edit.approval_mode="approve"'], "only the write tool needs an approval setting")

    def test_a_session_that_does_not_use_both_tools_fails(self):
        self.fake("claude")
        for mode, problem in (("silent", "no successful call to read"), ("read-only", "no successful call to canvas_edit"),
                              ("refused", "no successful call to canvas_edit"), ("dry", "does not have the new note")):
            os.environ["FAKE_MODE"] = mode
            done, receipt = self.run_command("--host", "claude", name="out-" + mode)
            self.assertEqual(done.returncode, 1, mode)
            self.assertEqual(receipt["status"], "failed")
            self.assertIn(problem, " ".join(receipt["sessions"][0]["problems"]), mode)

    def test_a_missing_host_fails(self):
        self.fake("claude")
        done, receipt = self.run_command()
        self.assertEqual(done.returncode, 1)
        self.assertEqual([session["passed"] for session in receipt["sessions"]], [True, False])
        self.assertIn("codex is not on PATH", receipt["sessions"][1]["problems"])

    def test_a_session_that_does_not_end_fails(self):
        self.fake("codex")
        os.environ["FAKE_MODE"] = "hang"
        done, receipt = self.run_command("--host", "codex", "--timeout", "2")
        self.assertEqual(done.returncode, 1)
        self.assertIn("no result in 2 seconds", receipt["sessions"][0]["problems"])

    def test_output_must_be_new_and_outside_the_checkout(self):
        inside = subprocess.run([sys.executable, "-B", str(ROOT / "scripts/agent_sessions.py"), "--output", str(ROOT / "receipts")],
                                capture_output=True, text=True, timeout=60)
        self.assertEqual(inside.returncode, 2)
        self.assertFalse((ROOT / "receipts").exists())


if __name__ == "__main__":
    unittest.main()
