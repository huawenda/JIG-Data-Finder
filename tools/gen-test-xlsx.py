"""
生成 500 行的功能测试样本 xlsx, 覆盖全部工序与严格 4 位尺寸匹配。

与 tools/gen-big-xlsx.py 的区别:
  - gen-big-xlsx.py 造 10 万行, 只为压测虚拟滚动, 数据本身无业务含义
  - 本脚本造 500 行, 数据是**有业务含义**的, 用于功能回归

## 两份输出 / 两页工作表

生成的 `test-500.xlsx` 是一个**可自测的 Excel**, 共两页:

  1. 源数据   500 行 x 10 列, 列序与真实导出完全一致
              -> 程序只读第一页, 直接拖进软件即可
  2. 期望结果 500 行逐行标注"该红还是该绿"以及原因
              -> 跑完程序后对照审查页, 红绿不一致就说明规则有问题

第二页是**给人看的**, 程序不会读。它的判定文字只是说明性副本,
真相来源仍是 `src/core/validate.ts`; 生成时会断言这份推导与分组声明一致,
否则说明文字会骗人。

另有 `tests/fixtures/jig-exceptions.json` (进仓库), 供自动化测试读取
每行期望红绿与分组意图。`test-500.xlsx` 本身被 `.gitignore` 的 `*.xlsx` 排除。

## 用法

    python tools/gen-test-xlsx.py

只生成文件, 不碰用户配置。

## 设计约束 (全部来自 src/core/ 的真实逻辑与现场事实, 不是拍脑袋)

  1. 工程名必须命中 config.engineering_config 的 11 个键, 否则透视列排序
     全部退化成 order=999, 工序顺序就测不到
  2. 必须有 工程 == '50000' 的行, 否则 "生产中" 筛选 (filterProduction)
     会把整张表清空
  3. P/N 的 [6:10] 位是 validateSizeMatch 的提取区间
     (pnExtractStart=6, pnExtractLength=4)。编码规则见 `PN_RULES`:
     **尺寸码决定前缀与可用后缀**, 不是三段自由组合
  4. 型号必须是 config.jig_size_mapping 里的 key, 否则对应尺寸为空串,
     会被规则 2 判成"匹配", 标红就测不到了
  5. 装载必须符合现场: 40 个 CST (D8CCST500001–500040), 每个 20 层,
     **一层一块 JIG**, 一个 CST 只走一道工序、只服务一个 P/N。
     **LOT 不能为空, CST 可以为空** —— 但 CST 为空只允许出现在 JIG Loading
     (LOT 尚未上载, 脱离载体存在), 其他工程必须绑定 CST。
  6. 多数 Jig ID 需符合剪贴板正则, 否则智能粘贴提不出来; 保留少量 D8A
     前缀复现真实导出里"存在但粘贴提取不到"的 JIG

## 分组方式: 一组 = 一个 CST

现场的装载单位就是 CST —— 一个 CST 固定 20 层, 同一个 CST 里的 JIG
走同一道工序、服务同一个 P/N。所以一组就是**一个 CST 的 20 层**,
组内 P/N / Lot / 工程恒定, 只有 slot 与 JIG ID 在变。

25 个 CST × 20 层 = 500 行; 现场共 40 个 CST, 这里用前 25 个 (不是满载)。
这样 (CST, Slot) 天然唯一, 不会出现"一个槽位塞三块板"这种物理上
不可能的数据 —— 早期版本按 (P/N, 型号) 摊行, 就造出过这种数据。

期望标红仍由 (型号, P/N 尺寸码) 决定: 型号的尺寸串里有这个码 -> 绿,
没有 -> 红。六个码每个都安排了红绿两侧。
"""

import json
import os
import re

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "test-500.xlsx")
FIXTURE = os.path.join(ROOT, "tests", "fixtures", "jig-exceptions.json")

ROWS_TOTAL = 500

# ---------------------------------------------------------------------------
# P/N 命名规则 (车间现场编码规则, 见 docs/domain-rules.md 第四节)
#
#   <前缀>-<4 位尺寸码><1 位字母后缀>
#
# **尺寸码决定前缀与可用后缀 —— 三段不是自由组合**。比如 6555 只出现在
# 6073J 下, 7748 只出现在 6072J 下; 后缀集各码也不同, K 不在任何一个码的
# 合法后缀里。合法组合共 21 个。
#
# 为什么必须逐码校验而不是"三段分别白名单": validateSizeMatch 取的是
# pn[6:10] 这 4 位, 前缀后缀写错在界面上看不出来, 但数据已经不是现场
# 会出现的编码 —— 拿它当"生产环境模拟"就是假的。
# ---------------------------------------------------------------------------
PN_RULES = {
    "6555": ("6073J", "BCDEFGH"),
    "7748": ("6072J", "BCDEFG"),
    "8348": ("6072J", "BCFG"),
    "7727": ("6073J", "C"),
    "3931": ("6073J", "C"),
    "7742": ("6072J", "BC"),
}


def pn_is_valid(pn: str) -> bool:
    """`<前缀>-<4 位码><后缀>`, 且前缀与后缀必须与该尺寸码匹配。"""
    m = re.fullmatch(r"(6072J|6073J)-(\d{4})([A-Z])", pn)
    if not m:
        return False
    prefix, code, suffix = m.groups()
    rule = PN_RULES.get(code)
    return bool(rule) and prefix == rule[0] and suffix in rule[1]

# ---------------------------------------------------------------------------
# 型号白名单 —— 与 config.jigSizeMapping 的 key 完全一致 (16 个)
#
# 为什么必须限制: 型号查不到映射时对应尺寸会是空串, 而 validateSizeMatch
# 的规则 2 把空值当作"匹配", 于是任何不在表里的型号都自动变成"不标红"。
# ---------------------------------------------------------------------------
HARDCODED_MODELS = [
    "184", "420A", "420B", "477", "502", "502A",
    "430", "502N", "508", "509", "508N", "509N",
    "252", "252A", "256", "262",
]

# ---------------------------------------------------------------------------
# 分组 = 一个 CST (20 层, 即 20 行)
#
#   (P/N, 型号, 期望标红)
#
# 为什么按 CST 分组, 而不是按 (P/N, 型号) 摊行:
#   现场的装载单位就是 CST —— 一个 CST 固定 20 层、一层一块 JIG, 同一个
#   CST 里的 JIG 走同一道工序、服务同一个 P/N。所以一组 = 一个 CST 的
#   20 层, 组内 P/N / 工程 / Lot 恒定, 只有 slot 与 JIG ID 在变。
#   这样 (CST, Slot) 天然唯一, 也不会出现"一个槽位塞三块板"—— 那是
#   物理上不可能的数据。
#
# 25 个 CST × 20 层 = 500 行。现场共 40 个 CST (D8CCST500001–500040),
# 这里只用前 25 个, 符合"产线不是满载"的真实状态。
#
# 期望标红由 (型号, P/N 尺寸码) 决定: 型号的尺寸串里有这个码 -> 绿,
# 没有 -> 红。六个码**每个都安排了红绿两侧**, 避免某个码只测到一种结果。
#
# 规格码的取法: 尺寸串按 "_" 拆成互斥组, 每组去掉非数字字符后是 4 位数字。
#   "65/55"                            -> 6555
#   "65/55_77/48_83/48"                -> 6555, 7748, 8348
#   "77/48_83/48"                      -> 7748, 8348
#   "77/27_77/42_77/48_83/48"          -> 7727, 7742, 7748, 8348
#   "65/55_77/27_77/42_77/48_83/48"    -> 全部 6 个
#   "39/31_77/27_77/42_77/48_83/48"    -> 3931, 7727, 7742, 7748, 8348
# ---------------------------------------------------------------------------
GROUPS = [
    # ── 6555: 6073J + B..H ──
    ("6073J-6555B", "184", False),
    ("6073J-6555C", "420A", False),
    ("6073J-6555D", "430", False),
    ("6073J-6555E", "508", True),        # 508 只有 7748/8348
    ("6073J-6555F", "252A", True),       # 252A 是 39/31 + 77/83 系列
    ("6073J-6555G", "256", False),       # All Size 恒匹配
    ("6073J-6555H", "262", False),
    # ── 7748: 6072J + B..G ──
    ("6072J-7748B", "184", True),        # 184 只有 6555
    ("6072J-7748C", "430", False),
    ("6072J-7748D", "508", False),
    ("6072J-7748E", "509", False),
    ("6072J-7748F", "252", False),
    ("6072J-7748G", "502", True),
    # ── 8348: 6072J + B/C/F/G ──
    ("6072J-8348B", "420B", True),
    ("6072J-8348C", "508", False),
    ("6072J-8348F", "509", False),
    ("6072J-8348G", "184", True),
    # ── 7727: 6073J + C (单后缀) ──
    ("6073J-7727C", "420A", True),
    ("6073J-7727C", "508N", False),
    # ── 3931: 6073J + C ──
    ("6073J-3931C", "477", True),
    ("6073J-3931C", "252A", False),
    # ── 7742: 6072J + B/C ──
    ("6072J-7742B", "502A", True),
    ("6072J-7742C", "509N", False),
    # ── 复用同一个 P/N: 一个 P/N 下挂两个 CST (P/N 1:N Lot), 接近现场 ──
    ("6073J-6555B", "502N", False),
    ("6072J-8348B", "502", True),
]

# ---------------------------------------------------------------------------
# 不绑定 CST 的组 (0 起)
#
# 现场规则:**CST 可以空, LOT 不能空** —— LOT 是信息合集, 没有 LOT 的行
# 没有意义; 而 CST 只是实物载体, LOT 在 JIG Loading 阶段尚未上载时确实
# 会脱离 CST 单独存在。
#
# 这条豁免**只对 JIG Loading 工程成立**。其他工程必须与 CST 绑定,
# 因为 JIG 已经装在某个具体的 CST / 层位上, 没有载体说不通。
#
# 每组序号对应的工程由 `ENGINEERINGS[gi % 12]` 决定: gi=3 与 gi=4 正好
# 是 Jig Loading 的两个工程号 (50000 / 50600)。main() 里有 assert 兜住
# "被豁免的组必须是 Jig Loading", 改 GROUPS 顺序时会被立刻拦住。
# ---------------------------------------------------------------------------
UNBONDED_GROUPS = {3, 4}

# 工程名 -> 工程号。
#   Jig Loading 固定用 50000: pivot.ts 的生产中筛选按
#   config.productionIndicatorCode(="50000") 匹配 r['工程'], 是字符串比较。
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

# ---------------------------------------------------------------------------
# 装载规模 —— 现场事实, 不是随手定的数 (见 docs/domain-rules.md 第三节)
#
#   现场共 40 个 CST: D8CCST500001 – D8CCST500040
#   每个 CST 固定 20 层 (slot 1–20), 一层一块 JIG
#   产线容量 = 40 × 20 = 800 位
#
# 本文件用前 25 个 CST 造 500 行: 既保持在 40 个的上限内, 又不假装产线
# 满载。CST 与 Lot 一一对应 (Lot 是信息侧的管理单元, CST 是实物载体)。
# ---------------------------------------------------------------------------
SLOTS_PER_CST = 20
CST_BASE = 500001
CST_TOTAL_ON_SITE = 40


def make_cst(seq: int) -> str:
    """第 seq 个 CST (0 起), 形如 D8CCST500001。"""
    return f"D8CCST{CST_BASE + seq:06d}"


def make_lot(seq: int) -> str:
    """第 seq 个 Lot, 与 CST 一一对应。

    形如 CJE765-00A7-00, 中段用十六进制序号, 与真实导出同形 (不含中文/小写)。
    """
    return f"CJE765-{0x00A0 + seq:04X}-00"

# Jig ID 前缀 -> (前缀后的字母数字位数, 是否需要再补 2 位数字尾)
#
# 剪贴板正则 (src/core/clipboard.ts):
#   CJ[A-Z0-9]{8}(?!00)[0-9]{2}   C4M[A-Z0-9]{9}
# D8A 不匹配任何一支, 是真实导出中确实存在的"提取不到"JIG, 故意保留。
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


# ---------------------------------------------------------------------------
# 型号 -> 尺寸串: src/core/config.ts 的说明性副本
#
# **只用于给 Excel 的"期望结果"页生成原因文字**, 不参与任何判定。
# 真相来源仍是 TS 侧的 jigSizeMapping; main() 里有断言保证两份推导一致,
# 所以即使这里写错也会在生成时炸出来, 不会悄悄产出一份骗人的说明表。
# ---------------------------------------------------------------------------
ALL_SIZE_VALUE = "All Size"
JIG_SIZE_MAPPING = {
    "184": "65/55", "420A": "65/55", "420B": "65/55",
    "477": "65/55", "502": "65/55", "502A": "65/55",
    "430": "65/55_77/48_83/48", "502N": "65/55_77/48_83/48",
    "508": "77/48_83/48", "509": "77/48_83/48",
    "508N": "77/27_77/42_77/48_83/48",
    "509N": "77/27_77/42_77/48_83/48",
    "252": "65/55_77/27_77/42_77/48_83/48",
    "252A": "39/31_77/27_77/42_77/48_83/48",
    "256": ALL_SIZE_VALUE, "262": ALL_SIZE_VALUE,
}


def size_codes(size: str) -> list[str]:
    """尺寸串 -> 4 位规格码。

    按 "_" 拆互斥组, 每组去掉非数字字符, 恰好 4 位才算一个规格码。
    `65/55` -> 6555, 与 P/N 第 7~10 位是同一套编码, 只差分隔符。
    """
    codes: list[str] = []
    for group in size.split("_"):
        digits = re.sub(r"\D", "", group)
        if len(digits) == 4:
            codes.append(digits)
    return codes


def judge(model: str, pn: str) -> "tuple[bool, str]":
    """返回 (该不该标红, 原因)。仅用于生成说明文字。"""
    size = JIG_SIZE_MAPPING.get(model, "")
    if not size:
        return False, "型号不在映射表, 对应尺寸为空, 空值视为匹配"
    if size == ALL_SIZE_VALUE:
        return False, f"型号 {model} 是 All Size, 无论 P/N 都匹配"
    if len(pn) < 10:
        return False, "P/N 不足 10 位, 取不到尺寸码, 视为匹配"
    code = pn[6:10]
    codes = size_codes(size)
    if code in codes:
        return False, f"匹配：尺寸码 {code} 在 {model} 的规格 {', '.join(codes)} 内"
    return True, f"不匹配：尺寸码 {code} 不在 {model} 的规格 {', '.join(codes)} 内"


# 源数据表头 —— 列序照抄真实导出 (jig数据整理.xlsx)。
# 末尾的 Jig状态 不能省: query.ts 的 processSourceData 会按
# config.jigStatusColumn(="Jig状态") 过滤出 jigStatusActiveValue
# (="INPRODUCTION") 的行, 审查页只显示这批。
SOURCE_HEADERS = [
    "P/N", "Lot ID", "CST ID", "Slot No", "Jig ID",
    "Jig 对应型号", "Glass判定", "工程", "工程名", "Jig状态",
]

HEADER_FILL = PatternFill("solid", fgColor="FFE6ECEF")
HEADER_FONT = Font(bold=True, color="FF1B2A32")
RED_FILL = PatternFill("solid", fgColor="FFFBE0DD")


def style_sheet(ws, widths: "dict[str, int]") -> None:
    """表头加粗铺底、冻结首行、开筛选、按列宽排好。"""
    for cell in ws[1]:
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center")
    for col, w in widths.items():
        ws.column_dimensions[col].width = w
    ws.freeze_panes = "A2"
    if ws.max_row > 1:
        ws.auto_filter.ref = ws.dimensions


def main() -> None:
    # ------------------------------------------------------------------
    # 1. 全量自检 —— 宁可不产出, 也不产出错数据
    # ------------------------------------------------------------------
    expected_rows = len(GROUPS) * SLOTS_PER_CST
    assert expected_rows == ROWS_TOTAL, (
        f"{len(GROUPS)} 组 × {SLOTS_PER_CST} 层 = {expected_rows} 行, 应为 {ROWS_TOTAL}"
    )
    assert len(GROUPS) <= CST_TOTAL_ON_SITE, (
        f"用到 {len(GROUPS)} 个 CST, 超过现场总数 {CST_TOTAL_ON_SITE}"
    )

    for pn, model, _red in GROUPS:
        assert pn_is_valid(pn), f"P/N {pn} 不符合现场编码规则 (前缀/后缀须与该码匹配)"
        assert model in HARDCODED_MODELS, f"型号 {model} 不在白名单"

    # 只有 Jig Loading 允许 LOT 脱离 CST —— 豁免写错了会被这里拦住
    for gi in UNBONDED_GROUPS:
        eng = ENGINEERINGS[gi % len(ENGINEERINGS)][0]
        assert eng == "Jig Loading", (
            f"第 {gi + 1} 组是「{eng}」, 只有 Jig Loading 允许 CST 为空"
        )

    # ------------------------------------------------------------------
    # 2. 逐组生成行 —— 一组 = 一个 CST 的 20 层
    # ------------------------------------------------------------------
    generated = 0                      # 生成 ID 的序号
    all_ids: set[str] = set()
    seen_slots: set[tuple[str, int]] = set()
    groups_meta: list[dict] = []
    records: list[dict] = []

    for gi, (pn, model, expect_red) in enumerate(GROUPS):
        cst = make_cst(gi)
        lot = make_lot(gi)
        eng_name, eng_code = ENGINEERINGS[gi % len(ENGINEERINGS)]
        name = f"{gi + 1:02d}-{model}-{pn[6:10]}"

        # LOT 是否挂在这台 CST 上。挂不上时整组 CST 列留空 (不是个别行),
        # 因为"脱离 CST"是 LOT 级别的状态, 不是某一层 JIG 的特例。
        bonded = gi not in UNBONDED_GROUPS
        cst_cell = cst if bonded else None
        # (CST, Slot) 的唯一性以**回填后的载体**为准: 空 CST 会被 pivot.ts
        # 用 Lot ID 回填, 所以两组未绑定的 LOT 不会互相撞车。
        carrier = cst if bonded else lot

        # 说明表的推导必须与分组声明一致, 否则 Excel 会骗人
        red, reason = judge(model, pn)
        assert red == expect_red, (
            f"[{name}] 推导 {red} != 声明 {expect_red} —— {reason}"
        )

        jig_ids: list[str] = []
        for slot in range(1, SLOTS_PER_CST + 1):
            jig_id = make_jig_id(generated)
            generated += 1

            assert jig_id not in all_ids, f"Jig ID 重复: {jig_id}"
            all_ids.add(jig_id)
            jig_ids.append(jig_id)

            # 一层一块 JIG —— 这是物理约束, 不是风格问题
            assert (carrier, slot) not in seen_slots, f"({carrier}, slot {slot}) 重复"
            seen_slots.add((carrier, slot))

            records.append({
                "P/N": pn,
                "Lot ID": lot,
                "CST ID": cst_cell,
                "Slot No": slot,
                "Jig ID": jig_id,
                "Jig 对应型号": f"{model} {model}",   # 真实格式: 型号 空格 型号
                "Glass判定": "N" if slot % 17 == 0 else "G",
                "工程": int(eng_code),
                "工程名": eng_name,
                # 9 成在产, 1 成已入库 —— 审查页只显示前者
                "Jig状态": "INPRODUCTION" if slot % 10 != 3 else "STORED",
                # 以下字段只给期望结果页用, 不写进源数据
                "_model": model,
                "_red": red,
                "_reason": reason,
            })

        groups_meta.append({
            "name": name,
            "cst": cst if bonded else "",
            "lot": lot,
            "pn": pn,
            "model": model,
            "engineering": eng_name,
            "rows": SLOTS_PER_CST,
            "bonded": bonded,
            "expectRed": expect_red,
            "jigIds": jig_ids,
        })

    assert len(records) == ROWS_TOTAL, f"实际生成 {len(records)} 行"
    assert len(all_ids) == ROWS_TOTAL, f"Jig ID 实际 {len(all_ids)} 个"

    # 收尾自检: LOT 永远不能空; CST 为空只允许出现在 Jig Loading
    for r in records:
        assert r["Lot ID"], f"{r['Jig ID']} 的 Lot ID 为空 —— LOT 是信息合集, 空则无意义"
        if not r["CST ID"]:
            assert r["工程名"] == "Jig Loading", (
                f"{r['Jig ID']} 在「{r['工程名']}」却缺 CST —— "
                "只有 Jig Loading 允许 LOT 脱离 CST"
            )

    # ------------------------------------------------------------------
    # 3. 写 Excel —— 两页, 程序只读第一页
    # ------------------------------------------------------------------
    wb = Workbook()

    ws_src = wb.active
    ws_src.title = "源数据"
    ws_src.append(SOURCE_HEADERS)
    for r in records:
        ws_src.append([r[h] for h in SOURCE_HEADERS])
    style_sheet(ws_src, {
        "A": 14, "B": 17, "C": 15, "D": 8, "E": 14,
        "F": 12, "G": 10, "H": 9, "I": 20, "J": 14,
    })

    # 第二页: 逐行答案。标红的整行铺淡红底, 扫一眼就能数出该红多少行。
    ws_exp = wb.create_sheet("期望结果")
    ws_exp.append([
        "#", "JIG ID", "型号", "P/N", "对应尺寸（映射值）", "期望标记", "原因",
    ])
    for n, r in enumerate(records, 1):
        model = r["_model"]
        ws_exp.append([
            n,
            r["Jig ID"],
            model,
            r["P/N"],
            JIG_SIZE_MAPPING.get(model, ""),
            "红" if r["_red"] else "不红",
            r["_reason"],
        ])
        if r["_red"]:
            for cell in ws_exp[ws_exp.max_row]:
                cell.fill = RED_FILL
    style_sheet(ws_exp, {
        "A": 5, "B": 15, "C": 7, "D": 14, "E": 34, "F": 9, "G": 54,
    })

    wb.save(OUT)

    # ------------------------------------------------------------------
    # 4. 导出测试夹具
    # ------------------------------------------------------------------
    fixture = {
        "_note": (
            "由 tools/gen-test-xlsx.py 生成, 勿手改。"
            "groups 记录了每组的构造意图(期望红绿), 测试据它断言, "
            "因此期望值不是从被测代码推出来的。"
        ),
        "rowCount": ROWS_TOTAL,
        "pnList": sorted({g["pn"] for g in groups_meta}),
        "groups": groups_meta,
    }
    os.makedirs(os.path.dirname(FIXTURE), exist_ok=True)
    with open(FIXTURE, "w", encoding="utf-8") as f:
        json.dump(fixture, f, ensure_ascii=False, indent=1)
        f.write("\n")

    # ------------------------------------------------------------------
    # 5. 摘要
    # ------------------------------------------------------------------
    size = os.path.getsize(OUT) / 1024
    red_groups = [g for g in groups_meta if g["expectRed"]]
    red_rows = sum(1 for r in records if r["_red"])
    pn_count = len({g["pn"] for g in groups_meta})
    cst_count = len({g["cst"] for g in groups_meta if g["cst"]})
    lot_count = len({g["lot"] for g in groups_meta})
    print(f"written: {OUT} ({size:.1f} KB)")
    print(f"         2 页: 源数据 {len(records)} 行 / 期望结果 {len(records)} 行")
    print(f"         {FIXTURE} ({len(groups_meta)} 组)")
    print(f"  装载   {cst_count} 个 CST x {SLOTS_PER_CST} 层 = {len(records)} 行"
          f" (现场共 {CST_TOTAL_ON_SITE} 个 CST, 未满载)")
    print(f"  Lot    {lot_count} 个 (与 CST 一一对应); "
          f"{len(UNBONDED_GROUPS)} 个 LOT 脱离 CST (Jig Loading)")
    print(f"  P/N    {pn_count} 个, 全部符合现场编码规则")
    print(f"  分组   {len(groups_meta)} 组 "
          f"({len(red_groups)} 组标红 / {len(groups_meta) - len(red_groups)} 组不标红)")
    print(f"  红绿   共 {len(records)} 行, 应标红 {red_rows} / 应不红 {len(records) - red_rows}")
    print(f"  工序   {len({e[0] for e in ENGINEERINGS})} 道, "
          f"工程号 {len({e[1] for e in ENGINEERINGS})} 个")
    # 透视表行数 = 不同 P/N 小计行 + 不同 (P/N, CST) 明细行 + 1 总计
    combos = len({(g["pn"], g["cst"]) for g in groups_meta})
    print(f"  透视   预计 {pn_count} + {combos} + 1 = {pn_count + combos + 1} 行")


if __name__ == "__main__":
    main()
