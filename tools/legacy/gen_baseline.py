"""
Phase 0 基线快照生成脚本 —— 旧版 PySide2 代码的唯一活跃使用者

用途: 用旧版 Python 真实逻辑跑 jig数据整理.xlsx, 把查询/透视/审查结果
序列化到 tests/fixtures/expected.json, 作为 Tauri TypeScript 版本迁移的
一致性比对基线。

位置说明: Tauri 版已完成物理隔离 (src/ 下是纯 TypeScript), 旧版代码
移到这里保留, 仅为重新生成基线快照。若基线已稳定且不再需要回退对照,
本目录可整体删除, 不影响产品构建与运行。

运行:  python tools/legacy/gen_baseline.py
"""

import json
import os
import sys
from datetime import datetime

# tools/legacy/gen_baseline.py -> tools/legacy -> tools -> 仓库根
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# 旧版代码在本目录下的 src/ (tools/legacy/src)
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "src")
sys.path.insert(0, SRC)

from app.config import config  # noqa: E402
from core.worker import ExcelWorker  # noqa: E402

FIXTURE = os.path.join(ROOT, "jig数据整理.xlsx")
OUT = os.path.join(ROOT, "tests", "fixtures", "expected.json")


class Collector:
    """代替 Qt 信号,收集 worker 的输出"""

    def __init__(self, worker):
        self.worker = worker
        self.logs = []
        self.loaded = None
        self.query_result = None
        self.review = None
        worker.sig_log.connect(self.logs.append)
        worker.sig_data_loaded.connect(self._on_loaded)
        worker.sig_query_finished.connect(self._on_query)
        worker.sig_source_data_processed.connect(self._on_review)

    def _on_loaded(self, success, data):
        self.loaded = (success, data)

    def _on_query(self, detail, pivot):
        self.query_result = (detail, pivot)

    def _on_review(self, df):
        self.review = df


def df_to_records(df):
    """DataFrame -> 可 JSON 序列化的 records, 保留列顺序"""
    if df is None:
        return None
    return {
        "columns": [str(c) for c in df.columns],
        "rows": [[("" if v is None else str(v)) for v in row] for row in df.values.tolist()],
        "row_count": int(df.shape[0]),
    }


def size_validation_samples(df):
    """
    抽取尺寸验证结果, 便于 TS 版逐条比对
    返回: [{"pn":..., "size":..., "match": bool}, ...]
    """
    if df is None or "P/N" not in df.columns or "对应尺寸" not in df.columns:
        return []
    from core.data_model import PandasModel
    model = PandasModel(df, show_row_numbers=True)
    out = []
    for _, row in df.iterrows():
        pn = str(row.get("P/N", "") or "")
        size = str(row.get("对应尺寸", "") or "")
        out.append({
            "pn": pn,
            "size": size,
            "match": bool(model._validate_size_match(pn, size)),
        })
    return out


def main():
    if not os.path.exists(FIXTURE):
        print(f"[FAIL] 找不到样本文件: {FIXTURE}")
        sys.exit(1)

    worker = ExcelWorker()
    col = Collector(worker)

    # --- 1. 加载数据 ---
    worker.load_data(FIXTURE)
    if not col.loaded or not col.loaded[0]:
        print("[FAIL] load_data 失败")
        print("\n".join(col.logs))
        sys.exit(1)
    success, package = col.loaded
    df_all = package.get("all")
    df_prod = package.get("prod")

    # --- 2. 取样本 Jig ID 跑查询 ---
    source = worker.df_source
    all_ids = [str(x).strip() for x in source["Jig ID"].tolist()]
    sample_ids = all_ids[:20]                     # 前 20 个,全匹配
    mixed_ids = all_ids[:10] + ["NOTEXIST0001"]  # 含未命中,验证 "【未找到】"
    col.query_result = None
    worker.query_data(sample_ids)
    q_detail, q_pivot = col.query_result

    col.query_result = None
    worker.query_data(mixed_ids)
    mixed_detail, _ = col.query_result

    # --- 3. 审查页数据 ---
    worker.process_source_data()
    review_df = col.review

    # --- 4. 剪贴板解析行为 ---
    from utils.clipboard_processor import clipboard_processor
    clipboard_cases = []
    for text in [
        "CJJ349000910\nCJJ349000919",
        "请查一下这些: CJJ349000910 和 C4M123456789, 谢谢",
        "CJJ349000910\nCJJ349000910\nCJJ349000919",
        "这里没有任何ID",
        "",
    ]:
        clipboard_cases.append({
            "input": text,
            "output": clipboard_processor.process_clipboard_content(text),
        })

    baseline = {
        "_meta": {
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "fixture": os.path.basename(FIXTURE),
            "python": sys.version.split()[0],
            "config_size_validation_enabled": config.size_validation_enabled,
        },
        "source": {
            "row_count": int(source.shape[0]),
            "columns": [str(c) for c in source.columns],
            "jig_ids": all_ids,
        },
        "pivot_all": df_to_records(df_all),
        "pivot_prod": df_to_records(df_prod),
        "query": {
            "input_ids": sample_ids,
            "detail": df_to_records(q_detail),
            "pivot": df_to_records(q_pivot),
        },
        "query_with_missing": {
            "input_ids": mixed_ids,
            "detail": df_to_records(mixed_detail),
        },
        "review": df_to_records(review_df),
        "size_validation": size_validation_samples(review_df),
        "clipboard": clipboard_cases,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(baseline, f, ensure_ascii=False, indent=2)

    print(f"[OK] 基线已生成: {OUT}")
    print(f"     源数据 {baseline['source']['row_count']} 行")
    print(f"     全量透视 {baseline['pivot_all']['row_count']} 行")
    print(f"     生产中透视 {baseline['pivot_prod']['row_count']} 行")
    print(f"     查询明细 {baseline['query']['detail']['row_count']} 行")
    print(f"     审查数据 {baseline['review']['row_count']} 行")
    print(f"     尺寸校验样本 {len(baseline['size_validation'])} 条")
    print(f"     剪贴板用例 {len(clipboard_cases)} 条")


if __name__ == "__main__":
    main()