"""
合成一个 10 万行的 xlsx, 用于虚拟滚动压力测试

一次性工具, 不属于产品代码。
运行: python tools/gen-big-xlsx.py
"""

import os

from openpyxl import Workbook

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "big-test.xlsx")
ROWS = 100_000

wb = Workbook(write_only=True)
ws = wb.create_sheet("Sheet1")

ws.append([
    "P/N", "Lot ID", "CST ID", "Slot No", "Jig ID",
    "Jig 对应型号", "Glass判定", "工程", "工程名", "Jig状态",
])

models = ["A01", "A12", "252", "256", "262"]
stages = ["PNP", "Jig Loading", "Jig 搬出待机"]
engs = ["8400", "9000", "50000"]

for i in range(ROWS):
    ws.append([
        f"6073J-{8000 + (i % 50)}G",
        f"CJE765-{i % 9000:04d}-00",
        f"D8CCST{500000 + (i % 1200)}",
        str((i % 20) + 1),
        f"CJ{i:010d}",
        models[i % len(models)],
        "N" if i % 7 == 0 else "G",
        engs[i % len(engs)],
        stages[i % len(stages)],
        "INPRODUCTION",
    ])

wb.save(OUT)
print(f"written: {OUT} ({os.path.getsize(OUT) / 1024 / 1024:.1f} MB, {ROWS} rows)")