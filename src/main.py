"""
JIG数据查询助手 - 主入口文件
"""

import sys
import os

# 导入路径工具模块
from utils.path_utils import get_resource_path, get_icon_path

# 添加当前目录到Python路径，确保可以正确导入src模块
sys.path.insert(0, get_resource_path("."))

from PySide2.QtWidgets import QApplication
from PySide2.QtGui import QIcon

# 因为src目录已添加到sys.path，所以可以直接导入子模块
from ui.main_window import MainWindow
from app.config import config


def load_stylesheet(app, filename=None):
    """
    加载外部 QSS 文件，自动处理路径问题
    """
    if filename is None:
        filename = config.stylesheet_filename
    
    # 使用 get_resource_path 获取样式文件路径（兼容打包环境）
    file_path = get_resource_path(os.path.join("styles", filename))

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            style = f.read()
            app.setStyleSheet(style)
            print(f"成功加载样式表: {file_path}")
    except FileNotFoundError:
        print(config.get_error_message("file_not_found", path=file_path))
    except Exception as e:
        print(config.get_error_message("load_stylesheet_error", error=e))


def main():
    """主函数"""
    app = QApplication(sys.argv)
    
    # 设置应用图标
    icon_path = get_icon_path()
    if os.path.exists(icon_path):
        app.setWindowIcon(QIcon(icon_path))
        print(f"成功加载应用图标: {icon_path}")
    else:
        print(f"警告: 图标文件不存在: {icon_path}")
    
    # 加载样式
    load_stylesheet(app, "style.qss")
    
    # 创建并显示主窗口
    window = MainWindow()
    window.show()
    
    # 运行应用
    sys.exit(app.exec_())


if __name__ == "__main__":
    main()
