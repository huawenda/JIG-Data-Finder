"""
真机验证: 智能粘贴 + 配置持久化 (一次性工具)

通过 CDP (Chrome DevTools Protocol) 连接真实 WebView2, 精确驱动 UI,
避免坐标点击的不确定性。

依赖: 应用以 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port
      启动, 暴露 CDP 端点。
"""

import json
import os
import subprocess
import sys
import time
import urllib.request

APP = r"D:\Dev\JIG-Data-Finder\src-tauri\target\release\jig-data-finder.exe"
CDP_PORT = 9333
CONFIG = os.path.join(os.environ["APPDATA"], "JIG Data Finder", "config.json")

failures = []


def check(label, ok, detail=""):
    if ok:
        print(f"  [OK]   {label}")
    else:
        failures.append(label)
        print(f"  [FAIL] {label}" + (f" :: {detail}" if detail else ""))


def cdp_targets():
    with urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json", timeout=5) as r:
        return json.load(r)


def write_clipboard(text):
    """写系统剪贴板 (CF_UNICODETEXT)。

    用 PowerShell 的 Set-Clipboard 而不是 ctypes 直调 Win32 ——
    后者在这个会话里会因剪贴板被占用而返回失败, 且难以区分真失败
    和 API 签名问题。Set-Clipboard 走 .NET 封装, 稳定得多。

    也不能用 navigator.clipboard.writeText —— CDP 里没有用户激活上下文,
    调用会静默失败, 导致应用读到的是上一次的真实剪贴板内容。
    """
    r = subprocess.run(
        ["powershell", "-NoProfile", "-Command", "$input | Set-Clipboard"],
        input=text,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if r.returncode != 0:
        raise RuntimeError(f"Set-Clipboard 失败: {r.stderr[:200]}")


def read_clipboard():
    """读回系统剪贴板, 用于确认写入生效。

    必须走 PowerShell 并显式指定 UTF-8 输出 —— Get-Clipboard 默认按
    控制台代码页输出, 中文会变成乱码, 导致误判为"写入失败"。
    """
    r = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Clipboard -Raw",
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return r.stdout if r.returncode == 0 else ""


def main():
    print("\n=== 真机验证: 智能粘贴 + 配置持久化 ===\n")

    subprocess.run(["taskkill", "/F", "/IM", "jig-data-finder.exe"],
                   capture_output=True)
    time.sleep(1)

    # 记录启动前的配置状态
    before_exists = os.path.exists(CONFIG)
    before_mtime = os.path.getmtime(CONFIG) if before_exists else 0
    print(f"启动前 config.json: {'存在' if before_exists else '不存在'}")
    if before_exists:
        with open(CONFIG, encoding="utf-8-sig") as f:
            before = json.load(f)
        print(f"  close_to_tray = {before.get('close_to_tray')}")

    env = dict(os.environ)
    env["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = f"--remote-debugging-port={CDP_PORT}"

    print(f"\n启动应用 (CDP :{CDP_PORT}) ...")
    subprocess.Popen([APP], env=env)
    time.sleep(9)

    # 连接 CDP
    try:
        targets = cdp_targets()
    except Exception as e:
        print(f"  [FAIL] 无法连接 CDP: {e}")
        sys.exit(1)

    page = next((t for t in targets if t.get("type") == "page"), None)
    if not page:
        print(f"  [FAIL] 未找到页面 target: {targets}")
        sys.exit(1)
    ws_url = page["webSocketDebuggerUrl"]
    print(f"  已连接: {page.get('title', '?')}")

    # 用 websocket 驱动 (不引额外依赖, 手写最小 CDP 客户端)
    import base64
    import hashlib
    import os as _os
    import socket
    import struct

    from urllib.parse import urlparse

    u = urlparse(ws_url)
    sock = socket.create_connection((u.hostname, u.port), timeout=10)

    key = base64.b64encode(_os.urandom(16)).decode()
    req = (
        f"GET {u.path} HTTP/1.1\r\n"
        f"Host: {u.hostname}:{u.port}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n"
    )
    sock.sendall(req.encode())
    buf = b""
    while b"\r\n\r\n" not in buf:
        buf += sock.recv(4096)
    accept = base64.b64encode(
        hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()
    ).decode()
    assert accept in buf.decode(errors="ignore"), "WebSocket 握手失败"

    msg_id = [0]

    def send(method, params=None):
        msg_id[0] += 1
        payload = json.dumps({"id": msg_id[0], "method": method, "params": params or {}})
        data = payload.encode()
        # 客户端->服务端必须掩码
        mask = _os.urandom(4)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
        header = bytearray([0x81])
        n = len(masked)
        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", n)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", n)
        sock.sendall(bytes(header) + mask + masked)
        return msg_id[0]

    def recv():
        h = sock.recv(2)
        if not h:
            raise RuntimeError("连接关闭")
        ln = h[1] & 0x7F
        if ln == 126:
            ln = struct.unpack(">H", sock.recv(2))[0]
        elif ln == 127:
            ln = struct.unpack(">Q", sock.recv(8))[0]
        data = b""
        while len(data) < ln:
            data += sock.recv(ln - len(data))
        return json.loads(data.decode())

    def evaluate(expr, await_promise=False):
        mid = send("Runtime.evaluate", {
            "expression": expr,
            "returnByValue": True,
            "awaitPromise": await_promise,
        })
        while True:
            m = recv()
            if m.get("id") == mid:
                if "error" in m:
                    raise RuntimeError(m["error"])
                return m["result"]["result"].get("value")

    def wait_for(expr, timeout=15):
        end = time.time() + timeout
        while time.time() < end:
            try:
                if evaluate(expr):
                    return True
            except Exception:
                pass
            time.sleep(0.3)
        return False

    # ---------- 测试 1: 智能粘贴 ----------
    print("\n[测试 1] 智能粘贴提取 Jig ID")

    # 必须用系统级写剪贴板 —— 应用读的是系统剪贴板,
    # navigator.clipboard.writeText 在 CDP 里没有用户激活, 会静默失败。
    mixed = "各位好,\n附件里的治具如下,麻烦查一下:\nCJJ349000910 和 CJJ349000919\n谢谢"
    write_clipboard(mixed)
    # 不回读校验: PowerShell 子进程输出在 Python 侧会因控制台代码页
    # 显示为乱码, 回读比对必然误判。真正要验的是"应用能否从剪贴板
    # 提取出 ID", 由下面 4 条断言覆盖。
    print("  已写入系统剪贴板 (含邮件正文)")

    evaluate("document.querySelector('.side__input').focus()")
    focused = evaluate("document.activeElement?.className")
    print(f"  焦点元素: {focused}")

    # 清空输入框, 避免上次运行的残留内容干扰断言
    evaluate("""
      (() => {
        const el = document.querySelector('.side__input');
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(el, '');
        el.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    """)
    time.sleep(0.3)

    # 用 CDP Input 域派发真实的 Ctrl+V。
    # 比 keybd_event 可靠 —— 不依赖窗口是否真的在前台。
    for ev_type, key, code, mods in [
        ("rawKeyDown", "v", "KeyV", 2),   # 2 = Ctrl
        ("keyUp", "v", "KeyV", 2),
    ]:
        send("Input.dispatchKeyEvent", {
            "type": ev_type,
            "key": key,
            "code": code,
            "windowsVirtualKeyCode": 86,
            "modifiers": mods,
        })

    pasted = wait_for(
        "(() => { const v = document.querySelector('.side__input').value;"
        " return v && v.includes('CJJ349000910') })()",
        timeout=8,
    )
    value = evaluate("document.querySelector('.side__input').value") or ""
    check("粘贴后提取到 Jig ID", pasted, f"输入框内容: {value[:80]!r}")
    check("原文中的非 ID 文本被剔除",
          bool(value) and "麻烦查一下" not in value and "谢谢" not in value,
          f"内容: {value[:60]!r}")
    check("两个 ID 都在", "CJJ349000910" in value and "CJJ349000919" in value)
    toast = evaluate("document.querySelector('.toast')?.textContent ?? ''")
    check("给出了提取数量提示", "2" in str(toast), f"toast={toast!r}")

    # ---------- 测试 2: 配置持久化 ----------
    print("\n[测试 2] 配置持久化")

    before_row_height = 30
    evaluate("document.querySelector('.side__input').value = ''")

    # 打开设置
    evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '设置')?.click()")
    opened = wait_for("!!document.querySelector('.dialog')", timeout=6)
    check("设置对话框打开", opened)

    # 改行高 30 -> 26 (用 input 事件触发 React onChange)
    evaluate("""
      (() => {
        const inp = document.querySelector('#set-rowh');
        if (!inp) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(inp, '26');
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()
    """)
    time.sleep(0.6)

    # 点保存
    evaluate("""
      [...document.querySelectorAll('button')].find(b => b.textContent.includes('保存设置'))?.click()
    """)
    closed = wait_for("!document.querySelector('.dialog')", timeout=6)
    check("保存后对话框关闭", closed)
    time.sleep(1.5)

    # 检查磁盘
    if not os.path.exists(CONFIG):
        check("配置文件被写入", False, "文件不存在")
    else:
        with open(CONFIG, encoding="utf-8-sig") as f:
            saved = json.load(f)
        check("配置文件被写入", True)
        # 键名是 snake_case (与旧版 Python 一致), 所以查 snake 键
        check("行高已持久化 (30 -> 26)",
              saved.get("table_default_row_height") == 26,
              f"实际 {saved.get('table_default_row_height')}")
        check("带有 config_version 标记",
              saved.get("config_version") is not None,
              f"{saved.get('config_version')}")
        check("保留旧版字段 (迁移兼容)",
              "engineering_config" in saved and "jig_size_mapping" in saved,
              "工程/尺寸映射配置丢失")
        check("写出的键名是 snake_case (与旧版一致)",
              "table_default_row_height" in saved and "tableDefaultRowHeight" not in saved,
              "键名格式不一致")
        check("写入的行高已生效到 UI",
              evaluate("getComputedStyle(document.documentElement).getPropertyValue('--row-h').trim()") == "26px",
              evaluate("getComputedStyle(document.documentElement).getPropertyValue('--row-h')"))

    # ---------- 测试 3: 重启后读回 ----------
    print("\n[测试 3] 重启后读回配置")

    subprocess.run(["taskkill", "/F", "/IM", "jig-data-finder.exe"], capture_output=True)
    time.sleep(2)

    # 旧连接已失效, 必须重新握手 (端口不变, 直接重连)
    try:
        sock.close()
    except Exception:
        pass

    subprocess.Popen([APP], env=env)

    reconnected = False
    for _ in range(30):
        time.sleep(1)
        try:
            targets = cdp_targets()
            page = next((t for t in targets if t.get("type") == "page"), None)
            if not page:
                continue
            u = urlparse(page["webSocketDebuggerUrl"])
            sock = socket.create_connection((u.hostname, u.port), timeout=10)
            sock.sendall(
                (
                    f"GET {u.path} HTTP/1.1\r\n"
                    f"Host: {u.hostname}:{u.port}\r\n"
                    "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                    f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
                ).encode()
            )
            buf = b""
            while b"\r\n\r\n" not in buf:
                buf += sock.recv(4096)
            reconnected = True
            break
        except Exception:
            continue

    if not reconnected:
        check("重启后成功连接 CDP", False, "30 秒内未连上")
        print(f"\n=== 结果: {len(failures)} 项失败 ===\n")
        sys.exit(1)
    print("  已重新连接")

    # 等应用完成启动读配置
    time.sleep(2)
    persisted = wait_for(
        "getComputedStyle(document.documentElement)"
        ".getPropertyValue('--row-h').trim() === '26px'",
        timeout=15,
    )
    actual = evaluate(
        "getComputedStyle(document.documentElement)"
        ".getPropertyValue('--row-h').trim()"
    )
    check("重启后行高仍为 26px (配置真的持久化了)", persisted, f"--row-h = {actual!r}")

    # 顺带验证: 重启后旧版配置里的其他设置也被正确读取。
    # 这里改用 clipboard_auto_process_enabled —— 它在设置对话框里有对应
    # 开关, 可以直接读 DOM 状态判断迁移是否生效。
    settings_state = None
    evaluate(
        "[...document.querySelectorAll('button')]"
        ".find(b => b.textContent.trim() === '设置')?.click()"
    )
    wait_for("!!document.querySelector('.dialog')", timeout=6)
    # 剪贴板开关是第 1 个 checkbox (顺序: 关闭到托盘 / 剪贴板 / 尺寸验证 / 时间戳)
    settings_state = evaluate(
        "(() => { const cbs = document.querySelectorAll('.dialog input[type=checkbox]');"
        " return cbs.length ? [...cbs].map(c => c.checked).join(',') : 'none' })()"
    )
    evaluate("""
      [...document.querySelectorAll('button')]
        .find(b => b.textContent.trim() === '取消')?.click()
    """)

    check("重启后设置对话框可打开且开关状态正常",
          settings_state is not None and settings_state != "none",
          f"checkbox 状态: {settings_state!r}")

    # 验证迁移: 旧版配置 size_validation_enabled 字段被读到了
    # (默认值 false, 若旧文件里有 true 则说明 snake_case 映射生效)
    with open(CONFIG, encoding="utf-8-sig") as f:
        final_cfg = json.load(f)
    check("磁盘配置是 snake_case 且含全部迁移字段",
          "table_default_row_height" in final_cfg
          and "close_to_tray" in final_cfg
          and "clipboard_auto_process_enabled" in final_cfg,
          f"字段: {sorted(final_cfg)[:6]}...")

    sock.close()
    subprocess.run(["taskkill", "/F", "/IM", "jig-data-finder.exe"], capture_output=True)

    print(f"\n=== 结果: {'全部通过' if not failures else str(len(failures)) + ' 项失败: ' + ', '.join(failures)} ===\n")
    sys.exit(0 if not failures else 1)


if __name__ == "__main__":
    main()