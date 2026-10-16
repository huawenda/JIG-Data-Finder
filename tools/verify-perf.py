"""
大文件虚拟滚动压力验证 (一次性工具)

用 10 万行的真实 xlsx 走完整链路: 选文件 -> 解析 -> 虚拟表格渲染,
测量耗时与 DOM 节点数, 确认虚拟化真正生效。

运行: 先 npm run build, 再 python tools/verify-perf.py
"""

import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
BIG = os.path.join(ROOT, "big-test.xlsx")
PORT = 1421

if not os.path.exists(os.path.join(DIST, "index.html")):
    print("dist/ 不存在, 请先 npm run build")
    sys.exit(1)
if not os.path.exists(BIG):
    print("big-test.xlsx 不存在, 请先 python tools/gen-big-xlsx.py")
    sys.exit(1)

from playwright.sync_api import sync_playwright  # noqa: E402

MIME = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".ico": "image/x-icon",
}


def serve():
    """起一个静态服务器指向 dist/, SPA 路由一律回 index.html"""
    from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=DIST, **kw)

        def guess_type(self, path):
            ext = os.path.splitext(path)[1]
            return MIME.get(ext, "application/octet-stream")

        def log_message(self, *a):
            pass

    return ThreadingHTTPServer(("127.0.0.1", PORT), Handler)


def main():
    server = serve()
    import threading

    threading.Thread(target=server.serve_forever, daemon=True).start()
    time.sleep(0.5)

    failures = []

    def check(label, ok, detail=""):
        if ok:
            print(f"  [OK]   {label}")
        else:
            failures.append(label)
            print(f"  [FAIL] {label}" + (f" :: {detail}" if detail else ""))

    print(f"\n=== 虚拟滚动压力测试 (100,000 行) ===\n")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 800})

        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        page.goto(f"http://127.0.0.1:{PORT}")
        page.wait_for_load_state("networkidle")

        # 走真实的 <input type=file> 通道加载大文件
        t0 = time.time()
        page.set_input_files("input[type=file]", BIG)

        # 等状态轨出现"已加载"
        try:
            page.wait_for_function(
                "() => document.querySelector('.rail')?.textContent.includes('已加载')",
                timeout=120000,
            )
            loaded = True
        except Exception:
            loaded = False
        load_ms = (time.time() - t0) * 1000

        check("大文件加载成功", loaded, f"{load_ms:.0f} ms")
        print(f"  加载耗时: {load_ms:.0f} ms")

        # 切到数据审查页 (行数最多的视图)
        page.click(".tab >> nth=3")
        page.wait_for_timeout(1200)

        dom_rows = page.eval_on_selector_all(".grid__tr", "els => els.length")
        # 滚动容器是内层 .grid-scroll (外层 .grid-wrap 只画边框)
        wrap = page.query_selector(".grid-scroll")
        scroll_h = page.evaluate("(el) => el ? el.scrollHeight : 0", wrap) if wrap else 0

        print(f"  DOM 中的 <tr>: {dom_rows}")
        print(f"  滚动容器总高: {scroll_h}px\n")

        check(
            "虚拟化生效: DOM 行数远小于数据行数",
            0 < dom_rows < 200,
            f"DOM {dom_rows} 行 vs 数据 100000 行",
        )
        check("滚动容器预留了完整高度", scroll_h > 1_000_000, f"{scroll_h}px")

        # 滚动到中段, 验证行号跟随
        page.evaluate("() => { const w = document.querySelector('.grid-scroll'); w.scrollTop = w.scrollHeight / 2 }")
        page.wait_for_timeout(600)
        mid_idx = page.eval_on_selector(".grid__td--idx", "el => el ? el.textContent : ''")
        check(
            "滚动到中段后行号随之变化",
            int(mid_idx or 0) > 40000,
            f"首个行号={mid_idx}",
        )

        # 滚到底
        page.evaluate("() => { const w = document.querySelector('.grid-scroll'); w.scrollTop = w.scrollHeight }")
        page.wait_for_timeout(600)
        last_idx = page.eval_on_selector_all(
            ".grid__td--idx", "els => els.length ? els[els.length-1].textContent : ''"
        )
        check("滚到底部可见最后一行", int(last_idx or 0) >= 99_900, f"末行行号={last_idx}")

        check("全程无 JS 异常", len(errors) == 0, "; ".join(errors[:2]))

        # ---- 列对齐检查 (回归防护) ----
        # 虚拟行用 position:absolute, 脱离表格布局流程后, 浏览器不再
        # 对它应用 <colgroup> 列宽, 会导致表头与数据行列边界对不上。
        # 这个 bug 在引入虚拟滚动时就存在, 但早期验收只查"有没有数据",
        # 没查对齐, 因此漏到了生产包。这里逐列比对 x 坐标。
        #
        # 注意: 必须用浮点值比较。列宽含小数 (如 107.6px), 若先 round
        # 再比较, 各列小数部分会累积成假阳性。实测 10 万行时真实偏差
        # 为 0, 取整后却报 6px。
        drift = page.evaluate("""
        (() => {
          const ths = [...document.querySelectorAll('.grid__th')];
          const heads = ths.map(th => th.getBoundingClientRect().left);
          const rows = [...document.querySelectorAll('.grid__tr')].slice(0, 5);
          return heads.map((hx, i) => {
            const deltas = rows
              .map(tr => {
                const td = tr.querySelectorAll('.grid__td')[i];
                return td ? Math.abs(td.getBoundingClientRect().left - hx) : null;
              })
              .filter(d => d !== null);
            return deltas.length ? Math.max(...deltas) : -1;
          });
        })()
        """)
        drift = [round(d, 2) for d in (drift or []) if d >= 0]
        max_drift = max(drift) if drift else -1
        check("表头与数据行列对齐 (偏差 <= 1px)", max_drift <= 1,
              f"各列最大偏差 {drift}px")

        page.screenshot(path=os.path.join(ROOT, "docs", "shots", "92-virtual-scroll.png"))
        browser.close()

    server.shutdown()

    print(f"\n=== 结果: {'全部通过' if not failures else str(len(failures)) + ' 项失败'} ===\n")
    sys.exit(0 if not failures else 1)


if __name__ == "__main__":
    main()