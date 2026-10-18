# -*- coding: utf-8 -*-
"""真机验证: 托盘开关 (tray_enabled) + 关闭窗口行为

为什么必须真机验证: 托盘图标是 GUI 层的系统对象, 单元测试和 jsdom 里的
E2E 都碰不到它; 而"点关闭会怎样"完全由 Rust 的 WindowEvent 分支决定。
这两件事只能靠真实进程 + 真实消息循环来验。

三项断言:
  1. tray_enabled=true  -> 系统托盘里多出一个图标 (用 Shell 工具栏按钮数比对)
  2. close_to_tray=true -> 点关闭后进程仍存活, 窗口被隐藏
  3. tray_enabled=false -> 图标消失, 且点关闭 = 真退出 (不会出现"打不开的僵尸")

第 3 条是最关键的安全约束: 托盘是关闭窗口后唯一的入口, 两者不能脱节。
"""

import ctypes
import ctypes.wintypes as wt
import json
import os
import shutil
import subprocess
import sys
import time

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "..", "src-tauri", "target", "debug", "jig-data-finder.exe")
APP = os.path.normpath(APP)
CONFIG_DIR = os.path.join(os.environ["APPDATA"], "JIG Data Finder")
CONFIG = os.path.join(CONFIG_DIR, "config.json")

u32 = ctypes.windll.user32
WM_CLOSE = 0x0010
TB_BUTTONCOUNT = 0x0418  # WM_USER + 24

results = []


def check(label, ok, detail=""):
    results.append((label, ok))
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f"  ({detail})" if detail else ""))


def tray_icon_count():
    """系统通知区域的图标按钮数。

    Win10 及部分 Win11: Shell_TrayWnd > TrayNotifyWnd > SysPager > ToolbarWindow32,
    其按钮数即托盘图标数 (含"显示隐藏的图标"箭头)。Win11 新版通知中心是 XAML,
    找不到该控件时返回 None 表示"测不了", 而不是假装 0。
    """
    hwnd = u32.FindWindowW("Shell_TrayWnd", None)
    if not hwnd:
        return None
    notify = u32.FindWindowExW(hwnd, 0, "TrayNotifyWnd", None)
    if not notify:
        return None
    pager = u32.FindWindowExW(notify, 0, "SysPager", None)
    if not pager:
        return None
    bar = u32.FindWindowExW(pager, 0, "ToolbarWindow32", None)
    if not bar:
        return None
    return ctypes.windll.user32.SendMessageW(bar, TB_BUTTONCOUNT, 0, 0)


def kill_app():
    subprocess.run(["taskkill", "/F", "/IM", "jig-data-finder.exe"], capture_output=True)
    time.sleep(1.5)


def app_alive():
    r = subprocess.run(["tasklist", "/FI", "IMAGENAME eq jig-data-finder.exe"],
                       capture_output=True, text=True)
    return "jig-data-finder.exe" in r.stdout


def read_cfg():
    try:
        with open(CONFIG, encoding="utf-8-sig") as f:
            return json.load(f)
    except Exception:
        return {}


def write_cfg(cfg):
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(CONFIG, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def main_window_handle():
    hwnd = u32.FindWindowW(None, "JIG Data Finder")
    return hwnd or 0


def launch():
    """启动应用, 返回 (进程对象, 主窗口 hwnd)。"""
    proc = subprocess.Popen([APP], cwd=os.path.dirname(APP))
    hwnd = 0
    for _ in range(40):
        time.sleep(0.5)
        hwnd = main_window_handle()
        if hwnd:
            break
    time.sleep(1.5)  # 等前端跑完并 invoke set_tray_enabled
    return proc, hwnd


def main():
    print("\n=== 真机验证: 托盘开关 + 关闭行为 ===\n")

    if not os.path.exists(APP):
        print(f"[FAIL] 找不到 {APP}, 先跑 tauri dev 编译出 debug 版")
        sys.exit(1)

    backup = read_cfg()
    baseline = tray_icon_count()
    print(f"系统托盘控件: {'可测, 当前按钮数 ' + str(baseline) if baseline is not None else '不可测 (Win11 XAML 通知中心)'}")
    print(f"测试前 close_to_tray={backup.get('close_to_tray')} tray_enabled={backup.get('tray_enabled')}\n")

    try:
        # ---- 场景 1: 托盘开 + 关闭到托盘开 -> 点关闭应隐藏, 进程存活 ----
        print("场景 1: tray_enabled=true, close_to_tray=true")
        kill_app()
        write_cfg({**backup, "tray_enabled": True, "close_to_tray": True})
        _, hwnd = launch()
        check("窗口已创建", hwnd != 0, f"hwnd={hwnd}")

        if baseline is not None:
            with_tray = tray_icon_count()
            check("托盘多出一个图标", with_tray is not None and with_tray > baseline,
                  f"{baseline} -> {with_tray}")

        u32.PostMessageW(hwnd, WM_CLOSE, 0, 0)
        time.sleep(2.5)
        alive = app_alive()
        hidden = u32.IsWindowVisible(hwnd) == 0
        check("点关闭后进程仍存活", alive)
        check("点关闭后窗口被隐藏", hidden, f"IsWindowVisible={not hidden}")
        if baseline is not None:
            check("隐藏后托盘图标仍在", tray_icon_count() >= (with_tray or 0))

        # ---- 场景 2: 托盘关 -> 图标消失, 点关闭必须真退出 ----
        print("\n场景 2: tray_enabled=false (关键安全约束)")
        kill_app()
        write_cfg({**backup, "tray_enabled": False, "close_to_tray": True})
        _, hwnd = launch()
        time.sleep(1.0)
        if baseline is not None:
            without = tray_icon_count()
            check("托盘图标已消失", without is not None and without <= baseline,
                  f"{baseline} -> {without}")

        u32.PostMessageW(hwnd, WM_CLOSE, 0, 0)
        time.sleep(3.0)
        check("托盘关闭时点 X = 真退出 (而非变僵尸)", not app_alive())

        # ---- 场景 3: close_to_tray=false + 托盘开 -> 点关闭也应真退出 ----
        # 顺带覆盖旧版遗留 bug: 旧代码无条件 prevent_close, 此时点 X 毫无反应
        print("\n场景 3: close_to_tray=false, tray_enabled=true (旧版遗留 bug 回归)")
        kill_app()
        write_cfg({**backup, "tray_enabled": True, "close_to_tray": False})
        _, hwnd = launch()
        u32.PostMessageW(hwnd, WM_CLOSE, 0, 0)
        time.sleep(3.0)
        check("关闭到托盘=关 时点 X 能真正关掉窗口", not app_alive())

    finally:
        kill_app()
        write_cfg(backup)
        print(f"\n已还原配置: close_to_tray={backup.get('close_to_tray')} tray_enabled={backup.get('tray_enabled')}")

    passed = sum(1 for _, ok in results if ok)
    print(f"\n{'=' * 46}\n{passed}/{len(results)} 项通过")
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
