import sys, json
inp, out = sys.stdin.buffer, sys.stdout.buffer
def send(m):
    b = json.dumps(m).encode(); out.write(b"Content-Length: %d\r\n\r\n" % len(b) + b); out.flush()
while True:
    n = 0
    while True:
        line = inp.readline()
        if not line: sys.exit(0)
        line = line.strip()
        if not line: break
        if line.lower().startswith(b"content-length:"): n = int(line.split(b":")[1])
    m = json.loads(inp.read(n))
    if m.get("method") == "initialize": send({"jsonrpc": "2.0", "id": m["id"], "result": {"capabilities": {}}})
    elif m.get("method") in ("textDocument/didOpen", "textDocument/didChange"):
        uri = m["params"]["textDocument"]["uri"]
        text = m["params"]["textDocument"].get("text") or m["params"]["contentChanges"][0]["text"]
        diags = [{"range": {"start": {"line": i, "character": 4}}, "severity": 1, "message": "Cannot find name 'oops'."} for i, l in enumerate(text.splitlines()) if "oops" in l]
        diags.append({"range": {"start": {"line": 0, "character": 0}}, "severity": 2, "message": "just a warning"})
        send({"jsonrpc": "2.0", "method": "textDocument/publishDiagnostics", "params": {"uri": uri, "diagnostics": diags}})
