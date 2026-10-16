"""
表格列错位诊断 (一次性工具)

测量表头单元格与数据单元格的 x 坐标, 逐列比对。
生产包报"标题和内容错位", 需要确认是真错位还是视觉误差。

运行: npm run build && python tools/diagnose-grid.py
"""

import base64
import json
import os
import socket
import struct
import subprocess
import sys
import time
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
SAMPLE = os.path.join(ROOT, "jig数据整理.xlsx")
PORT = 9343


class CDP:
    def __init__(self, port):
        self.port = port
        self.sock = None
        self.mid = 0

    def connect(self):
        targets = json.load(
            urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json", timeout=5)
        )
        page = next(t for t in targets if t.get("type") == "page")
        u = urlparse(page["webSocketDebuggerUrl"])
        self.sock = socket.create_connection((u.hostname, u.port), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(
            (
                f"GET {u.path} HTTP/1.1\r\nHost: {u.hostname}\r\n"
                "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
            ).encode()
        )
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.sock.recv(4096)

    def send(self, m, p=None):
        self.mid += 1
        d = json.dumps({"id": self.mid, "method": m, "params": p or {}}).encode()
        mask = os.urandom(4)
        mk = bytes(b ^ mask[i % 4] for i, b in enumerate(d))
        h = bytearray([0x81])
        n = len(mk)
        if n < 126:
            h.append(0x80 | n)
        else:
            h.append(0x80 | 126)
            h += struct.pack(">H", n)
        self.sock.sendall(bytes(h) + mask + mk)
        return self.mid

    def recv(self):
        h = self.sock.recv(2)
        if not h:
            raise RuntimeError("closed")
        ln = h[1] & 0x7F
        if ln == 126:
            ln = struct.unpack(">H", self.sock.recv(2))[0]
        elif ln == 127:
            ln = struct.unpack(">Q", self.sock.recv(8))[0]
        d = b""
        while len(d) < ln:
            d += self.sock.recv(ln - len(d))
        return json.loads(d.decode())

    def ev(self, e, awp=False):
        i = self.send("Runtime.evaluate",
                      {"expression": e, "returnByValue": True, "awaitPromise": awp})
        while True:
            m = self.recv()
            if m.get("id") == i:
                ex = m.get("result", {}).get("exceptionDetails")
                if ex:
                    return {"EXC": ex.get("exception", {}).get("description", "")[:300]}
                return m["result"]["result"].get("value")

    def close(self):
        if self.sock:
            try:
                self.sock.close()
            except Exception:
                pass


def main():
    if not os.path.exists(os.path.join(DIST, "index.html")):
        print("dist/ 不存在, 请先 npm run build")
        sys.exit(1)
    if not os.path.exists(SAMPLE):
        print("样本不存在")
        sys.exit(1)

    class H(SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=DIST, **kw)

        def log_message(self, *a):
            pass

    srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    import threading

    threading.Thread(target=srv.serve_forever, daemon=True).start()

    import shutil
    tmp = os.path.join(ROOT, "_diag.xlsx")
    shutil.copy(SAMPLE, tmp)

    env = dict(os.environ)
    env["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = f"--remote-debugging-port={PORT}"

    # 用 Playwright 打开浏览器版 dist (行为与 exe 一致)
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 800})
        page.goto(f"http://127.0.0.1:{PORT}")
        page.wait_for_load_state("networkidle")

        page.set_input_files("input[type=file]", tmp)
        page.wait_for_function(
            "() => document.querySelector('.rail')?.textContent.includes('已加载')",
            timeout=60000,
        )

        # 切到数据审查页 (行数最多, 含全部列)
        page.click(".tab >> nth=3")
        page.wait_for_timeout(1200)

        result = page.evaluate("""
        (() => {
          const ths = [...document.querySelectorAll('.grid__th')];
          const headers = ths.map(th => ({
            text: th.textContent,
            x: th.getBoundingClientRect().left,
            w: Math.round(th.getBoundingClientRect().width),
          }));

          const rows = [...document.querySelectorAll('.grid__tr')].slice(0, 3);
          const body = rows.map((tr, ri) => {
            const tds = [...tr.querySelectorAll('.grid__td')];
            return {
              index: ri,
              cells: tds.map(td => ({
                text: td.textContent.trim().slice(0, 12),
                x: td.getBoundingClientRect().left,
                w: Math.round(td.getBoundingClientRect().width),
              })),
            };
          });

          // 计算每列的最大偏差
          const drift = headers.map((h, i) => {
            const deltas = body
              .map(r => (r.cells[i] ? Math.abs(r.cells[i].x - h.x) : 999))
              .filter(d => d !== 999);
            return {
              col: h.text,
              headerX: h.x,
              headerW: h.w,
              maxDrift: deltas.length ? Math.max(...deltas) : -1,
              sampleDrifts: deltas,
            };
          });

          return { headers, body, drift };
        })()
        """)

        browser.close()
        os.remove(tmp)

    srv.shutdown()

    print("\n=== 表头 ===")
    for h in result["headers"]:
        print(f"  {h['text']:16s} x={h['x']:7.1f}  w={h['w']:4d}")

    for r in result["body"]:
        print(f"\n=== 第 {r['index'] + 1} 行 ===")
        for i, c in enumerate(r["cells"]):
            print(f"  {c['text']:16s} x={c['x']:7.1f}  w={c['w']:4d}")

    print("\n=== 逐列偏差 (表头 vs 数据行) ===")
    bad = 0
    for d in result["drift"]:
        flag = ""
        if d["maxDrift"] > 2:
            flag = "  <== 错位"
            bad += 1
        print(f"  {d['col']:16s} 表头x={d['headerX']:7.1f} 最大偏差={d['maxDrift']:4d}px "
              f"{d['sampleDrifts']}{flag}")

    print(f"\n=== 结论: {bad} 列存在错位 (>2px) ===")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()