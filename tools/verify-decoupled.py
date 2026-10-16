"""
脱离 Python 独立性验证 (一次性工具)

证明 Tauri 版可以完全脱离 Python 运行。检查三层:

  1. 二进制层: exe 的 PE 导入表里没有任何 Python 相关 DLL
  2. 产物层: dist/ 与 target/release/ 里没有 .py / Python DLL
  3. 运行环境: 用隔离的 APPDATA + 剥离 PATH 启动, 验证功能正常

第3 层是关键 —— 前两层只说明"没打包进去", 不等于"跑起来不需要"。

运行: python tools/verify-decoupled.py
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
EXE = os.path.join(ROOT, "src-tauri", "target", "release", "jig-data-finder.exe")
DIST = os.path.join(ROOT, "dist")
RELEASE = os.path.join(ROOT, "src-tauri", "target", "release")
ISO_APPDATA = os.path.join(os.environ["TEMP"], "jig-decoupled-isolation")
CDP_PORT = 9341

failures = []


def check(label, ok, detail=""):
    if ok:
        print(f"  [OK]   {label}")
    else:
        failures.append(label)
        print(f"  [FAIL] {label}" + (f" :: {detail}" if detail else ""))


# ---------------------------------------------------------------- 1. PE 导入表
def parse_import_dlls(exe):
    """解析 PE 导入表, 返回 DLL 名列表"""
    d = open(exe, "rb").read()
    pe = struct.unpack_from("<I", d, 0x3C)[0]
    if d[pe:pe + 4] != b"PE\x00\x00":
        raise ValueError("不是有效的 PE 文件")

    nsec = struct.unpack_from("<H", d, pe + 6)[0]
    optsz = struct.unpack_from("<H", d, pe + 20)[0]
    opt = pe + 24
    pe32plus = struct.unpack_from("<H", d, opt)[0] == 0x20B

    ddir = opt + (112 if pe32plus else 96)
    imp_rva = struct.unpack_from("<I", d, ddir + 8)[0]

    sec = pe + 24 + optsz
    sections = []
    for i in range(nsec):
        o = sec + i * 40
        vsize, vaddr, rsize, raddr = struct.unpack_from("<IIII", d, o + 8)
        sections.append((vaddr, vsize, raddr, rsize))

    def r2o(rva):
        for va, vs, ra, rs in sections:
            if va <= rva < va + max(vs, rs):
                return ra + (rva - va)
        return None

    off = r2o(imp_rva)
    dlls = []
    while True:
        ent = d[off:off + 20]
        if len(ent) < 20 or ent == b"\x00" * 20:
            break
        name_rva = struct.unpack_from("<I", ent, 12)[0]
        if name_rva == 0:
            break
        no = r2o(name_rva)
        end = d.index(b"\x00", no)
        dlls.append(d[no:end].decode())
        off += 20
    return pe32plus, dlls


# ---------------------------------------------------------------- 2. 产物扫描
def scan_for_python(root):
    """返回目录下所有 Python 相关文件"""
    hits = []
    keywords = ("python", "pandas", "numpy", "pyside", "pyqt", "openpyxl")
    for dirpath, _dirnames, filenames in os.walk(root):
        for fn in filenames:
            if fn.lower().endswith((".py", ".pyc", ".pyd")):
                hits.append(os.path.join(dirpath, fn))
            elif fn.lower().endswith(".dll"):
                low = fn.lower()
                if any(k in low for k in keywords):
                    hits.append(os.path.join(dirpath, fn))
    return hits


# ---------------------------------------------------------------- CDP 客户端
class CDP:
    def __init__(self, port):
        self.port = port
        self.sock = None
        self.mid = 0

    def connect(self, timeout=30):
        import base64 as _b
        targets = json.load(
            urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json", timeout=5)
        )
        page = next((t for t in targets if t.get("type") == "page"), None)
        if not page:
            raise RuntimeError("未找到页面 target")

        u = urlparse(page["webSocketDebuggerUrl"])
        self.sock = socket.create_connection((u.hostname, u.port), timeout=10)
        key = _b.b64encode(os.urandom(16)).decode()
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
                    return {"EXC": ex.get("exception", {}).get("description", "")[:300]}
                return m["result"]["result"].get("value")

    def close(self):
        if self.sock:
            try:
                self.sock.close()
            except Exception:
                pass


def main():
    print("\n=== 脱离 Python 独立性验证 ===\n")

    if not os.path.exists(EXE):
        print(f"  [FAIL] exe 不存在: {EXE}")
        sys.exit(1)

    # ---- 层 1: 二进制 ----
    print("[层 1] PE 导入表")
    pe32plus, dlls = parse_import_dlls(EXE)
    check("exe 是 64 位 (PE32+)", pe32plus, "PE32 (32 位)")
    py_dlls = [x for x in dlls if any(
        k in x.lower() for k in ("python", "pandas", "numpy", "pyside", "pyqt")
    )]
    check(f"导入的 {len(dlls)} 个 DLL 中无 Python 相关", not py_dlls,
          f"发现: {py_dlls}")
    size_mb = os.path.getsize(EXE) / 1024 / 1024
    print(f"       exe 体积 {size_mb:.2f} MB")

    # ---- 层 2: 产物 ----
    print("\n[层 2] 构建产物")
    dist_hits = scan_for_python(DIST)
    check(f"dist/ 无 Python 文件 ({len(os.listdir(DIST))} 个产物)",
          not dist_hits, f"{[os.path.basename(x) for x in dist_hits]}")

    rel_hits = []
    for dirpath, dirnames, filenames in os.walk(RELEASE):
        # target 下有大量构建中间产物, 只看最终产物目录
        if "deps" in dirpath or "build" in dirpath or "incremental" in dirpath:
            continue
        for fn in filenames:
            if fn.lower().endswith((".py", ".pyc", ".pyd")):
                rel_hits.append(os.path.join(dirpath, fn))
    check("target/release 无 Python 文件", not rel_hits,
          f"{[os.path.basename(x) for x in rel_hits]}")

    js = [f for f in os.listdir(os.path.join(DIST, "assets"))
          if f.endswith(".js")][0]
    js_path = os.path.join(DIST, "assets", js)
    content = open(js_path, encoding="utf-8").read()
    # 检查 bundle 里有没有 Python 特有的标识
    py_markers = ["PySide2", "import pandas", "def main(", "__pycache__"]
    found = [m for m in py_markers if m in content]
    check("JS bundle 不含 Python 代码痕迹", not found, f"发现: {found}")

    # ---- 层 3: 隔离运行 ----
    print("\n[层 3] 隔离环境运行 (无 Python, 空 APPDATA)")
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

    cfg = os.path.join(ISO_APPDATA, "JIG Data Finder", "config.json")
    check("隔离环境初始无配置文件", not os.path.exists(cfg))

    subprocess.Popen([EXE], env=env)

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
        check("应用在无 Python 环境启动", False, "30 秒内未连上 CDP")
        subprocess.run(["taskkill", "/F", "/IM", "jig-data-finder.exe"], capture_output=True)
        print(f"\n=== 结果: {len(failures)} 项失败 ===\n")
        sys.exit(1)

    check("应用在无 Python 环境启动", True)

    # 功能检查
    check("空状态渲染", bool(cdp.ev("!!document.querySelector('.empty__title')")))
    check("四个标签页", cdp.ev("document.querySelectorAll('.tab').length") == 4)
    check("输入框就绪", bool(cdp.ev("!!document.querySelector('.side__input')")))
    check("样式表已加载",
          "Segoe UI" in str(cdp.ev("getComputedStyle(document.body).fontFamily")),
          str(cdp.ev("getComputedStyle(document.body).fontFamily"))[:50])
    check("查询按钮初始禁用", cdp.ev("document.querySelector('.btn--tall')?.disabled") is True)

    # 首启应自动写入默认配置 (与旧版 AppConfig.load 行为一致)
    for _ in range(10):
        if os.path.exists(cfg):
            break
        time.sleep(0.5)
    check("首启自动创建配置文件", os.path.exists(cfg))
    if os.path.exists(cfg):
        with open(cfg, encoding="utf-8-sig") as f:
            saved = json.load(f)
        check("配置内容完整 (工程/尺寸映射都在)",
              "engineering_config" in saved and "jig_size_mapping" in saved,
              f"字段数={len(saved)}")
        check("键名为 snake_case (与旧版一致)",
              "table_default_row_height" in saved)

    # 加载真实样本, 验证完整数据链路
    sample = os.path.join(ROOT, "jig数据整理.xlsx")
    if os.path.exists(sample):
        import shutil as _sh
        iso_sample = os.path.join(ISO_APPDATA, "sample.xlsx")
        _sh.copy(sample, iso_sample)
        # 走隐藏的 file input —— CDP 的 setFileInputFiles 需 DOM.setFileInputFiles
        doc = cdp.send("DOM.getDocument")
        while True:
            m = cdp.recv()
            if m.get("id") == doc:
                root = m["result"]["root"]["nodeId"]
                break
        qid = cdp.send("DOM.querySelector",
                       {"nodeId": root, "selector": "input[type=file]"})
        while True:
            m = cdp.recv()
            if m.get("id") == qid:
                input_node = m["result"]["nodeId"]
                break
        cdp.send("DOM.setFileInputFiles", {"files": [iso_sample], "nodeId": input_node})

        loaded = False
        for _ in range(40):
            if cdp.ev(
                "document.querySelector('.rail')?.textContent.includes('已加载')"
            ):
                loaded = True
                break
            time.sleep(0.5)
        check("无 Python 环境可加载 Excel", loaded,
              str(cdp.ev("document.querySelector('.rail')?.textContent"))[:60])

        if loaded:
            cdp.ev("document.querySelectorAll('.tab')[3].click()")
            time.sleep(1.5)
            rows = cdp.ev("document.querySelectorAll('.grid tbody tr').length")
            check("审查页渲染出数据", (rows or 0) > 0, f"DOM 行数={rows}")
            rail = cdp.ev("document.querySelector('.rail__meta')?.textContent ?? ''")
            check("状态轨显示行数", "205" in str(rail), f"{rail!r}")

    cdp.close()
    subprocess.run(["taskkill", "/F", "/IM", "jig-data-finder.exe"], capture_output=True)

    print(f"\n=== 结果: {'全部通过' if not failures else str(len(failures)) + ' 项失败'} ===\n")
    sys.exit(0 if not failures else 1)


if __name__ == "__main__":
    main()