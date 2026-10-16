"""
分发包验收 (一次性工具)

对打好包的生产产物做最终检查, 模拟一台全新的产线电脑:
  - 干净 APPDATA (无任何历史配置)
  - 剥离 PATH (无 Python / 无开发工具)
  - 从打包目录里的 exe 启动, 而不是 target/release 的原件

只有全部通过, 这个包才适合发到生产环境。

运行: python tools/verify-package.py
"""

import base64
import json
import os
import shutil
import socket
import struct
import subprocess
import sys
import time
import urllib.request
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKG_DIR = os.path.join(ROOT, "dist-package", "JIG-Data-Finder-2.0.0-win64")
PKG_EXE = os.path.join(PKG_DIR, "jig-data-finder.exe")
ISO_APPDATA = os.path.join(os.environ["TEMP"], "jig-package-verify")
CDP_PORT = 9342
SAMPLE = os.path.join(ROOT, "jig数据整理.xlsx")

failures = []


def check(label, ok, detail=""):
    if ok:
        print(f"  [OK]   {label}")
    else:
        failures.append(label)
        print(f"  [FAIL] {label}" + (f" :: {detail}" if detail else ""))


class CDP:
    def __init__(self, port):
        self.port = port
        self.sock = None
        self.mid = 0

    def connect(self):
        targets = json.load(
            urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json", timeout=5)
        )
        page = next((t for t in targets if t.get("type") == "page"), None)
        if not page:
            raise RuntimeError("未找到页面")
        u = urlparse(page["webSocketDebuggerUrl"])
        self.sock = socket.create_connection((u.hostname, u.port), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(
            (
                f"GET {u.path} HTTP/1.1\r\n"
                f"Host: {u.hostname}:{u.port}\r\n"
                "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {key}\r\n"
                "Sec-WebSocket-Version: 13\r\n\r\n"
            ).encode()
        )
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.sock.recv(4096)
        return page

    def send(self, method, params=None):
        self.mid += 1
        d = json.dumps({"id": self.mid, "method": method, "params": params or {}}).encode()
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
            raise RuntimeError("连接关闭")
        ln = h[1] & 0x7F
        if ln == 126:
            ln = struct.unpack(">H", self.sock.recv(2))[0]
        elif ln == 127:
            ln = struct.unpack(">Q", self.sock.recv(8))[0]
        d = b""
        while len(d) < ln:
            d += self.sock.recv(ln - len(d))
        return json.loads(d.decode())

    def ev(self, expr, await_promise=False):
        i = self.send(
            "Runtime.evaluate",
            {"expression": expr, "returnByValue": True, "awaitPromise": await_promise},
        )
        while True:
            m = self.recv()
            if m.get("id") == i:
                ex = m.get("result", {}).get("exceptionDetails")
                if ex:
                    return {"EXC": ex.get("exception", {}).get("description", "")[:200]}
                return m["result"]["result"].get("value")

    def close(self):
        if self.sock:
            try:
                self.sock.close()
            except Exception:
                pass


def set_file_input(cdp, path):
    """通过 CDP 给隐藏的 file input 喂文件"""
    doc = cdp.send("DOM.getDocument")
    while True:
        m = cdp.recv()
        if m.get("id") == doc:
            root = m["result"]["root"]["nodeId"]
            break
    q = cdp.send("DOM.querySelector", {"nodeId": root, "selector": "input[type=file]"})
    while True:
        m = cdp.recv()
        if m.get("id") == q:
            node = m["result"]["nodeId"]
            break
    cdp.send("DOM.setFileInputFiles", {"files": [path], "nodeId": node})


def main():
    print("\n=== 分发包验收 ===\n")

    # ---- 包完整性 ----
    print("[1] 包内容")
    if not os.path.isdir(PKG_DIR):
        print(f"  [FAIL] 分发包目录不存在: {PKG_DIR}")
        print("         请先运行 python tools/package-release.py")
        sys.exit(1)

    for fn in ("jig-data-finder.exe", "使用说明.md", "版本信息.txt", "SHA256SUMS.txt"):
        check(f"包含 {fn}", os.path.exists(os.path.join(PKG_DIR, fn)))

    size_mb = os.path.getsize(PKG_EXE) / 1024 / 1024
    check(f"exe 体积合理 ({size_mb:.2f} MB)", size_mb < 20, f"{size_mb:.2f} MB")

    # SHA256 一致性
    import hashlib

    h = hashlib.sha256()
    with open(PKG_EXE, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    actual = h.hexdigest()
    recorded = ""
    sums = os.path.join(PKG_DIR, "SHA256SUMS.txt")
    if os.path.exists(sums):
        recorded = open(sums, encoding="utf-8").read().split()[0]
    check("SHA256 与记录一致", actual == recorded, f"实际 {actual[:16]}... 记录 {recorded[:16]}...")
    print(f"       SHA256: {actual}")

    # ---- 隔离启动 ----
    print("\n[2] 全新环境启动 (模拟产线电脑)")
    subprocess.run(["taskkill", "/F", "/IM", "jig-data-finder.exe"], capture_output=True)
    time.sleep(1)

    if os.path.isdir(ISO_APPDATA):
        shutil.rmtree(ISO_APPDATA)
    os.makedirs(ISO_APPDATA, exist_ok=True)

    env = dict(os.environ)
    env["APPDATA"] = ISO_APPDATA
    env["PATH"] = r"C:\Windows\System32;C:\Windows"
    env["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = f"--remote-debugging-port={CDP_PORT}"
    env.pop("PYTHONHOME", None)
    env.pop("PYTHONPATH", None)

    check("隔离环境无历史配置",
          not os.path.exists(os.path.join(ISO_APPDATA, "JIG Data Finder", "config.json")))

    # 从打包目录启动, 而不是 target/release 原件
    subprocess.Popen([PKG_EXE], env=env, cwd=PKG_DIR)

    cdp = CDP(CDP_PORT)
    connected = False
    for _ in range(30):
        time.sleep(1)
        try:
            cdp.connect()
            connected = True
            break
        except Exception:
            continue

    if not connected:
        check("打包的 exe 能启动", False, "30 秒内未连上")
        subprocess.run(["taskkill", "/F", "/IM", "jig-data-finder.exe"], capture_output=True)
        sys.exit(1)

    check("打包的 exe 能启动 (无 Python 环境)", True)

    # ---- UI ----
    print("\n[3] 界面")
    check("空状态引导", bool(cdp.ev("!!document.querySelector('.empty__title')")))
    check("四个标签页", cdp.ev("document.querySelectorAll('.tab').length") == 4)
    check("样式已加载",
          "Segoe UI" in str(cdp.ev("getComputedStyle(document.body).fontFamily")))
    check("中文正常显示 (无豆腐块)",
          cdp.ev("document.querySelector('.empty__title')?.textContent.includes('查询')") is True)

    # ---- 首启配置 ----
    print("\n[4] 首启配置")
    cfg = os.path.join(ISO_APPDATA, "JIG Data Finder", "config.json")
    for _ in range(10):
        if os.path.exists(cfg):
            break
        time.sleep(0.5)
    check("自动创建配置文件", os.path.exists(cfg))
    if os.path.exists(cfg):
        with open(cfg, encoding="utf-8-sig") as f:
            saved = json.load(f)
        check("配置含工程与尺寸映射",
              "engineering_config" in saved and "jig_size_mapping" in saved,
              f"字段数={len(saved)}")

    # ---- 加载真实数据 ----
    print("\n[5] 加载真实 Excel")
    if os.path.exists(SAMPLE):
        iso_sample = os.path.join(ISO_APPDATA, "sample.xlsx")
        shutil.copy(SAMPLE, iso_sample)
        set_file_input(cdp, iso_sample)

        loaded = False
        t0 = time.time()
        for _ in range(60):
            if cdp.ev("document.querySelector('.rail')?.textContent.includes('已加载')"):
                loaded = True
                break
            time.sleep(0.5)
        load_s = time.time() - t0
        check("Excel 加载成功", loaded, f"{load_s:.1f}s")

        if loaded:
            check("加载耗时可接受 (<10s)", load_s < 10, f"{load_s:.1f}s")

            # 全量透视
            cdp.ev("document.querySelectorAll('.tab')[2].click()")
            time.sleep(1.2)
            rows = cdp.ev("document.querySelectorAll('.grid__tr').length")
            check("全量透视有数据", (rows or 0) > 0, f"DOM 行数={rows}")

            stages = cdp.ev("document.querySelectorAll('.stage').length")
            check("工序轨道渲染 (10 道工序)", stages == 10, f"实际={stages}")

            total = cdp.ev("""
              (() => {
                const tds = [...document.querySelectorAll('.grid__tr.is-total .grid__td')];
                return tds.length ? tds[tds.length-1].textContent : '';
              })()
            """)
            check("总计 = 205 (与基线一致)", str(total).strip() == "205", f"实际={total!r}")

            # 审查页
            cdp.ev("document.querySelectorAll('.tab')[3].click()")
            time.sleep(1.5)
            review_rows = cdp.ev("document.querySelectorAll('.grid__tr').length")
            check("审查页有数据", (review_rows or 0) > 0, f"DOM 行数={review_rows}")

            # 查询
            cdp.ev("""
              (() => {
                const el = document.querySelector('.side__input');
                const setter = Object.getOwnPropertyDescriptor(
                  window.HTMLTextAreaElement.prototype, 'value').set;
                setter.call(el, 'CJJ349000910\\nCJJ349000919\\nNOTEXIST0001');
                el.dispatchEvent(new Event('input', { bubbles: true }));
              })()
            """)
            time.sleep(0.4)
            cdp.ev("""
              [...document.querySelectorAll('button')]
                .find(b => b.textContent.includes('开始查询'))?.click()
            """)
            time.sleep(1.2)
            q_rows = cdp.ev("document.querySelectorAll('.grid__tr').length")
            check("查询返回 3 行 (2 命中 + 1 未找到)", q_rows == 3, f"实际={q_rows}")

            notfound = cdp.ev(
                "document.querySelector('.grid__body')?.textContent.includes('【未找到】')"
            )
            check("未命中标记为 【未找到】", notfound is True)
    else:
        check("样本文件存在 (跳过数据链路验证)", False, SAMPLE)

    # ---- 截图存档 ----
    shots = os.path.join(ROOT, "docs", "shots")
    os.makedirs(shots, exist_ok=True)
    try:
        from PIL import Image
        import io as _io
        import win32gui
        import win32ui
        from ctypes import windll

        hwnd = win32gui.FindWindow(None, "JIG Data Finder")
        if hwnd:
            l, t, r, b = win32gui.GetWindowRect(hwnd)
            w, h = r - l, b - t
            hdc = win32gui.GetWindowDC(hwnd)
            mfc = win32ui.CreateDCFromHandle(hdc)
            save = mfc.CreateCompatibleDC()
            bmp = win32ui.CreateBitmap()
            bmp.CreateCompatibleBitmap(mfc, w, h)
            save.SelectObject(bmp)
            windll.user32.PrintWindow(hwnd, save.GetSafeHdc(), 2)
            info = bmp.GetInfo()
            bits = bmp.GetBitmapBits(True)
            img = Image.frombuffer("RGB", (info["bmWidth"], info["bmHeight"]), bits, "raw", "BGRX", 0, 1)
            img.save(os.path.join(shots, "95-package-verify.png"))
            print(f"\n  截图: docs/shots/95-package-verify.png")
    except Exception as e:
        print(f"  (截图跳过: {e})")

    cdp.close()
    subprocess.run(["taskkill", "/F", "/IM", "jig-data-finder.exe"], capture_output=True)

    print(f"\n=== 结果: {'全部通过, 可以部署' if not failures else str(len(failures)) + ' 项失败'} ===\n")
    sys.exit(0 if not failures else 1)


if __name__ == "__main__":
    main()