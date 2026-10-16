"""UI 截图检查 —— 验证设计方案的四个标签页渲染

一次性工具, 不属于产品代码。
运行: python tools/ui_shots.py
"""

import os
import sys

from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "shots")
URL = "http://localhost:1420"
SAMPLE = "jig数据整理.xlsx"


def main():
    os.makedirs(OUT, exist_ok=True)
    errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 800})

        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))

        page.goto(URL)
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(600)

        # 1. 空状态
        page.screenshot(path=os.path.join(OUT, "01-empty.png"))

        # 2. 通过隐藏的 file input 加载样本 (绕过 Tauri 对话框)
        sample_abs = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), SAMPLE)
        page.set_input_files("input[type=file]", sample_abs)
        page.wait_for_timeout(1200)
        page.screenshot(path=os.path.join(OUT, "02-loaded.png"))

        # 3. 输入 Jig ID 并查询
        ids = page.evaluate("""
          async () => {
            const XLSX = await import('/node_modules/.vite/deps/xlsx.js?import').catch(() => null);
            return null;
          }
        """)
        _ = ids

        # 直接从页面读取已加载的源数据不方便, 改为手工填几个已知 ID
        known = "CJJ349000910\nCJJ349000919\nCJJ356000708\nCJJ356000716\nCJEA5B001601"
        page.fill(".side__input", known)
        page.click("text=开始查询")
        page.wait_for_timeout(900)
        page.screenshot(path=os.path.join(OUT, "03-detail.png"))

        # 4. 结果透视 (含工序轨道)
        page.click(".tab >> nth=1")
        page.wait_for_timeout(500)
        page.screenshot(path=os.path.join(OUT, "04-query-pivot.png"))

        # 5. 全量透视 (含工序轨道 + 范围切换)
        page.click(".tab >> nth=2")
        page.wait_for_timeout(500)
        page.screenshot(path=os.path.join(OUT, "05-full-pivot.png"))

        # 6. 数据审查 (含尺寸校验红字)
        page.click(".tab >> nth=3")
        page.wait_for_timeout(500)
        page.screenshot(path=os.path.join(OUT, "06-review.png"))

        # 7. 设置对话框
        page.click("text=设置")
        page.wait_for_timeout(500)
        page.screenshot(path=os.path.join(OUT, "07-settings.png"))

        browser.close()

    print("shots ->", OUT)
    for f in sorted(os.listdir(OUT)):
        print("  ", f)
    if errors:
        print("\nconsole errors:")
        for e in errors[:10]:
            print("  !", e)
        sys.exit(1)


if __name__ == "__main__":
    main()