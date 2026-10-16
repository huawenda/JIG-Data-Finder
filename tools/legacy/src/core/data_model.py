"""
JIG Data Finder 1.0 - Pandas 表格模型模块

本模块包含 PandasModel 类，这是一个改进的 Qt 表格模型，用于将 Pandas DataFrame
数据显示为 Qt 表格视图。支持高级样式自定义、行号开关和尺寸验证功能。

主要功能:
1. DataFrame 到 Qt 表格的转换和显示
2. 支持行号列显示/隐藏（明细表显示行号，透视表不显示）
3. 高级样式自定义：
   - 汇总行和总计行的加粗字体
   - 汇总行和总计行的背景颜色高亮
   - 尺寸验证不匹配时的红色文本提示
4. 尺寸验证：自动验证 P/N 值与对应尺寸是否匹配
5. 表头处理：支持多级表头（元组列名）的显示优化

类:
    PandasModel: 主要表格模型类，继承自 QAbstractTableModel

依赖:
    PySide2.QtCore: Qt 核心模块，提供 QAbstractTableModel 基类
    PySide2.QtGui: Qt GUI 模块，提供 QFont、QColor 等样式类
    pandas: 数据处理库，提供 DataFrame 数据结构
    app.config: 应用程序配置模块

版本: 1.0.0
作者: JIG Data Finder 1.0开发团队
日期: 2026-01-03
"""

from PySide2.QtCore import Qt, QAbstractTableModel, QModelIndex
from PySide2.QtGui import QFont, QColor
import pandas as pd
from typing import Any, Optional, Dict, List, Tuple
from app.config import config


class PandasModel(QAbstractTableModel):
    """
    改进的 Pandas DataFrame 表格模型类
    
    该类继承自 QAbstractTableModel，用于将 Pandas DataFrame 数据显示为 Qt 表格视图。
    支持高级样式自定义、行号开关、尺寸验证和多级表头处理。
    
    主要特性：
    1. 数据转换：将 DataFrame 转换为 Qt 表格模型
    2. 行号支持：可选的显示行号列（明细表显示，透视表不显示）
    3. 样式自定义：
       - 字体样式：汇总行和总计行自动加粗
       - 背景颜色：汇总行浅蓝色背景，总计行浅绿色背景
       - 前景颜色：尺寸验证不匹配时显示红色文本
    4. 尺寸验证：自动验证 P/N 值与对应尺寸是否匹配
    5. 表头处理：智能处理多级表头（元组列名），只显示最内层名称
    
    属性:
        _data (pd.DataFrame): 内部存储的 DataFrame 数据
        _show_row_numbers (bool): 是否显示行号列
        _col_idx_cst (int): "CST ID" 列的索引缓存，-1 表示不存在
        _col_idx_pn (int): "P/N" 列的索引缓存，-1 表示不存在
        _col_idx_size (int): "对应尺寸" 列的索引缓存，-1 表示不存在
        _size_validation_enabled (bool): 尺寸验证功能是否启用
        _pn_extract_start (int): P/N 值提取起始位置
        _pn_extract_length (int): P/N 值提取长度
        _size_special_mappings (Dict[str, str]): 尺寸特殊映射配置
        _all_size_value (str): "All Size" 特殊值
        _size_mismatch_color (str): 尺寸不匹配时的文本颜色
    
    信号:
        继承自 QAbstractTableModel 的信号，如 dataChanged
    
    示例:
        >>> df = pd.DataFrame({"P/N": ["ABC123"], "CST ID": ["CST001"], "对应尺寸": ["65/55"]})
        >>> model = PandasModel(df, show_row_numbers=True)
        >>> # 在 Qt 表格视图中使用 model
    """
    
    def __init__(self, data: Optional[pd.DataFrame], show_row_numbers: bool = True) -> None:
        """
        初始化 PandasModel 实例
        
        设置初始数据、行号显示选项，并缓存关键列的索引以提高性能。
        同时加载尺寸验证相关的配置。
        
        Args:
            data: 要显示的 Pandas DataFrame，如果为 None 则创建空 DataFrame
            show_row_numbers: 是否显示行号列，True 表示显示（用于明细表），
                             False 表示不显示（用于透视表）
        
        Notes:
            - 缓存 "CST ID"、"P/N"、"对应尺寸" 列的索引，避免在每次 data() 调用时重复查找
            - 从 config 模块加载尺寸验证相关的配置参数
            - 如果 DataFrame 为空或关键列不存在，相关索引缓存为 -1
        """
        super().__init__()
        self._data: pd.DataFrame = data if data is not None else pd.DataFrame()
        self._show_row_numbers: bool = show_row_numbers
        
        # 缓存关键列的索引，提高 data() 方法性能
        self._col_idx_cst: int = -1
        self._col_idx_pn: int = -1
        self._col_idx_size: int = -1
        if not self._data.empty:
            try:
                self._col_idx_cst = self._data.columns.get_loc("CST ID")
            except KeyError:
                pass
            try:
                self._col_idx_pn = self._data.columns.get_loc("P/N")
            except KeyError:
                pass
            try:
                self._col_idx_size = self._data.columns.get_loc("对应尺寸")
            except KeyError:
                pass
        
        # 从配置加载尺寸验证相关参数
        self._size_validation_enabled: bool = config.size_validation_enabled
        self._pn_extract_start: int = config.pn_extract_start
        self._pn_extract_length: int = config.pn_extract_length
        self._size_special_mappings: Dict[str, str] = config.size_special_mappings
        self._all_size_value: str = config.all_size_value
        self._size_mismatch_color: str = config.size_mismatch_color

    def rowCount(self, parent: Optional[QModelIndex] = None) -> int:
        """
        返回表格的行数
        
        这是 QAbstractTableModel 必须重写的方法，用于提供表格的行数信息。
        如果提供了有效的父索引（表示树形结构），返回 0；否则返回 DataFrame 的行数。
        
        Args:
            parent: 父模型索引，用于树形表格模型。对于平面表格，通常为 None 或无效索引
        
        Returns:
            int: 表格的行数。如果 parent 有效，返回 0；否则返回 self._data 的行数
        
        Notes:
            - 对于平面表格模型，parent 参数通常为 None 或无效索引
            - 返回的是数据行数，不包括表头
            - 如果显示行号列，行号列不影响行数计算
        """
        if parent is not None and parent.isValid():
            return 0
        return self._data.shape[0]
    
    def columnCount(self, parent: Optional[QModelIndex] = None) -> int:
        """
        返回表格的列数
        
        这是 QAbstractTableModel 必须重写的方法，用于提供表格的列数信息。
        计算逻辑：DataFrame 的列数 + 是否显示行号列（如果显示则加1）。
        
        Args:
            parent: 父模型索引，用于树形表格模型。对于平面表格，通常为 None 或无效索引
        
        Returns:
            int: 表格的列数。如果 parent 有效，返回 0；否则返回计算后的列数
        
        Notes:
            - 行号列是虚拟列，不包含在原始 DataFrame 中
            - 当 show_row_numbers 为 True 时，列数 = DataFrame 列数 + 1
            - 当 show_row_numbers 为 False 时，列数 = DataFrame 列数
        """
        if parent is not None and parent.isValid():
            return 0
        columns = self._data.shape[1]
        if self._show_row_numbers:
            columns += 1
        return columns
    
    def data(self, index: QModelIndex, role: int = Qt.DisplayRole) -> Any:
        """
        返回指定索引和角色的数据
        
        这是 QAbstractTableModel 的核心方法，根据不同的角色返回相应的数据。
        支持多种角色：显示内容、对齐方式、工具提示、字体样式、背景颜色、前景颜色等。
        
        Args:
            index: 模型索引，包含行和列信息
            role: 数据角色，决定返回什么类型的数据
        
        Returns:
            Any: 根据角色返回相应的数据，可能为字符串、QFont、QColor、对齐方式等
        
        Raises:
            无显式异常，但内部处理时可能捕获异常并返回 None
        
        Notes:
            支持的角色：
            1. DisplayRole: 显示内容（行号或数据值）
            2. TextAlignmentRole: 对齐方式（居中）
            3. ToolTipRole: 工具提示（显示完整数据）
            4. FontRole: 字体样式（汇总行和总计行加粗）
            5. BackgroundRole: 背景颜色（汇总行浅蓝，总计行浅绿）
            6. ForegroundRole: 前景颜色（尺寸验证不匹配时红色）
            
            处理流程：
            1. 验证索引和数据的有效性
            2. 计算实际 DataFrame 列索引（考虑行号列）
            3. 根据不同的角色返回相应的数据
        """
        if not index.isValid() or self._data.empty:
            return None
        
        row = index.row()
        col = index.column()
        
        # --- 1. 计算实际对应 DataFrame 的列索引 ---
        # df_col_index: -1 表示是行号列，>=0 表示是数据列
        df_col_index: int
        if self._show_row_numbers:
            if col == 0:
                df_col_index = -1
            else:
                df_col_index = col - 1
        else:
            df_col_index = col

        # --- 2. 处理显示内容 (DisplayRole) ---
        if role == Qt.DisplayRole:
            if df_col_index == -1:
                # 显示行号（从1开始）
                return str(row + 1)
            else:
                # 显示数据
                if 0 <= df_col_index < self._data.shape[1]:
                    value = self._data.iloc[row, df_col_index]
                    # 如果是 NaN 或者 None，显示空字符串
                    return str(value) if pd.notna(value) else ""

        # --- 3. 处理对齐方式 (TextAlignmentRole) ---
        elif role == Qt.TextAlignmentRole:
            return Qt.AlignCenter
        
        # --- 4. 处理工具提示 (ToolTipRole) ---
        elif role == Qt.ToolTipRole:
            if df_col_index >= 0:
                value = self._data.iloc[row, df_col_index]
                if pd.notna(value):
                    return str(value)

        # =========================================================
        # --- 5. [新增] 字体样式 (FontRole) - 实现加粗逻辑 ---
        # =========================================================
        elif role == Qt.FontRole:
            """
            字体样式处理逻辑：
            
            根据业务需求，汇总行和总计行需要显示为加粗字体以提高可读性。
            判断规则基于 CST ID 和 P/N 列的内容：
            
            1. 汇总行判断：
               - CST ID 列包含 "--" 字符串（由 worker.py 生成的数据透视表汇总行）
               - 例如：CST ID 为 "CST001--CST002" 表示汇总行
            
            2. 小计行判断：
               - CST ID 列包含 "总计" 字符串（Excel 风格的小计）
               - 例如：CST ID 为 "CST001 总计" 表示小计行
            
            3. 全表总计判断：
               - P/N 列等于 "总计"（数据透视表的全表总计行）
               - 例如：P/N 为 "总计" 表示全表总计行
            
            性能优化：
            - 只在 CST ID 或 P/N 列存在时才进行判断，避免不必要的计算
            - 使用 try-except 防止数据访问异常影响正常渲染
            """
            # 只有当存在 CST ID 或 P/N 列时才进行判断
            if self._col_idx_cst != -1 or self._col_idx_pn != -1:
                try:
                    # 获取当前行的关键列数据
                    cst_val = str(self._data.iloc[row, self._col_idx_cst]) if self._col_idx_cst != -1 else ""
                    pn_val = str(self._data.iloc[row, self._col_idx_pn]) if self._col_idx_pn != -1 else ""
                    
                    # 判定逻辑：
                    # 1. CST ID 包含 "汇总" (我们在 worker.py 里生成的)
                    # 2. CST ID 包含 "总计" (Excel 风格的小计)
                    # 3. P/N 是 "总计" (全表总计)
                    if "--" in cst_val or "总计" in cst_val or "总计" == pn_val:
                        font = QFont()
                        font.setBold(True)
                        # font.setPointSize(10) # 可选：稍微放大字体
                        return font
                except:
                    # 数据访问异常，跳过字体样式设置
                    pass

        # =========================================================
        # --- 6. [新增] 背景颜色 (BackgroundRole) - 增加可读性 ---
        # =========================================================
        elif role == Qt.BackgroundRole:
            """
            背景颜色处理逻辑：
            
            为了提高表格的可读性，为不同类型的汇总行设置不同的背景颜色：
            
            1. 汇总行（数据透视表汇总）：
               - 背景颜色：浅蓝色 (#F2F6FC)
               - 判断条件：CST ID 列包含 "--" 字符串
               - 视觉目的：区分数据透视表的汇总行和普通数据行
            
            2. 总计行（全表总计）：
               - 背景颜色：浅绿色 (#E1F3D8)
               - 判断条件：P/N 列等于 "总计"
               - 视觉目的：突出显示全表总计行，便于快速定位
            
            颜色选择原则：
            - 使用柔和的浅色调，避免影响文字可读性
            - 颜色与字体加粗样式配合使用，形成视觉层次
            - 颜色值来自企业设计规范，保持UI一致性
            
            性能优化：
            - 只在 CST ID 或 P/N 列存在时才进行判断
            - 使用 try-except 防止数据访问异常
            """
            if self._col_idx_cst != -1 or self._col_idx_pn != -1:
                try:
                    cst_val = str(self._data.iloc[row, self._col_idx_cst]) if self._col_idx_cst != -1 else ""
                    pn_val = str(self._data.iloc[row, self._col_idx_pn]) if self._col_idx_pn != -1 else ""

                    # 汇总行给一个浅灰色/浅蓝色背景
                    if "--" in cst_val:
                        return QColor("#F2F6FC")
                    # 总计行给一个浅绿色背景
                    if "总计" == pn_val:
                        return QColor("#E1F3D8")
                except:
                    # 数据访问异常，跳过背景颜色设置
                    pass

        # =========================================================
        # --- 7. [新增] 尺寸验证颜色 (ForegroundRole) ---
        # =========================================================
        elif role == Qt.ForegroundRole:
            """
            尺寸验证颜色处理逻辑：
            
            根据业务需求，当 P/N 值与对应尺寸不匹配时，需要将尺寸单元格显示为红色文本，
            以提醒用户注意数据不一致问题。
            
            验证条件：
            1. 尺寸验证功能必须启用（_size_validation_enabled = True）
            2. "对应尺寸"列必须存在（_col_idx_size != -1）
            3. 当前单元格必须是"对应尺寸"列（df_col_index == self._col_idx_size）
            
            验证流程：
            1. 获取当前行的 P/N 值和对应尺寸值
            2. 调用 _validate_size_match() 方法进行匹配验证
            3. 如果不匹配，返回配置的红色颜色值
            
            颜色配置：
            - 颜色值从 config.size_mismatch_color 加载，默认为红色
            - 支持自定义颜色，以适应不同的UI主题
            
            性能优化：
            - 只在满足所有条件时才进行验证，避免不必要的计算
            - 使用 try-except 防止数据访问异常
            - 验证结果缓存：每次渲染都会重新验证，因为数据可能动态变化
            """
            # 只有当尺寸验证功能开启且当前列是"对应尺寸"列时才进行判断
            if (self._size_validation_enabled and
                self._col_idx_size != -1 and
                df_col_index == self._col_idx_size):
                
                try:
                    # 获取当前行的P/N和对应尺寸值
                    pn_val = str(self._data.iloc[row, self._col_idx_pn]) if self._col_idx_pn != -1 else ""
                    size_val = str(self._data.iloc[row, self._col_idx_size]) if self._col_idx_size != -1 else ""
                    
                    # 检查尺寸是否匹配
                    if not self._validate_size_match(pn_val, size_val):
                        # 不匹配，返回红色
                        return QColor(self._size_mismatch_color)
                except:
                    # 数据访问异常，跳过颜色验证
                    pass

        return None
    
    def headerData(self, section: int, orientation: Qt.Orientation, role: int = Qt.DisplayRole) -> Any:
        """
        返回表头数据
        
        这是 QAbstractTableModel 必须重写的方法，用于提供水平和垂直表头的数据。
        水平表头显示列名，垂直表头显示行号（从1开始）。
        
        Args:
            section: 表头部分（行号或列号）
            orientation: 方向，Horizontal 表示水平表头，Vertical 表示垂直表头
            role: 数据角色，通常为 DisplayRole 或 TextAlignmentRole
        
        Returns:
            Any: 表头数据，可能为字符串（列名或行号）或对齐方式
        
        Notes:
            水平表头处理逻辑：
            1. 如果显示行号列，第0列显示 "No"
            2. 计算实际 DataFrame 列索引
            3. 处理多级表头（元组列名）：只显示最内层名称
            4. 普通列名直接显示
            
            垂直表头：显示行号（从1开始）
            
            对齐方式：所有表头内容居中显示
        """
        if role == Qt.DisplayRole:
            if orientation == Qt.Horizontal:
                # --- [修复] 重新梳理索引计算逻辑 ---
                col_idx: int
                if self._show_row_numbers:
                    if section == 0:
                        return "No"
                    col_idx = section - 1
                else:
                    col_idx = section  # 透视表直接使用 section 作为索引

                # --- [修复] 统一的列名获取逻辑 (移出 if 块) ---
                if 0 <= col_idx < len(self._data.columns):
                    col_item: Any = self._data.columns[col_idx]
                    
                    # 如果列名是元组 (例如: ('可用', 'PNP'))
                    if isinstance(col_item, tuple):
                        # UI中不需要显示"可用"/"不可用"分类，只显示子项名称
                        # 例如: ('可用', 'PNP') -> 显示 "PNP"
                        # 如果元组有多个元素，取最后一个作为显示名称
                        if len(col_item) > 0:
                            return str(col_item[-1])  # 取最后一个元素
                        else:
                            return ""
                    return str(col_item)
                        
            elif orientation == Qt.Vertical:
                return str(section + 1)
        
        elif role == Qt.TextAlignmentRole:
            return Qt.AlignCenter
        
        return None
    
    def _validate_size_match(self, pn_value: str, size_value: str) -> bool:
        """
        验证 P/N 值与对应尺寸是否匹配
        
        该方法实现了复杂的尺寸匹配验证算法，根据业务规则检查 P/N 值中的数字部分
        是否与尺寸字符串中的数字匹配。支持多种匹配模式，包括直接包含、拆分匹配、
        特殊映射和连续子串匹配。
        
        算法流程：
        1. 特殊值处理："All Size" 总是匹配，空值视为匹配
        2. 数字提取：从 P/N 值中提取指定位置和长度的数字子串
        3. 多层匹配检查：
           a. 直接包含：检查尺寸字符串是否直接包含提取的数字
           b. 拆分匹配：对于4位数字，检查前2位和后2位是否都在尺寸字符串中
           c. 特殊映射：检查配置的特殊映射规则（如 "65" -> "65/55"）
           d. 连续子串：检查尺寸字符串是否包含提取数字的任意2位连续子串
        
        Args:
            pn_value: P/N 值字符串，例如 "ABC7748XYZ" 或 "6555"
            size_value: 对应尺寸值字符串，例如 "77/48"、"65" 或 "65/55"
        
        Returns:
            bool: True 表示匹配，False 表示不匹配
        
        Raises:
            无显式异常，但内部异常会被捕获并返回 True（视为匹配）
        
        Notes:
            1. 配置参数：
               - pn_extract_start: P/N 值中数字提取的起始位置（从0开始）
               - pn_extract_length: 提取的数字长度（通常为4）
               - size_special_mappings: 特殊映射字典，如 {"65": "65/55"}
               - all_size_value: "All Size" 特殊值字符串
            
            2. 匹配规则示例：
               - P/N "7748" 匹配尺寸 "77/48"（拆分匹配）
               - P/N "6555" 匹配尺寸 "65"（特殊映射）
               - P/N "1234" 匹配尺寸 "12/34"（拆分匹配）
               - P/N "ABCD" 匹配任何尺寸（提取失败视为匹配）
            
            3. 性能考虑：
               - 方法被频繁调用（每个尺寸单元格渲染时），因此需要高效
               - 使用简单的字符串操作，避免正则表达式以提高性能
               - 异常处理返回 True 以避免影响用户体验
        """
        # 如果尺寸值是"All Size"，总是匹配
        if size_value == self._all_size_value:
            return True
        
        # 如果P/N值或尺寸值为空，无法验证，视为匹配
        if not pn_value or not size_value:
            return True
        
        # 从P/N值中提取数字部分（第7位到第10位）
        pn_digits: str = ""
        try:
            # 确保P/N值足够长
            if len(pn_value) >= self._pn_extract_start + self._pn_extract_length:
                pn_digits = pn_value[self._pn_extract_start:self._pn_extract_start + self._pn_extract_length]
            else:
                # P/N值太短，无法提取，视为匹配
                return True
        except:
            # 提取失败，视为匹配
            return True
        
        # 1. 首先检查尺寸值中是否直接包含提取的4位数字
        if pn_digits in size_value:
            return True
        
        # 2. 对于4位数字，检查前2位和后2位是否都在尺寸字符串中
        # 例如：7748 -> 检查77和48是否都在尺寸字符串中
        if len(pn_digits) == 4:
            first_two: str = pn_digits[:2]
            last_two: str = pn_digits[2:]
            
            if first_two in size_value and last_two in size_value:
                return True
        
        # 3. 检查特殊映射：如果提取的数字是"65"，需要特殊处理
        # 根据用户要求："65默认为65/55，所以同样存在"
        # 这意味着如果尺寸字符串包含"65"或"65/55"，都视为匹配
        if pn_digits == "65":
            if "65" in size_value or "65/55" in size_value:
                return True
        
        # 4. 检查其他特殊映射
        for key, mapped_value in self._size_special_mappings.items():
            if pn_digits == key:
                # 检查尺寸字符串中是否包含映射值
                if mapped_value in size_value:
                    return True
                # 同时检查是否直接包含key本身
                if key in size_value:
                    return True
        
        # 5. 对于其他情况，检查尺寸字符串中是否包含提取数字的任意2位连续子串
        # 例如：6555 -> 检查55是否在尺寸字符串中（如果65不在）
        if len(pn_digits) >= 2:
            for i in range(len(pn_digits) - 1):
                two_digits: str = pn_digits[i:i+2]
                if two_digits in size_value:
                    return True
        
        # 都不匹配，返回False
        return False
    
    def set_size_validation_enabled(self, enabled: bool) -> None:
        """
        设置尺寸验证功能是否启用
        
        该方法控制尺寸验证功能的开关状态。当状态改变时，会触发 dataChanged 信号，
        通知所有关联的视图重新渲染，以反映新的验证状态（尺寸不匹配的单元格会显示红色文本）。
        
        Args:
            enabled: 尺寸验证功能状态，True 表示启用，False 表示禁用
        
        Returns:
            None
        
        Notes:
            1. 功能影响：
               - 启用时：尺寸不匹配的单元格会显示为红色文本
               - 禁用时：所有单元格使用默认文本颜色
            
            2. 性能考虑：
               - 状态改变会触发全表重绘，对于大型表格可能有性能影响
               - 建议在用户交互时调用，而不是在频繁的数据更新循环中
            
            3. 信号机制：
               - 使用 dataChanged 信号通知所有关联的视图
               - 信号范围覆盖整个表格（从 (0,0) 到 (rowCount-1, columnCount-1)）
            
            4. 使用场景：
               - 用户通过 UI 开关控制尺寸验证功能
               - 程序根据数据模式自动启用/禁用验证
        """
        self._size_validation_enabled = enabled
        # 通知视图数据已更改，需要重新渲染
        self.dataChanged.emit(
            self.index(0, 0),
            self.index(self.rowCount() - 1, self.columnCount() - 1)
        )
    
    def is_size_validation_enabled(self) -> bool:
        """
        获取尺寸验证功能是否启用
        
        该方法返回当前尺寸验证功能的状态。状态决定了表格中尺寸不匹配的单元格
        是否显示为红色文本。
        
        Returns:
            bool: True 表示尺寸验证功能已启用，False 表示已禁用
        
        Notes:
            1. 状态来源：
               - 初始化时从 config.size_validation_enabled 加载
               - 可通过 set_size_validation_enabled() 方法动态修改
            
            2. 使用场景：
               - UI 组件查询当前状态以更新显示（如复选框状态）
               - 其他模块需要知道验证状态以决定是否执行相关操作
            
            3. 性能考虑：
               - 方法只返回布尔值，性能开销极小
               - 适合在渲染循环中频繁调用
            
            4. 与 _validate_size_match 的关系：
               - 当启用时，data() 方法会调用 _validate_size_match 进行验证
               - 当禁用时，data() 方法跳过验证，直接返回 None
        """
        return self._size_validation_enabled