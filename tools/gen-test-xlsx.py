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
     (pnExtractStart=6, pnExtractLength=4), 格式固定为
     "XXXXJ-NNNNG" —— 前缀/数字/字母后缀三段都在白名单常量里,
     生成时逐条 assert, 保证不产出规则之外的组合
  4. P/N 与型号的配对刻意一半匹配一半不匹配, 用来验证尺寸标红。
     型号也必须是 config.jig_size_mapping 里的 key, 否则对应尺寸为空串,
     会被规则 2 判成"匹配", 标红就测不到了
  5. 少量 CST ID 留空, 触发 worker.py 逻辑1 的 "CST ID 空则用 Lot ID 补"
  6. 多数 Jig ID 需符合剪贴板正则 CJ[A-Z0-9]{8}(?!00)[0-9]{2} 或
     C4M[A-Z0-9]{9}, 否则智能粘贴提不出来; 保留少量 D8A 前缀复现真实
     导出里"存在但粘贴提取不到"的治具

运行: python tools/gen-test-xlsx.py
"""

import os
import re

from openpyxl import Workbook

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "test-500.xlsx")

ROWS_TOTAL = 500

# ---------------------------------------------------------------------------
# P/N 命名规则 (真实 MES 导出的编码规则)
#
#   <前缀>-<4 位数字><1 位字母后缀>
#     前缀   : 6072J / 6073J
#     4 位   : 6555 / 7748 / 8348 / 7727 / 7742 / 3931
#     后缀   : B C D E F G H K
#
# 这三段是**白名单**, 不是模板 —— 生成的数据只允许落在这个集合内。
# 因为 validateSizeMatch 取的正是 pn[6:10] 这 4 位 (pnExtractStart=6,
# pnExtractLength=4), 白名单一旦放开, 4 位数字取到什么值就直接决定标红结果,
# 很容易造出"规则之外"的意外组合, 让测试数据失去作为回归基准的价值。
#
# 举例: 旧版用的 "6073J-8348G" / "6075K-5099G" / "6861V-6567G" 里,
# 6075K 与 6861V 不在前缀白名单, 5099/6567/6565 不在数字白名单 ——
# 这些都是真实数据里可能出现的, 但会让测试集偏离真实编码规则。
# ---------------------------------------------------------------------------
PN_PREFIXES = ["6072J", "6073J"]
PN_DIGITS = ["6555", "7748", "8348", "7727", "7742", "3931"]
PN_SUFFIXES = ["B", "C", "D", "E", "F", "G", "H", "K"]

# 正则用于自检: 生成时逐条校验, 测试里再校验一次。
# 写成显式白名单而不是 [A-Z], 是为了让规则改动在测试里立刻暴露。
PN_RE = re.compile(
    r"^(?:%s)-(?:%s)[%s]$"
    % ("|".join(PN_PREFIXES), "|".join(PN_DIGITS), "".join(PN_SUFFIXES))
)

# ---------------------------------------------------------------------------
# 型号白名单 —— 与 config.jig_size_mapping 的 key 完全一致
#
# 为什么必须限制: 型号查不到映射时对应尺寸会是空串, 而 validateSizeMatch
# 的规则 2 把空值当作"匹配", 于是任何不在表里的型号都自动变成"不标红"。
# 一旦混进这样的型号, 测试集里就会多出一批"永远通过"的行, 红/绿比例失真,
# 标红回归也测不出问题。
#
# 因此这里逐个对照 src/core/config.ts 的 jigSizeMapping (16 个 key,
# 7 种尺寸串); test-500.test.ts 里另有一条用例独立校验这个集合,
# 将来映射表增删时能立刻发现测试数据没跟上。
# ---------------------------------------------------------------------------
HARDCODED_MODELS = [
    "184", "420A", "420B", "477", "502", "502A",
    "430", "502N", "508", "509", "508N", "509N",
    "252", "252A", "256", "262",
]

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
# 由于型号全部在映射表内, 规则 2 永远不会触发 —— 每一行都是真判定。
# 下面的红/绿是**手工推导**的, 推导依据记在每条注释里。
#
# 可推导的结论: 4 位数字里能命中 "65"/"77"/"48_83" 这类子串的组合几乎都能过
# 规则 8, 所以真正会标红的只有两类:
#   (a) 4 位数字里不含目标尺寸串的任何连续 2 位子串
#   (b) 映射出的尺寸串是 All Size 以外的短串 (如 '65'), 而数字里没有 "65"
PN_MODELS = [
    # --- 不标红 ---
    # 256/262 -> All Size -> 规则 1 恒匹配, 与数字无关
    ("6072J-3931H", "256",   False),
    ("6073J-8348K", "262",   False),
    # 430/502N -> '65_77/48_83/48'; 7742/7748 含 "77" -> 规则 8 命中
    ("6073J-7742H", "430",   False),
    ("6072J-7748K", "502N",  False),
    # 508/509 -> '77/48_83/48'; 7748 含 "77" -> 规则 8 命中
    ("6073J-7748C", "509",   False),
    # 508N/509N -> '77/27_77/42_77/48_83/48'; 7742 含 "77" -> 规则 8 命中
    ("6072J-7742E", "509N",  False),
    # 252 -> '65_77/27_77/42_77/48_83/48'; 6555 含 "65" -> 规则 8 命中
    ("6073J-6555F", "252",   False),
    # --- 标红 ---
    # 184/420A/420B/477/502/502A -> 尺寸串只有 '65';
    #   7748/7727/7742/8348/3931 的连续 2 位子串里都没有 "65" -> 全不命中
    ("6073J-7748B", "184",   True),
    ("6072J-7727C", "420A",  True),
    ("6073J-7742D", "420B",  True),
    ("6072J-8348E", "477",   True),
    ("6073J-3931F", "502",   True),
    ("6072J-7748G", "502A",  True),
    # 6555 的子串只有 65/55, 撞不上 '77/...'
    ("6073J-6555B", "508",   True),
    ("6072J-6555D", "508N",  True),
    # '39/31_77/...' 里没有 65 也没有 55
    ("6073J-6555G", "252A",  True),
]

for _pn, _model, _red in PN_MODELS:
    assert PN_RE.match(_pn), f"P/N {_pn} 不符合 {PN_PREFIXES}-{PN_DIGITS}+{PN_SUFFIXES}"
    assert _model in HARDCODED_MODELS, f"型号 {_model} 不在硬编码型号表里"

# 工程名 -> 工程号。
#   Jig Loading 固定用 50000: pivot.ts 的生产中筛选按
#   config.productionIndicatorCode(="50000") 匹配 r['工程'], 是字符串比较,
#   靠 excel.ts 的 raw:false 把数字单元格转成字符串 "50000"。
#   另配 50600 作为同工序的第二工程号, 复现真实导出里的双编号。
ENGINEERINGS = [
    ("PNP", "9000"),
    ("PNP 2nd", "09050"),
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

    # 500 行均摊到 16 个 P/N: 每组 31 行, 余下 8 行分给前 8 组。
    # 每组至少 31 行是为了能覆盖 ENGINEERINGS 里全部 12 个工程名/号组合
    # (循环取模, 11 个一组), 否则某个工序会整组缺失。
    n = len(PN_MODELS)
    base, extra = divmod(ROWS_TOTAL, n)

    seq = 0
    for pn_idx, (pn, model, _) in enumerate(PN_MODELS):
        rows_here = base + (1 if pn_idx < extra else 0)
        # 每个 P/N 4 个 CST: 31 行 -> 每 CST 约 8 行, 足够让透视出现小计行
        cst_n = 4
        csts = [f"D8CCST{500002 + pn_idx * cst_n + k}" for k in range(cst_n)]
        for i in range(rows_here):
            eng_name, eng_code = ENGINEERINGS[i % len(ENGINEERINGS)]
            # 每 20 行留 1 行 CST ID 为空, 触发 "CST ID 空则用 Lot ID 补"
            cst_value = None if i % 20 == 7 else csts[i % cst_n]
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