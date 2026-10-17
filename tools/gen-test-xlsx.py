"""
生成 500 行的功能测试样本 xlsx, 覆盖全部 10 道工序与多个 P/N。

与 tools/gen-big-xlsx.py 的区别:
  - gen-big-xlsx.py 造 10 万行, 只为压测虚拟滚动, 数据本身无业务含义
  - 本脚本造 500 行, 数据是**有业务含义**的, 用于功能回归

设计约束 (全部来自 tools/legacy/src/ 与 src/core/ 的真实逻辑, 不是拍脑袋):
  1. 工程名必须命中 config.engineering_config 的 10 个键, 否则透视列排序
     全部退化成 order=999, 工序顺序就测不到
  2. 必须有 工程 == '50000' 的行, 否则 "生产中" 筛选 (filterProduction)
     会把整张表清空
  3. P/N 的 [6:10] 位是 validateSizeMatch 的提取区间
     (pnExtractStart=6, pnExtractLength=4), 格式必须保持 "XXXXJ-NNNNG"
     这样 4 位数字正好落在下标 6..9
  4. P/N 与型号的配对刻意一半匹配一半不匹配, 用来验证尺寸标红
  5. 少量 CST ID 留空, 触发 worker.py 逻辑1 的 "CST ID 空则用 Lot ID 补"
  6. 多数 Jig ID 需符合剪贴板正则 CJ[A-Z0-9]{8}(?!00)[0-9]{2} 或
     C4M[A-Z0-9]{9}, 否则智能粘贴提不出来; 保留少量 D8A 前缀复现真实
     导出里"存在但粘贴提取不到"的治具

运行: python tools/gen-test-xlsx.py
"""

import os

from openpyxl import Workbook

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "test-500.xlsx")

ROWS_PER_PN = 50
CST_PER_PN = 10

# (P/N, 型号, 是否应标红)
#
# 第三个字段 expect_red 的判定依据是 src/core/validate.ts 的 9 条规则:
#   1 All Size 恒匹配 / 2 空值视为匹配
#   3 取 pn[6:10]; 长度不足视为匹配
#   4 提取值被尺寸串直接包含 -> 匹配
#   5 4 位时前 2 位与后 2 位都在尺寸串 -> 匹配
#   6 "65" 特判
#   7 sizeSpecialMappings, 只有 {"65": "65/55"}
#   8 兜底: 任意连续 2 位子串出现在尺寸串 -> 匹配
#   9 否则不匹配
#
# 尺寸串来自 config.jig_size_mapping (tools/legacy/src/app/config.py:214)
PN_MODELS = [
    # --- 不标红 ---
    ("6073J-8348G", "256",   False),  # size='All Size' -> 规则1 恒匹配
    ("6073J-6565G", "184",   False),  # digits=6565, size='65' -> 规则4 命中
    ("6073J-5083G", "508",   False),  # digits=5083, size='77/48_83/48' -> 兜底 "83" 命中
    ("6861V-6567G", "477",   False),  # digits=6567, size='65' -> "65" 命中
    ("6861V-2626G", "262A",  False),  # 262A 未在映射表 -> size='' -> 规则2 视为匹配
    # --- 标红 ---
    ("6073J-5084G", "508",   True),   # digits=5084, size='77/48_83/48' -> 无 2 位子串命中
    ("6073J-2520G", "252",   True),   # digits=2520, size='65_77/27_77/42_77/48_83/48' -> 不命中
    ("6073J-4307G", "430",   True),   # digits=4307, size='65_77/48_83/48' -> 不命中
    ("6075K-5099G", "509N",  True),   # digits=5099, size='77/27_77/42_77/48_83/48' -> 不命中
    ("6075K-5021G", "502",   True),   # digits=5021, size='65' -> "50"/"02"/"21" 均不命中
]

# 工程名 -> 工程号。
#   Jig Loading 固定用 50000: pivot.ts 的生产中筛选按
#   config.productionIndicatorCode(="50000") 匹配 r['工程'], 是字符串比较,
#   靠 excel.ts 的 raw:false 把数字单元格转成字符串 "50000"。
#   另配 50600 作为同工序的第二工程号, 复现真实导出里的双编号。
ENGINEERINGS = [
    ("PNP", "9000"),
    ("Jig 洗净及检查", "9100"),
    ("Jig Loading", "50000"),
    ("Jig Loading", "50600"),
    ("Jig Unloading", "51000"),
    ("Jig N判定 另外移载", "52000"),
    ("Jig 分离", "53000"),
    ("目视Stage", "54000"),
    ("Jig 搬出待机", "8400"),
    ("Jig搬出", "55000"),
    ("Jig入库", "56000"),
]

LOT_IDS = [
    "CJE765-00A7-00", "CJE765-00A6-00", "CJE765-00A9-00",
    "CJE765-009Z-00", "CJE765-00A0-00", "CJE765-00A1-00",
    "CJE765-00A2-00", "CJE765-00A4-00", "CJE765-00A3-00",
    "CJE765-007L-00",
]

# Jig ID 前缀 -> (前缀后的字母数字位数, 是否需要再补 2 位数字尾)
#
# 剪贴板正则 (src/core/clipboard.ts):
#   CJ[A-Z0-9]{8}(?!00)[0-9]{2}   C4M[A-Z0-9]{9}
# 所以 CJ 系要给 8 位字母数字 + 2 位数字(不能是 00), C4M 系只给 9 位。
# D8A 不匹配任何一支, 是真实导出中确实存在的"提取不到"治具, 故意保留。
JIG_PREFIXES = [
    ("CJJ", 7, True),
    ("C4M", 9, False),
    ("C4M", 9, False),
    ("C4M", 9, False),
    ("D8A", 9, False),
]


def make_jig_id(seq: int) -> str:
    """造 Jig ID, 前缀轮转保证多样性。"""
    prefix, body_len, needs_tail = JIG_PREFIXES[seq % len(JIG_PREFIXES)]
    body = f"{700000 + seq * 37:0{body_len}d}"[:body_len]
    if not needs_tail:
        return prefix + body
    # 末 2 位落在 01..98, 永远不是 "00"(否则会被当成 Lot ID 排除掉)
    return prefix + body + f"{(seq % 98) + 1:02d}"


def main() -> None:
    wb = Workbook(write_only=True)
    ws = wb.create_sheet("Sheet1")
    # 列序照抄真实导出 (jig数据整理.xlsx), 末尾的 Jig状态 不能省:
    # query.ts 的 processSourceData 会按 config.jigStatusColumn
    # (="Jig状态") 过滤出 jigStatusActiveValue (="INPRODUCTION") 的行,
    # 审查页只显示这批。少了这列虽然会走 hasStatus=false 的兜底放行全部,
    # 但那样就测不到"审查页只看在产治具"这个真实业务规则。
    ws.append([
        "P/N", "Lot ID", "CST ID", "Slot No", "Jig ID",
        "Jig 对应型号", "Glass判定", "工程", "工程名", "Jig状态",
    ])

    seq = 0
    for pn_idx, (pn, model, _) in enumerate(PN_MODELS):
        csts = [f"D8CCST{500002 + pn_idx * CST_PER_PN + k}" for k in range(CST_PER_PN)]
        for i in range(ROWS_PER_PN):
            eng_name, eng_code = ENGINEERINGS[i % len(ENGINEERINGS)]
            # 每 20 行留 1 行 CST ID 为空, 触发 "CST ID 空则用 Lot ID 补"
            cst_value = None if i % 20 == 7 else csts[i % CST_PER_PN]
            ws.append([
                pn,
                LOT_IDS[i % len(LOT_IDS)],
                cst_value,
                (i % 20) + 1,
                make_jig_id(seq),
                f"{model} {model}",           # 源数据的真实格式: 型号 空格 型号
                "N" if i % 17 == 0 else "G",  # Glass 判定, 混入少量 N
                int(eng_code),
                eng_name,
                # 9 成在产, 1 成已入库 —— 审查页应只显示前者。
                # "INPRODUCTION" / "STORED" 取自 config.jigStatusActiveValue 的语境,
                # 只有前者会被 processSourceData 选中。
                "INPRODUCTION" if i % 10 != 3 else "STORED",
            ])
            seq += 1

    wb.save(OUT)
    size = os.path.getsize(OUT) / 1024
    red = sum(1 for _, _, r in PN_MODELS if r)
    print(f"written: {OUT} ({size:.1f} KB, {seq} rows)")
    print(f"  P/N  {len(PN_MODELS)} 个 ({len(PN_MODELS) - red} 不标红 / {red} 标红)")
    print(f"  工序 {len({e[0] for e in ENGINEERINGS})} 道, 工程号 {len({e[1] for e in ENGINEERINGS})} 个")


if __name__ == "__main__":
    main()