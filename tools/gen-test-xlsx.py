"""
生成 500 行的功能测试样本 xlsx, 覆盖全部工序、尺寸匹配与例外对象。

与 tools/gen-big-xlsx.py 的区别:
  - gen-big-xlsx.py 造 10 万行, 只为压测虚拟滚动, 数据本身无业务含义
  - 本脚本造 500 行, 数据是**有业务含义**的, 用于功能回归

## 三份输出 / 三页工作表

生成的 `test-500.xlsx` 是一个**可自测的 Excel**, 共三页:

  1. 源数据   500 行 x 10 列, 列序与真实导出完全一致
              -> 程序只读第一页, 直接拖进软件即可
  2. 例外清单 78 条 (JIG ID / P/N / 类型 / 型号 / 是否命中)
              -> 面板里要录的就是这些, 可直接对照录入
  3. 期望结果 500 行逐行标注"该红还是该绿"以及原因
              -> 跑完程序后对照审查页, 红绿不一致就说明规则有问题

第二、三页是**给人看的**, 程序不会读。它们的判定文字只是说明性副本,
真相来源仍是 `src/core/validate.ts`; 生成时会断言这两份推导与分组声明一致,
否则说明文字会骗人。

另有 `tests/fixtures/jig-exceptions.json` (进仓库), 供自动化测试读取例外清单
与每行期望红绿。`test-500.xlsx` 本身被 `.gitignore` 的 `*.xlsx` 排除。

## 用法

    python tools/gen-test-xlsx.py                     只生成文件
    python tools/gen-test-xlsx.py --install-exceptions
                                                      同时把 78 条例外写进
                                                      本机 config.json, 之后
                                                      在软件里加载 test-500.xlsx
                                                      就能直接看到例外标红

不加参数时**绝不碰**用户配置; 加参数时会先备份成 `.bak-before-test-exceptions`,
且只改 `jig_exceptions` 一个字段。

## 设计约束 (全部来自 src/core/ 的真实逻辑与车间实际数据, 不是拍脑袋)

  1. 工程名必须命中 config.engineering_config 的 11 个键, 否则透视列排序
     全部退化成 order=999, 工序顺序就测不到
  2. 必须有 工程 == '50000' 的行, 否则 "生产中" 筛选 (filterProduction)
     会把整张表清空
  3. P/N 的 [6:10] 位是 validateSizeMatch 的提取区间
     (pnExtractStart=6, pnExtractLength=4), 格式固定为
     "XXXXJ-NNNNG" —— 前缀/数字/字母后缀三段都在白名单常量里,
     生成时逐条 assert, 保证不产出规则之外的组合
  4. 型号必须是 config.jig_size_mapping 里的 key, 否则对应尺寸为空串,
     会被规则 2 判成"匹配", 标红就测不到了
  5. 少量 CST ID 留空, 触发 "CST ID 空则用 Lot ID 补"
  6. 多数 Jig ID 需符合剪贴板正则, 否则智能粘贴提不出来; 保留少量 D8A
     前缀复现真实导出里"存在但粘贴提取不到"的治具

## 2026-10-22 重构: 引入例外对象覆盖

复盘旧版的问题: 16 个 P/N 组各自固定 (P/N, 型号), 而例外表 78 条 JIG ID
**一条都不在源数据里**, 于是 validateSizeMatch 的例外逻辑在 test-500 上
命中率为 0 —— 功能写完了也测不到。

同时旧版里 256/262 只配 3931/8348, 永远不会遇到 6555。而 256/262 恰恰是
All Size 型号 (规则 1 恒匹配), 例外规则要生效**必须穿过这条恒真分支**,
这正是最需要覆盖、也最容易写错的路径。

所以改成按**测试目的**分组, 而不是把 500 行均摊到 16 个 P/N 上:

  A 例外命中     例外的 JIG + 例外记录的 P/N   -> 应标红
  B 例外未命中   例外的 JIG + 别的 P/N         -> 应不标红 (P/N 维度精确匹配)
  C 同型号非例外 普通 JIG + 6555               -> 应不标红 (不误伤同型号)
  D 常规覆盖     13 个型号 x 严格 4 位匹配     -> 保留原有红绿覆盖

A 组同时覆盖 252 (普通型号) 与 256/262 (All Size), 三种型号的例外路径
才能区分开。

运行: python tools/gen-test-xlsx.py
"""

import json
import os
import re
import shutil
import sys
from collections import OrderedDict

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "test-500.xlsx")
EXC_XLSX = os.path.join(ROOT, "252 256 262例外.xlsx")
FIXTURE = os.path.join(ROOT, "tests", "fixtures", "jig-exceptions.json")

# 软件自己的配置目录。**不能用 tauri 的 app_data_dir()** —— 那会多套一层
# com.jigdatafinder.app, 读不到用户真实的配置。见 bridge.ts 的 configPath。
CONFIG_PATH = os.path.join(os.environ.get("APPDATA", ""), "JIG Data Finder", "config.json")

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
# ---------------------------------------------------------------------------
PN_PREFIXES = ["6072J", "6073J"]
PN_DIGITS = ["6555", "7748", "8348", "7727", "7742", "3931"]
PN_SUFFIXES = ["B", "C", "D", "E", "F", "G", "H", "K"]

# 正则用于自检: 生成时逐条校验, 测试里再校验一次。
PN_RE = re.compile(
    r"^(?:%s)-(?:%s)[%s]$"
    % ("|".join(PN_PREFIXES), "|".join(PN_DIGITS), "".join(PN_SUFFIXES))
)

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
# 分组定义
#
#   (组名, P/N, 型号, 行数, 期望标红, 例外来源)
#
# 例外来源:
#   "252"/"256"/"262" -> JIG ID 从例外表对应型号的池子里按顺序取,
#                        取到的 ID 会写进 fixture 的 exceptions,
#                        保证"源数据里有例外、配置里也配了"这一对成立
#   None              -> 用 make_jig_id 生成, 必然不在例外表里
#
# 期望标红的推导依据 (src/core/validate.ts 的规则):
#   1 All Size 恒匹配 / 2 空值视为匹配 / 3 取 pn[6:10]
#   4 严格 4 位匹配: 提取段必须精确等于尺寸串里某个规格码
#
# 规格码的取法: 尺寸串按 "_" 拆成互斥组, 每组去掉非数字字符后是 4 位数字。
#   "65/55"                            -> 6555
#   "65/55_77/48_83/48"                -> 6555, 7748, 8348
#   "77/48_83/48"                      -> 7748, 8348
#   "77/27_77/42_77/48_83/48"          -> 7727, 7742, 7748, 8348
#   "65/55_77/27_77/42_77/48_83/48"    -> 6555, 7727, 7742, 7748, 8348
#   "39/31_77/27_77/42_77/48_83/48"    -> 3931, 7727, 7742, 7748, 8348
# ---------------------------------------------------------------------------
GROUPS = [
    # ── A. 例外命中: JIG 来自例外表, P/N 与该条例外记录的 P/N 一致 ──
    #
    # 252 的规格码含 6555, 所以这几行**型号能力上是匹配的**, 标红完全由
    # 例外规则产生 —— 这是最典型的场景, 也是"例外是否真的优先于尺寸比较"
    # 的判据。
    ("exc-hit-252", "6072J-6555H", "252", 7, True, "252"),
    # 256 是 All Size (规则 1 恒匹配), 例外必须插在规则 1 之前才生效。
    # 这条路径最容易写错: 若例外判定放在 validateSizeMatch 内部、
    # 位于 All Size 分支之后, 这 45 行会全部漏掉。
    ("exc-hit-256", "6072J-6555D", "256", 45, True, "256"),
    # 262 同理, 用另一条 P/N 后缀, 避免和 256 的例外记录混在一起。
    ("exc-hit-262", "6072J-6555F", "262", 20, True, "262"),

    # ── B. 例外未命中: 治具在名单里, 但这行做的是别的 P/N ──
    #
    # 例外是 (JIG ID, P/N) 二元组, 不是"这台治具一律判红"。
    # 若实现只比 JIG ID 不比 P/N, 这 6 行会被错误标红, 这里能立刻抓住。
    # 例外记录里它们的 pn 仍是 6072J-6555D (确实做不了 6555), 但此行
    # 安排的是 7748, 256 是 All Size 所以正常匹配。
    ("exc-other-pn-256", "6073J-7748K", "256", 6, False, "256"),

    # ── C. 同型号非例外 JIG + 6555: 不能误伤 ──
    #
    # 例外只针对名单内的具体治具, 同型号其它治具照常工作。
    # 252 型号能力含 6555 -> 匹配; 256/262 是 All Size -> 匹配。
    ("plain-252-6555", "6072J-6555K", "252", 5, False, None),
    ("plain-256-6555", "6073J-6555C", "256", 6, False, None),
    ("plain-262-6555", "6072J-6555G", "262", 5, False, None),

    # ── D. 常规型号覆盖: 严格 4 位匹配的红绿 ──
    # 184/420A/420B/477/502/502A -> 只有 6555, 遇到别的码必须红
    ("184-7748", "6073J-7748B", "184", 26, True, None),
    ("420A-7727", "6072J-7727C", "420A", 26, True, None),
    ("420B-7742", "6073J-7742D", "420B", 26, True, None),
    ("477-8348", "6072J-8348E", "477", 26, True, None),
    ("502-3931", "6073J-3931F", "502", 26, True, None),
    ("502A-7748", "6072J-7748G", "502A", 26, True, None),
    # 430 的规格是 6555/7748/8348, 做不了 77宽42高。
    # 旧规则 8 的"任意连续 2 位子串"会因 "77" 存在而误判为匹配,
    # 严格 4 位匹配下正确判红 —— 这是本轮算法改造的核心案例。
    ("430-7742", "6073J-7742H", "430", 25, True, None),
    # 502N 规格含 7748 -> 匹配
    ("502N-7748", "6072J-7748K", "502N", 25, False, None),
    # 509 规格 7748/8348 -> 匹配
    ("509-7748", "6073J-7748C", "509", 25, False, None),
    # 509N 规格含 7742 -> 匹配
    ("509N-7742", "6072J-7742E", "509N", 25, False, None),
    # 508/508N 规格都不含 6555 -> 红
    ("508-6555", "6073J-6555B", "508", 25, True, None),
    ("508N-6555", "6072J-6555D", "508N", 25, True, None),
    # 252A 规格是 39/31 + 77/27 + 77/42 + 77/48 + 83/48, 不含 6555 -> 红
    ("252A-6555", "6073J-6555G", "252A", 25, True, None),
    # 252 规格含 7748 -> 匹配 (与 A 组的 6555 形成对照:
    # 同一型号, 6555 被例外判红, 7748 正常放行)
    ("252-7748", "6072J-7748H", "252", 25, False, None),
    # 256/262 是 All Size -> 恒匹配
    ("256-3931", "6073J-3931H", "256", 25, False, None),
    ("262-8348", "6073J-8348K", "262", 25, False, None),
]

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
# D8A 不匹配任何一支, 是真实导出中确实存在的"提取不到"治具, 故意保留。
JIG_PREFIXES = [
    ("CJJ", 7, True),
    ("C4M", 9, False),
    ("C4M", 9, False),
    ("C4M", 9, False),
    ("D8A", 9, False),
]

# 例外记录的档位与类型文案。
#
# 三个型号的例外都是"做不了 65/55", 所以档恒为 6555;
# 与 src/core/jigExceptions.ts 的 SIZE_FAMILIES / TYPE_BY_FAMILY 一致。
#
# 另一档 7783 覆盖 7748 / 7742 / 7727 / 8348 全部 77 与 83 宽度规格。
# 这里刻意只用 6555: A 组用 6555 命中、B 组用 7748 不命中, 两者靠"档不同"
# 区分。若改成 7783, B 组也会命中, "例外只针对指定档"就验证不了了。
EXCEPTION_TYPE = "65例外"
EXCEPTION_CODE = "6555"


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


def judge(model: str, pn: str, hit_exception: bool) -> "tuple[bool, str]":
    """返回 (该不该标红, 原因)。仅用于生成说明文字。"""
    if hit_exception:
        return True, f"例外命中：这台治具做不了 {pn}"
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
EXC_FILL = PatternFill("solid", fgColor="FFFFF6DA")


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



def load_exception_pool() -> "OrderedDict[str, list[str]]":
    """读例外表 -> 型号 -> [Jig ID], 保持表内顺序。

    这份表是车间给的权威清单, 78 条, ID 固定不变。直接读而不是抄一份到
    代码里, 是为了让"例外表改了"这件事只需要重跑脚本, 不用改两处。
    """
    if not os.path.exists(EXC_XLSX):
        raise SystemExit(f"找不到例外表: {EXC_XLSX}")

    wb = load_workbook(EXC_XLSX, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = ws.iter_rows(values_only=True)
    header = list(next(rows))
    i_id = header.index("Jig ID")
    i_model = header.index("对应型号")

    pool: "OrderedDict[str, list[str]]" = OrderedDict()
    for r in rows:
        if not r or r[i_id] is None:
            continue
        jid = str(r[i_id]).strip()
        model = str(r[i_model]).strip() if r[i_model] is not None else ""
        if not jid:
            continue
        if model not in HARDCODED_MODELS:
            raise SystemExit(f"例外表里出现未知型号 {model} (Jig ID {jid})")
        pool.setdefault(model, []).append(jid)
    wb.close()
    return pool


def install_exceptions(exceptions: list) -> None:
    """把例外清单写进本机 config.json, 供在界面里直接验收。

    **只 patch `jig_exceptions` 一个字段**, 尺寸映射、工序排序、窗口尺寸、
    托盘设置一律不动 —— 那份配置里有用户自己调过的东西, 整体覆写不可接受。

    写之前留一份 .bak 备份; 字段名用 snake_case, 与 bridge.ts 的
    writeConfigFile 一致。同时清掉可能残留的 camelCase 键 ——
    mergeConfig 优先取 camelCase, 留着重名键会让这次写入被静默忽略。
    """
    if not CONFIG_PATH or not os.path.exists(CONFIG_PATH):
        raise SystemExit(
            f"找不到配置: {CONFIG_PATH}\n"
            "先启动一次软件并随便改个设置保存, 让它生成 config.json。"
        )

    with open(CONFIG_PATH, encoding="utf-8-sig") as f:
        cfg = json.load(f)

    backup = CONFIG_PATH + ".bak-before-test-exceptions"
    shutil.copyfile(CONFIG_PATH, backup)

    before = len(cfg.get("jig_exceptions") or [])
    cfg.pop("jigExceptions", None)
    cfg["jig_exceptions"] = exceptions
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"\n  已写入 {CONFIG_PATH}")
    print(f"    jig_exceptions: {before} -> {len(exceptions)} 条")
    print(f"    原文件备份: {backup}")
    print("    重开软件后, 审查页的例外行才会按新配置标红")


def main(install: bool = False) -> None:
    # ------------------------------------------------------------------
    # 1. 先做全量自检, 任何一条不符就中止 —— 宁可不产出, 也不产出错数据
    # ------------------------------------------------------------------
    total = sum(g[3] for g in GROUPS)
    assert total == ROWS_TOTAL, f"分组行数合计 {total} != {ROWS_TOTAL}"

    for name, pn, model, count, _red, src in GROUPS:
        assert PN_RE.match(pn), f"[{name}] P/N {pn} 不符合编码规则"
        assert model in HARDCODED_MODELS, f"[{name}] 型号 {model} 不在白名单"
        assert count > 0, f"[{name}] 行数必须为正"

    pool = load_exception_pool()
    # 例外表每个型号的 ID 数必须刚好被分组用完, 否则说明计划与数据脱节
    used_per_model = {m: 0 for m in pool}
    for name, _pn, _model, _count, _red, src in GROUPS:
        if src is not None:
            assert src in pool, f"[{name}] 例外来源 {src} 在例外表里没有记录"
            used_per_model[src] += _count
            # A 组(期望红)的 P/N 提取段必须就是例外指向的尺寸码, 否则不命中,
            # "应标红"的声明会变成假话 —— 这种错只能靠断言挡住。
            if _red:
                assert _pn[6:10] == EXCEPTION_CODE, (
                    f"[{name}] P/N {_pn} 的尺寸码不是 {EXCEPTION_CODE}, 不会命中"
                )
    for model, ids in pool.items():
        assert used_per_model[model] == len(ids), (
            f"例外表型号 {model} 有 {len(ids)} 条, 分组只用了 {used_per_model[model]} 条"
        )

    # ------------------------------------------------------------------
    # 2. 逐组生成行
    # ------------------------------------------------------------------
    cursor = {m: 0 for m in pool}      # 每个型号的例外池取到第几条
    generated = 0                      # 生成 ID 的序号
    all_ids: set[str] = set()
    groups_meta: list[dict] = []
    exceptions: list[dict] = []
    records: list[dict] = []

    for gi, (name, pn, model, count, expect_red, src) in enumerate(GROUPS):
        jig_ids: list[str] = []
        # 每个组给 4 个 CST: 行数最少的组(C 组 5 行)也能让透视出小计行
        csts = [f"D8CCST{500002 + gi * 4 + k}" for k in range(4)]

        for i in range(count):
            hit_exception = False
            if src is not None:
                idx = cursor[src]
                assert idx < len(pool[src]), f"[{name}] 例外池取超了"
                jig_id = pool[src][idx]
                cursor[src] = idx + 1
                # 例外记录存的是**4 位尺寸码**, 不是完整 P/N —— 例外说的
                # 是"这台做不了 65/55 这个规格", 料号后缀对判定没有意义。
                # A 组这一行的 P/N 提取段就是 6555 -> 必命中;
                # B 组这一行是 7748 -> 不命中。差别只来自 GROUPS 里的 P/N。
                exceptions.append({
                    "jigId": jig_id,
                    "pn": EXCEPTION_CODE,
                    "type": EXCEPTION_TYPE,
                })
                hit_exception = pn[6:10] == EXCEPTION_CODE
            else:
                jig_id = make_jig_id(generated)
                generated += 1

            assert jig_id not in all_ids, f"Jig ID 重复: {jig_id}"
            all_ids.add(jig_id)
            jig_ids.append(jig_id)

            # 说明表的推导必须与分组声明一致, 否则 Excel 会骗人
            red, reason = judge(model, pn, hit_exception)
            assert red == expect_red, (
                f"[{name}] {jig_id}: 推导 {red} != 声明 {expect_red} —— {reason}"
            )

            eng_name, eng_code = ENGINEERINGS[i % len(ENGINEERINGS)]
            records.append({
                "P/N": pn,
                "Lot ID": LOT_IDS[i % len(LOT_IDS)],
                # 每 20 行留 1 行 CST ID 为空, 触发 "CST ID 空则用 Lot ID 补"
                "CST ID": None if i % 20 == 7 else csts[i % len(csts)],
                "Slot No": (i % 20) + 1,
                "Jig ID": jig_id,
                "Jig 对应型号": f"{model} {model}",   # 真实格式: 型号 空格 型号
                "Glass判定": "N" if i % 17 == 0 else "G",
                "工程": int(eng_code),
                "工程名": eng_name,
                # 9 成在产, 1 成已入库 —— 审查页应只显示前者
                "Jig状态": "INPRODUCTION" if i % 10 != 3 else "STORED",
                # 以下字段只给后两页用, 不写进源数据
                "_model": model,
                "_hit": hit_exception,
                "_red": red,
                "_reason": reason,
            })

        groups_meta.append({
            "name": name,
            "pn": pn,
            "model": model,
            "rows": count,
            "expectRed": expect_red,
            "jigIds": jig_ids,
        })

    assert len(all_ids) == ROWS_TOTAL, f"实际生成 {len(all_ids)} 行"

    # ------------------------------------------------------------------
    # 3. 写 Excel —— 三页, 程序只读第一页
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

    # 第二页: 面板里要录的 78 条。命中的标黄底, 与未命中的一眼分开。
    ws_exc = wb.create_sheet("例外清单")
    ws_exc.append([
        "#", "JIG ID", "例外尺寸码", "例外类型",
        "源数据型号", "源数据中的 P/N", "是否命中",
    ])
    by_id = {r["Jig ID"]: r for r in records}
    for n, e in enumerate(exceptions, 1):
        row = by_id[e["jigId"]]
        ws_exc.append([
            n,
            e["jigId"],
            e["pn"],
            e["type"],
            row["_model"],
            row["P/N"],
            "命中 → 应标红" if row["_hit"] else "未命中（这行做的是别的 P/N）",
        ])
        if row["_hit"]:
            for cell in ws_exc[ws_exc.max_row]:
                cell.fill = EXC_FILL
    style_sheet(ws_exc, {
        "A": 5, "B": 15, "C": 14, "D": 11, "E": 11, "F": 17, "G": 30,
    })

    # 第三页: 逐行答案。标红的整行铺淡红底, 扫一眼就能数出该红多少行。
    ws_exp = wb.create_sheet("期望结果")
    ws_exp.append([
        "#", "JIG ID", "型号", "P/N", "对应尺寸（映射值）", "期望标记", "原因",
    ])
    for n, r in enumerate(records, 1):
        model = r["_model"]
        size = JIG_SIZE_MAPPING.get(model, "")
        display = f"{size}({EXCEPTION_TYPE})" if r["_hit"] else size
        ws_exp.append([
            n,
            r["Jig ID"],
            model,
            r["P/N"],
            display,
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
            "exceptions 是喂给 config.jigExceptions 的例外清单; "
            "groups 记录了每组的构造意图(期望红绿), 测试据它断言, "
            "因此期望值不是从被测代码推出来的。"
        ),
        "rowCount": ROWS_TOTAL,
        "pnList": sorted({g[1] for g in GROUPS}),
        "exceptions": exceptions,
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
    hit_rows = sum(1 for r in records if r["_hit"])
    print(f"written: {OUT} ({size:.1f} KB)")
    print(f"         3 页: 源数据 {len(records)} 行 / "
          f"例外清单 {len(exceptions)} 条 / 期望结果 {len(records)} 行")
    print(f"         {FIXTURE} ({len(exceptions)} 例外, {len(groups_meta)} 组)")
    print(f"  分组   {len(groups_meta)} 组 "
          f"({len(red_groups)} 组标红 / {len(groups_meta) - len(red_groups)} 组不标红)")
    print(f"  红绿   共 {len(records)} 行, 应标红 {red_rows} / 应不红 {len(records) - red_rows}")
    print(f"  例外   {len(exceptions)} 条, 其中命中 {hit_rows} 行"
          f"(命中即标红, 且对应尺寸列带 ({EXCEPTION_TYPE}) 标记)")
    print(f"  P/N    {len(fixture['pnList'])} 个")
    print(f"  工序   {len({e[0] for e in ENGINEERINGS})} 道, "
          f"工程号 {len({e[1] for e in ENGINEERINGS})} 个")

    if install:
        install_exceptions(exceptions)


if __name__ == "__main__":
    main(install="--install-exceptions" in sys.argv)
