"""
配置文件 - 管理应用程序的所有配置项
"""

import json
import os
from dataclasses import dataclass, asdict
from typing import List, Dict, Any, Optional


@dataclass
class AppConfig:
    """应用程序配置类"""
    
    # 窗口配置
    window_title: str = "JIG Data Finder"
    window_size: tuple = (1400, 800)
    window_padding: int = 8 # 增加边缘检测距离，改善鼠标缩放标志显示
    
    # UI布局配置
    gap_size: int = 16
    header_height: int = 40
    left_panel_min_width: int = 250
    left_panel_max_width: int = 300
    splitter_sizes: List[int] = None  # 默认在__post_init__中设置
    
    # 表格配置
    table_row_number_width: int = 60 # 行号列宽
    table_default_column_width: int = 106 # 默认列宽
    adaptive_columns: List[str] = None  # 自适应宽度指定列
    table_default_row_height: int = 30 # 默认行高
    table_row_height_min: int = 20   # 最小行高
    table_row_height_max: int = 30   # 最大行高

    # 数据配置
    output_columns: List[str] = None  # 输出列顺序
    sort_columns: List[str] = None    # 排序列
    numeric_sort_columns: List[str] = None  # 需要数值排序的列
    
    # 文件配置
    default_export_filename: str = "查询结果.xlsx"
    excel_file_filter: str = "Excel Files (*.xlsx *.xls)"
    default_file_dialog_path: str = ""  # 文件对话框默认路径，空字符串表示使用系统默认
    default_export_path: str = ""  # 导出文件默认保存路径，空字符串表示使用系统默认
    
    # 样式配置
    stylesheet_filename: str = "style.qss"

    # 透视表数据配置 
    pivot_exclude_pns: List[str] = None  # 要在透视表中排除的 P/N 列表
    pivot_index_cols: List[str] = None  # 透视表的基础行索引 (源数据中的列名)
    pivot_value_col: str = "Jig ID"  # 透视表的数值列 (源数据中的列名)
    pivot_column_key: str = "工程名"  # 透视表的列分组依据 (源数据中的列名)
    # 工程配置 (工程名称 -> {Info})
    engineering_config: Dict[str, Dict] = None  # 作用：定义排序顺序(order)
    pivot_exclude_names: List[str] = None  # 透视表排除的工程名称列表
    production_indicator_code: str = "50000" # 生产中判定的关键工程代码

    # JIG 型号与尺寸组合的映射配置
    jig_size_mapping: Dict[str, str] = None

    # Jig 状态配置
    jig_status_column: str = "Jig状态"
    jig_status_active_value: str = "INPRODUCTION"

    # 业务关键字配置
    keyword_total: str = "总计"

    # 尺寸验证配置
    size_validation_enabled: bool = False  # 默认关闭尺寸验证
    pn_extract_start: int = 6  # P/N提取起始位置（0-based索引）
    pn_extract_length: int = 4  # 提取长度
    size_special_mappings: Dict[str, str] = None  # 特殊尺寸映射，如{"65": "65/55"}
    all_size_value: str = "All Size"  # 特殊尺寸值，表示所有尺寸都匹配
    size_mismatch_color: str = "#EF4444"  # 尺寸不匹配的文本颜色

    # 剪贴板处理配置
    clipboard_auto_process_enabled: bool = True  # 是否启用剪贴板自动处理功能

    # 错误消息配置
    error_messages: Dict[str, str] = None
    
    def __post_init__(self):
        """初始化默认值"""
        if self.splitter_sizes is None:
            self.splitter_sizes = [280, 1000]
        
        if self.adaptive_columns is None:
            self.adaptive_columns = ["Slot No", "Jig 对应型号", "Glass判定","对应尺寸","工程名"]
        
        if self.output_columns is None:
            self.output_columns = ["P/N", "Lot ID", "CST ID", "Slot No", "Jig ID", "工程名", "Glass判定","Jig 对应型号"]
        
        if self.sort_columns is None:
            self.sort_columns = ["P/N", "Lot ID", "CST ID", "Slot No"]
        
        if self.numeric_sort_columns is None:
            self.numeric_sort_columns = ["Slot No"]

        if self.pivot_exclude_pns is None:
            self.pivot_exclude_pns = []  # 可以在这里填入你想要默认屏蔽的 P/N      
        
        if self.pivot_exclude_names is None:
            self.pivot_exclude_names = [] # 例如 ["Jig入库"]

        if self.pivot_index_cols is None:
            self.pivot_index_cols = ["P/N", "CST ID"]
        
        if self.error_messages is None:
            self.error_messages = {
                "file_not_found": "错误: 找不到样式表文件 {path}，将使用默认样式",
                "load_stylesheet_error": "加载样式表时出错: {error}",
                "excel_load_error": "加载Excel文件时出错: {error}",
                "excel_export_error": "导出Excel文件时出错: {error}",
                "missing_jig_id_column": "源文件中未找到 'Jig ID' 列！请检查表头。",
                "no_data_loaded": "请先加载源数据！",
                "no_input_ids": "请输入要查询的Jig ID",
                "no_result_to_export": "没有查询结果可以导出",
                "clear_confirm": "确定要清空输入和查询结果吗？",
            }

            self.jig_size_mapping = {
                "184": "65", "420A": "65", "420B": "65", 
                "477": "65", "502": "65", "502A": "65",

                "430": "65_77/48_83/48", 
                "502N": "65_77/48_83/48",

                "508": "77/48_83/48", 
                "509": "77/48_83/48",

                "252": "65_77/27_77/42_77/48_83/48",

                "508N": "77/27_77/42_77/48_83/48", 
                "509N": "77/27_77/42_77/48_83/48",
                
                "256": "39/31_77/27_77/42_77/48_83/48", 
                "252A": "39/31_77/27_77/42_77/48_83/48",
                
                "262": "All Size"
            }

        # 初始化尺寸特殊映射
        if self.size_special_mappings is None:
            self.size_special_mappings = {
                "65": "65/55"  # "65"默认为"65/55"
            }

        # 初始化工程配置
        if self.engineering_config is None:
            self.engineering_config = {
                "PNP": {"order": 10},
                "Jig 洗净及检查": {"order": 20},
                "Jig Loading": {"order": 30},
                "Jig Unloading": {"order": 40},
                "Jig N判定 另外移载": {"order": 50},
                "Jig 分离": {"order": 60},
                "目视Stage": {"order": 70},
                "Jig 搬出待机": {"order": 80},
                "Jig搬出": {"order": 90},
                "Jig入库": {"order": 100}
            }


    @classmethod
    def load(cls, config_path: str = "config.json") -> 'AppConfig':
        """
        从JSON文件加载配置
        
        Args:
            config_path: 配置文件路径
            
        Returns:
            AppConfig实例
        """
        if os.path.exists(config_path):
            try:
                with open(config_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                return cls(**data)
            except Exception as e:
                print(f"加载配置文件失败，使用默认配置: {e}")
        
        # 如果文件不存在或加载失败，返回默认配置
        return cls()
    
    def save(self, config_path: str = "config.json"):
        """
        保存配置到JSON文件
        
        Args:
            config_path: 配置文件路径
        """
        try:
            # 转换dataclass为字典
            data = asdict(self)
            
            # 确保目录存在
            os.makedirs(os.path.dirname(os.path.abspath(config_path)), exist_ok=True)
            
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            print(f"配置已保存到: {config_path}")
        except Exception as e:
            print(f"保存配置文件失败: {e}")
    
    def get_error_message(self, key: str, **kwargs) -> str:
        """
        获取错误消息
        
        Args:
            key: 错误消息键
            **kwargs: 格式化参数
            
        Returns:
            格式化后的错误消息
        """
        msg = self.error_messages.get(key, f"未知错误: {key}")
        return msg.format(**kwargs) if kwargs else msg


# 全局配置实例 - 自动从配置文件加载，如果文件不存在则使用默认配置
config = AppConfig.load()


if __name__ == "__main__":
    # 测试配置
    print("当前配置:")
    print(json.dumps(asdict(config), ensure_ascii=False, indent=2))
    
    # 保存示例配置
    config.save("config.example.json")
    print("\n示例配置文件已保存为: config.example.json")
