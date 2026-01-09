"""
路径工具模块 - 提供资源路径获取功能

本模块提供统一的资源路径获取方法，兼容开发环境和打包环境。
"""

import sys
import os


def get_resource_path(relative_path: str) -> str:
    """
    获取资源文件路径（兼容开发环境和打包环境）
    
    Args:
        relative_path: 相对路径
        
    Returns:
        完整的资源文件路径
        
    Notes:
        - 开发环境：使用 src 目录作为基准（向上两级到项目根目录，再进入 src）
        - 打包环境：使用 sys._MEIPASS 作为基准
    """
    if getattr(sys, 'frozen', False):
        # 打包后的环境：使用 sys._MEIPASS
        base_path = sys._MEIPASS
    else:
        # 开发环境：使用 src 目录作为基准
        # 从 src/utils/path_utils.py 向上两级到达项目根目录，再进入 src 目录
        base_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    return os.path.join(base_path, relative_path)


def get_icon_path() -> str:
    """
    获取应用图标路径（兼容开发环境和打包环境）
    
    Returns:
        图标文件的完整路径
        
    Notes:
        - 开发环境：图标位于项目根目录
        - 打包环境：图标位于 sys._MEIPASS 根目录
    """
    if getattr(sys, 'frozen', False):
        # 打包后的环境：图标在 sys._MEIPASS 根目录
        return os.path.join(sys._MEIPASS, 'new.ico')
    else:
        # 开发环境：图标在项目根目录
        # 从 src/utils/path_utils.py 向上两级到达项目根目录
        return os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'new.ico'))
