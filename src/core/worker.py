"""
JIG Data Finder 1.0 - 工作线程模块

本模块包含 ExcelWorker 类，负责处理 Excel 数据的加载、查询和透视表生成。
工作线程设计确保数据处理不会阻塞 UI 线程。

主要功能:
1. Excel 文件加载和验证
2. 高级透视表生成（支持多级表头和小计汇总）
3. JIG ID 查询和数据匹配
4. 尺寸验证和映射

类:
    ExcelWorker: 主要工作线程类，继承自 QObject

依赖:
    pandas: 数据处理
    PySide2.QtCore: Qt 信号槽机制
    app.config: 应用程序配置

版本: 1.0.0
作者: JIG Data Finder 1.0开发团队
日期: 2026-01-03
"""

import pandas as pd
from PySide2.QtCore import QObject, Signal, Slot
from app.config import config
from typing import Optional, Dict, List, Any


class ExcelWorker(QObject):
    """
    Excel 数据处理工作线程类
    
    该类负责在后台线程中处理 Excel 数据操作，包括：
    1. 加载 Excel 文件并验证数据格式
    2. 生成高级透视表（支持生产中/全部版本）
    3. 执行 JIG ID 查询和结果匹配
    4. 管理数据缓存和状态
    
    信号:
        sig_log(str): 日志信号，发送处理状态消息
        sig_data_loaded(bool, dict): 数据加载完成信号，包含成功状态和透视表缓存
        sig_query_finished(pd.DataFrame, pd.DataFrame): 查询完成信号，包含查询结果和透视表
    
    属性:
        df_source (pd.DataFrame): 源数据 DataFrame
        df_pivot_cache (dict): 透视表缓存字典，包含 'all' 和 'prod' 两个版本
        output_columns (list): 输出列顺序配置
    
    示例:
        >>> worker = ExcelWorker()
        >>> worker.load_data("data.xlsx")
    """
    
    # 信号定义
    sig_log = Signal(str)                    # 日志信号
    sig_data_loaded = Signal(bool, object)   # 数据加载完成信号
    sig_query_finished = Signal(object, object)  # 查询完成信号
    sig_source_data_processed = Signal(object)  # 源数据处理完成信号

    def __init__(self) -> None:
        """
        初始化 ExcelWorker 实例
        
        设置初始数据状态和配置输出列顺序。
        """
        super().__init__()
        self.df_source: Optional[pd.DataFrame] = None  # 常驻内存的源数据
        self.df_pivot_cache: Optional[Dict[str, pd.DataFrame]] = None  # 透视表缓存
        self.output_columns: List[str] = config.output_columns  # 使用配置中的输出列顺序

    def _generate_pivot(self, df: pd.DataFrame, filter_production: bool = False) -> pd.DataFrame:
        """
        生成高级透视表（融合版：多级表头 + 小计汇总）
        
        该方法将原始数据转换为具有以下特征的透视表：
        1. 支持多级表头（P/N 分组，CST ID 明细）
        2. 自动计算小计和总计
        3. 支持生产中数据筛选
        4. 按照工程配置排序
        5. 数据清洗（0值替换为空字符串）
        
        算法步骤：
        1. 数据预处理：填充缺失的 CST ID
        2. 生产中筛选：根据配置筛选特定工程的数据
        3. 工程属性映射：将工程代码映射为名称和排序值
        4. 生成基础透视表：使用 pandas pivot_table
        5. 列排序：按照工程配置的 order 值排序
        6. 构建行结构：添加 P/N 汇总行、明细行和总计行
        7. 数据整理：调整列顺序，清洗数据
        
        Args:
            df: 源数据 DataFrame，必须包含 '工程'、'P/N'、'CST ID'、'Jig ID' 等列
            filter_production: 是否筛选生产中数据，True 表示只保留包含生产指示工程的数据
        
        Returns:
            pd.DataFrame: 生成的透视表，包含以下列：
                - P/N: 产品编号（汇总行显示实际值，明细行留空）
                - CST ID: 晶舟编号（汇总行显示 "--" 触发加粗样式）
                - [工程列...]: 各工程的 Jig ID 计数
                - 总计: 该行的总计数量
            
        Raises:
            Exception: 透视表生成过程中出现错误时记录日志并返回空 DataFrame
        
        Notes:
            - 汇总行使用 "--" 作为 CST ID 值，触发 UI 中的加粗样式
            - 总计行使用配置中的 keyword_total（默认为"总计"）作为 P/N 值
            - 数值 0 会被替换为空字符串，提高可读性
        """
        try:
            if df.empty:
                return pd.DataFrame()

            df_temp = df.copy()
            
            # --- [逻辑1] 数据预处理 (Lot ID 填充) ---
            # 业务逻辑：当 CST ID 为空时，使用 Lot ID 作为替代值
            # 这是因为在某些数据源中，CST ID 可能缺失，但 Lot ID 包含相同信息
            if 'Lot ID' in df_temp.columns:
                mask = df_temp['CST ID'] == ""  # 查找空的 CST ID
                df_temp.loc[mask, 'CST ID'] = df_temp.loc[mask, 'Lot ID']  # 用 Lot ID 填充

            # --- [逻辑2] P/N 筛选 (生产中判定) ---
            # 业务逻辑：筛选"生产中"的数据，即只保留包含特定工程代码（如50000）的 P/N
            # 这用于生成"生产中"版本的透视表，只显示实际在生产中的产品
            if filter_production:
                prod_indicator = config.production_indicator_code  # 默认为 "50000"
                # 找出所有包含生产指示工程代码的 P/N
                prod_pns = df_temp[df_temp['工程'] == prod_indicator]['P/N'].unique()
                # 筛选数据，只保留这些 P/N
                df_temp = df_temp[df_temp['P/N'].isin(prod_pns)]
                if df_temp.empty:
                    return pd.DataFrame()  # 如果没有数据，返回空 DataFrame

            # --- [逻辑3] 工程数据准备 & 排序准备 ---
            # 使用配置中的工程名列（默认为"工程名"）
            eng_column = config.pivot_column_key
            
            # 排除黑名单中的工程名称
            if config.pivot_exclude_names:
                df_temp = df_temp[~df_temp[eng_column].isin(config.pivot_exclude_names)]

            # --- [逻辑4] 生成基础透视表 ---
            # 使用工程名称作为列，统计每个 P/N + CST ID 组合的 Jig ID 数量
            pivot = df_temp.pivot_table(
                index=['P/N', 'CST ID'],
                columns=eng_column,  # 使用配置中的工程名列
                values='Jig ID',
                aggfunc='count',
                fill_value=0
            )

            # --- [逻辑5] 列排序与清洗 ---
            # 创建工程名称到排序值的映射
            eng_name_to_order = {}
            for eng_name, info in config.engineering_config.items():
                order = info.get('order', 999)
                eng_name_to_order[eng_name] = order
            
            # 按照工程配置的 order 值对列进行排序
            sorted_columns = sorted(
                pivot.columns.tolist(),
                key=lambda col: eng_name_to_order.get(col, 999)
            )
            
            # 重新排列列顺序
            pivot = pivot[sorted_columns]
            
            # 获取所有工程数据列
            data_cols = sorted_columns

            # --- [逻辑6] 手动构建行 (小计/总计/视觉合并) ---
            new_rows = []
            
            # 获取唯一的 P/N
            unique_pns = pivot.index.get_level_values(0).unique()
            
            # 全局总计累加器
            grand_total_row = {col: 0 for col in data_cols}
            grand_total_count = 0

            # 定义总计列的 Key
            KEY_TOTAL = config.keyword_total

            # 遍历每个 P/N 分组
            for pn in unique_pns:
                # 获取当前 P/N 的组数据
                group = pivot.loc[pn]  # 此时 index 只有 CST ID
                
                # --- A. 计算该 P/N 的小计 ---
                # 按列求和
                sub_sums = group.sum(numeric_only=True)
                # 计算该组的总数（所有列之和）
                sub_total_val = sub_sums.sum()
                
                # 更新全局总计
                for col in data_cols:
                    grand_total_row[col] += sub_sums[col]
                grand_total_count += sub_total_val

                # --- B. 插入 P/N 汇总行（加粗行）---
                # 汇总行使用 "--" 作为 CST ID，触发 UI 加粗样式
                header_row = {
                    "P/N": pn,
                    "CST ID": f"--",  # 触发加粗样式的关键词
                    KEY_TOTAL: sub_total_val
                }
                # 填充各工程列的统计值
                for col in data_cols:
                    header_row[col] = sub_sums[col]
                
                new_rows.append(header_row)

                # --- C. 插入明细行 ---
                for cst_id, row in group.iterrows():
                    row_sum = row.sum()
                    
                    detail_row = {
                        "P/N": "",      # 视觉合并，留空
                        "CST ID": cst_id,
                        KEY_TOTAL: row_sum
                    }
                    for col in data_cols:
                        detail_row[col] = row[col]
                    
                    new_rows.append(detail_row)

            # --- [逻辑7] 添加全局总计行 ---
            total_row = {
                "P/N": config.keyword_total,  # "总计"
                "CST ID": "",
                KEY_TOTAL: grand_total_count
            }
            for col in data_cols:
                total_row[col] = grand_total_row[col]
            new_rows.append(total_row)

            # --- [逻辑8] 转为 DataFrame 并整理 ---
            final_df = pd.DataFrame(new_rows)
            
            # 整理列顺序：P/N, CST ID, [工程列...], 总计
            cols_order = ['P/N', 'CST ID'] + data_cols + [KEY_TOTAL]
            
            # 确保列存在（防止空数据报错）
            cols_order = [c for c in cols_order if c in final_df.columns]
            final_df = final_df[cols_order]

            # --- [逻辑9] 数据清洗 (0 -> "") ---
            # 只替换数值列（工程列 + 总计列）
            numeric_cols = data_cols + [KEY_TOTAL]
            # 仅替换存在于 final_df 中的列
            numeric_cols = [c for c in numeric_cols if c in final_df.columns]
            
            final_df[numeric_cols] = final_df[numeric_cols].replace(0, "")

            return final_df

        except Exception as e:
            self.sig_log.emit(f"透视表生成失败: {str(e)}")
            import traceback
            traceback.print_exc()
            return pd.DataFrame()


    @Slot(str)
    def load_data(self, file_path: str) -> None:
        """
        加载源 Excel 数据文件并生成透视表缓存
        
        该方法执行以下操作：
        1. 读取 Excel 文件到 DataFrame
        2. 验证数据格式（检查必须包含 'Jig ID' 列）
        3. 过滤 JIG 状态（根据配置过滤活跃状态）
        4. 生成两个版本的透视表：全部数据和生产中的数据
        5. 缓存透视表结果并发送加载完成信号
        
        处理流程：
        1. 清空现有数据缓存
        2. 读取 Excel 文件（所有列作为字符串类型，避免 NaN 问题）
        3. 验证关键列存在性
        4. 根据配置过滤 JIG 状态
        5. 调用 _generate_pivot 生成全部版本透视表
        6. 调用 _generate_pivot 生成生产中版本透视表
        7. 将结果缓存到 df_pivot_cache 字典
        8. 发送 sig_data_loaded 信号通知 UI
        
        Args:
            file_path: Excel 文件路径，支持 .xlsx 和 .xls 格式
        
        Returns:
            None: 结果通过 sig_data_loaded 信号返回
        
        Raises:
            ValueError: 如果源文件中缺少 'Jig ID' 列
            Exception: 文件读取或数据处理过程中出现错误
        
        Notes:
            - 使用 dtype=str 读取 Excel，避免数值类型转换问题
            - 保持默认 NA 值为空字符串，提高数据一致性
            - 透视表缓存包含两个键：'all'（全部数据）和 'prod'（生产中数据）
            - 加载失败时会发送 False 状态和 None 数据
        
        Examples:
            >>> worker.load_data("data/jig_data.xlsx")
            # 成功时发送 sig_data_loaded(True, {"all": df_all, "prod": df_prod})
            # 失败时发送 sig_data_loaded(False, None)
        """
        self.sig_log.emit(f"正在加载文件: {file_path} ...")
        self.df_source = None
        self.df_pivot_cache = None

        try:
            # 读取 Excel 文件，所有列作为字符串类型处理
            self.df_source = pd.read_excel(file_path, dtype=str, keep_default_na=False)
            
            # 简单校验一下是否有关键列
            if "Jig ID" not in self.df_source.columns:
                raise ValueError(config.get_error_message("missing_jig_id_column"))
            
            rows, cols = self.df_source.shape
            self.sig_log.emit(f"加载成功！共 {rows} 行，{cols} 列")

            # 1. 过滤 JIG 状态（如果需要）
            df_active = self.df_source
            if config.jig_status_column in self.df_source.columns:
                df_active = self.df_source[self.df_source[config.jig_status_column] == config.jig_status_active_value]

            # 2. 生成 "全部" 版本透视表
            df_full_all = self._generate_pivot(df_active, filter_production=False)
        
            # 3. 生成 "生产中" 版本透视表
            df_full_prod = self._generate_pivot(df_active, filter_production=True)
        
            # 4. 将两个结果打包成字典发送
            self.df_pivot_cache = {
                "all": df_full_all,
                "prod": df_full_prod
            }
        
            self.sig_data_loaded.emit(True, self.df_pivot_cache)
            
        except Exception as e:
            self.sig_log.emit(config.get_error_message("excel_load_error", error=str(e)))
            self.sig_data_loaded.emit(False, None)


    @Slot(list)
    def query_data(self, input_ids: List[str]) -> None:
        """
        执行 JIG ID 查询逻辑
        
        该方法根据用户输入的 JIG ID 列表，从已加载的源数据中查找匹配的记录，
        并返回格式化后的查询结果和对应的透视表。
        
        主要功能：
        1. 验证输入和源数据状态
        2. 执行左连接查询匹配数据
        3. 动态添加尺寸映射列
        4. 调整输出列顺序
        5. 数据排序和格式化
        6. 生成查询结果的透视表
        7. 发送查询完成信号
        
        处理流程：
        1. 状态检查：确保源数据已加载且输入不为空
        2. 数据匹配：使用左连接将输入 ID 与源数据匹配
        3. 尺寸映射：根据配置将 Jig 对应型号映射为对应尺寸
        4. 列调整：动态调整输出列顺序，插入尺寸列
        5. 数据清洗：填充未找到的数据为"【未找到】"
        6. 数据排序：按照配置的排序列进行排序（支持数值排序）
        7. 透视表生成：为匹配到的数据生成透视表
        8. 结果发送：通过 sig_query_finished 信号返回结果
        
        Args:
            input_ids: JIG ID 字符串列表，需要查询的 ID
        
        Returns:
            None: 结果通过 sig_query_finished 信号返回，包含两个 DataFrame：
                - 第一个 DataFrame: 查询结果明细表
                - 第二个 DataFrame: 查询结果的透视表
        
        Raises:
            Exception: 查询过程中出现错误时记录日志
        
        Notes:
            - 使用左连接（left join）确保所有输入 ID 都有结果（未匹配的显示"【未找到】"）
            - 支持数值排序，对于配置为数值排序的列，会创建临时数值列进行排序
            - 尺寸映射基于 config.jig_size_mapping 配置
            - 输出列顺序根据 config.output_columns 动态调整
        
        Examples:
            >>> worker.query_data(["JIG001", "JIG002", "JIG003"])
            # 成功时发送 sig_query_finished(result_df, pivot_df)
            # 失败时记录错误日志
        """
        if self.df_source is None:
            self.sig_log.emit(config.get_error_message("no_data_loaded"))
            return

        if not input_ids:
            self.sig_log.emit(config.get_error_message("no_input_ids"))
            return

        self.sig_log.emit(f"正在查询 {len(input_ids)} 个 ID ...")
        
        try:
            # 1. 构造用户输入的 DataFrame
            df_input = pd.DataFrame({"Jig ID": input_ids})
            
            # 2. 核心：左连接 (Left Join)
            # 以用户输入的 df_input 为主，去 df_source 里找对应的数据
            # 没找到的会自动填 NaN (这里因为前面处理过，可能是空值)
            merged_df = pd.merge(df_input, self.df_source, on="Jig ID", how="left")
            
            size_map_dict = config.jig_size_mapping
            target_col = "Jig 对应型号"
            new_col_name = "对应尺寸"

            if target_col in merged_df.columns:
                # 处理 Jig 对应型号列：提取第一个型号（如 "184 184" → "184"）
                # 源文件值的结构是：型号 + 空格 + 型号
                merged_df[target_col] = merged_df[target_col].apply(
                    lambda x: str(x).split()[0] if pd.notna(x) and str(x).strip() else ""
                )
                
                # 使用处理后的值进行映射，未匹配到的填空字符串
                merged_df[new_col_name] = merged_df[target_col].map(size_map_dict).fillna("")
                
                # 3. 动态调整输出列顺序
                # 我们需要在 config.output_columns 的基础上，把新列插到 target_col 的右边
                local_output_cols = list(self.output_columns)
                if target_col in local_output_cols:
                    idx = local_output_cols.index(target_col)
                    # 插入到 target_col 的后面
                    if new_col_name not in local_output_cols:
                        local_output_cols.insert(idx + 1, new_col_name)
                else:
                    # 如果配置文件里没配 Jig 对应型号，就加到最后
                    local_output_cols.append(new_col_name)
            else:
                local_output_cols = self.output_columns

            # 3. 列重排 & 筛选
            # 只保留存在的列，防止源数据缺某一列导致报错
            final_cols = [c for c in local_output_cols if c in merged_df.columns]
            final_df = merged_df[final_cols]
            
            # 4. 填充未找到的数据
            final_df = final_df.fillna("【未找到】")
            
            # 5. 按照指定顺序排序：使用配置中的排序列
            sort_columns = config.sort_columns
            # 只对存在的列进行排序，避免源数据缺少某些列导致错误
            sort_columns = [col for col in sort_columns if col in final_df.columns]
            
            if sort_columns:
                # 处理需要数值排序的列，创建临时数值列进行排序
                temp_cols = []
                for col in sort_columns:
                    if col in config.numeric_sort_columns:  # 使用配置中的数值排序列
                        # 创建临时列，尝试将字符串转换为数值，转换失败则保持原字符串
                        temp_col = f"{col}_temp"
                        # 使用pd.to_numeric，errors='coerce'将不能转换的设为NaN，然后fillna保持原字符串
                        final_df[temp_col] = pd.to_numeric(final_df[col], errors='coerce')
                        # 对NaN值进行填充，确保排序时原字符串值排在最后
                        final_df[temp_col] = final_df[temp_col].fillna(float('inf'))
                        temp_cols.append(temp_col)
                    else:
                        # 不需要数值排序的列，直接使用原列名
                        temp_cols.append(col)
                
                # 使用临时列进行排序
                final_df = final_df.sort_values(by=temp_cols, ascending=True)
                
                # 删除临时列
                for col in temp_cols:
                    if col.endswith("_temp") and col in final_df.columns:
                        final_df.drop(columns=col, inplace=True)
            
            self.sig_log.emit(f"已查询 {len(final_df)} 行 , 共 {self.df_source.shape[0]} 行")

            if "P/N" in merged_df.columns:
                # 注意：merged_df 里未匹配的是 NaN，不是 "【未找到】" (那是 final_df 填的)
                pivot_source_df = merged_df[merged_df["P/N"].notna()]
            else:
                pivot_source_df = merged_df
            
            query_pivot_df = self._generate_pivot(pivot_source_df, filter_production=False)

            self.sig_query_finished.emit(final_df, query_pivot_df)
            
        except Exception as e:
            self.sig_log.emit(f"查询出错: {str(e)}")
            import traceback
            traceback.print_exc()  # 调试用

    def process_source_data(self) -> None:
        """
        处理源数据用于审查页显示
        
        该方法对已加载的源数据进行处理,用于在审查页显示:
        1. 过滤 JIG 状态为 "INPRODUCTION" 的数据
        2. 添加"对应尺寸"列 (基于 Jig 对应型号映射)
        3. 使用 output_columns 调整列顺序
        4. 应用与 query_data 相同的排序逻辑
        
        处理流程:
        1. 状态检查: 确保源数据已加载
        2. 过滤 JIG 状态: 只保留 JIG 状态为 "INPRODUCTION" 的数据
        3. 尺寸映射: 根据 Jig 对应型号映射到对应尺寸
        4. 列调整: 动态调整输出列顺序,插入尺寸列
        5. 数据排序: 按照配置的排序列进行排序 (支持数值排序)
        6. 结果发送: 通过 sig_source_data_processed 信号返回结果
        
        Returns:
            None: 结果通过 sig_source_data_processed 信号返回
        
        Raises:
            Exception: 处理过程中出现错误时记录日志
        
        Notes:
            - 使用与 query_data 相同的排序逻辑
            - 尺寸映射基于 config.jig_size_mapping 配置
            - 输出列顺序根据 config.output_columns 动态调整
            - 不需要填充未找到的数据 (因为这是直接处理源数据)
        """
        if self.df_source is None:
            self.sig_log.emit(config.get_error_message("no_data_loaded"))
            return
        
        try:
            # 1. 过滤 JIG 状态为 "INPRODUCTION" 的数据
            df_review = self.df_source.copy()
            if config.jig_status_column in df_review.columns:
                df_review = df_review[df_review[config.jig_status_column] == config.jig_status_active_value]
            
            if df_review.empty:
                self.sig_log.emit("没有符合条件的数据")
                self.sig_source_data_processed.emit(df_review)
                return
            
            # 2. 添加"对应尺寸"列
            size_map_dict = config.jig_size_mapping
            target_col = "Jig 对应型号"
            new_col_name = "对应尺寸"

            if target_col in df_review.columns:
                # 处理 Jig 对应型号列: 提取第一个型号 (如 "184 184" → "184")
                df_review[target_col] = df_review[target_col].apply(
                    lambda x: str(x).split()[0] if pd.notna(x) and str(x).strip() else ""
                )
                
                # 使用处理后的值进行映射,未匹配到的填空字符串
                df_review[new_col_name] = df_review[target_col].map(size_map_dict).fillna("")
                
                # 3. 动态调整输出列顺序
                local_output_cols = list(self.output_columns)
                if target_col in local_output_cols:
                    idx = local_output_cols.index(target_col)
                    # 插入到 target_col 的后面
                    if new_col_name not in local_output_cols:
                        local_output_cols.insert(idx + 1, new_col_name)
                else:
                    # 如果配置文件里没配 Jig 对应型号,就加到最后
                    local_output_cols.append(new_col_name)
            else:
                local_output_cols = self.output_columns

            # 4. 列重排 & 筛选
            # 只保留存在的列,防止源数据缺某一列导致报错
            final_cols = [c for c in local_output_cols if c in df_review.columns]
            final_df = df_review[final_cols].copy()
            
            # 5. 按照指定顺序排序: 使用配置中的排序列
            sort_columns = config.sort_columns
            # 只对存在的列进行排序,避免源数据缺少某些列导致错误
            sort_columns = [col for col in sort_columns if col in final_df.columns]
            
            if sort_columns:
                # 处理需要数值排序的列,创建临时数值列进行排序
                temp_cols = []
                for col in sort_columns:
                    if col in config.numeric_sort_columns:  # 使用配置中的数值排序列
                        # 创建临时列,尝试将字符串转换为数值,转换失败则保持原字符串
                        temp_col = f"{col}_temp"
                        # 使用pd.to_numeric, errors='coerce'将不能转换的设为NaN,然后fillna保持原字符串
                        final_df[temp_col] = pd.to_numeric(final_df[col], errors='coerce')
                        # 对NaN值进行填充,确保排序时原字符串值排在最后
                        final_df[temp_col] = final_df[temp_col].fillna(float('inf'))
                        temp_cols.append(temp_col)
                    else:
                        # 不需要数值排序的列,直接使用原列名
                        temp_cols.append(col)
                
                # 使用临时列进行排序
                final_df = final_df.sort_values(by=temp_cols, ascending=True)
                
                # 删除临时列
                for col in temp_cols:
                    if col.endswith("_temp") and col in final_df.columns:
                        final_df.drop(columns=col, inplace=True)       

            self.sig_source_data_processed.emit(final_df)
            
        except Exception as e:
            self.sig_log.emit(f"处理源数据出错: {str(e)}")
            import traceback
            traceback.print_exc()  # 调试用

