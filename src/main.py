"""
JIG数据查询助手 - 主入口文件
"""

import sys
import os

# 导入路径工具模块
from utils.path_utils import get_resource_path, get_icon_path

# 添加当前目录到Python路径，确保可以正确导入src模块
sys.path.insert(0, get_resource_path("."))

from PySide2.QtWidgets import QApplication, QSystemTrayIcon, QMenu, QAction
from PySide2.QtGui import QIcon
from PySide2.QtCore import QObject
from ui.main_window import MainWindow
from app.config import config


class SystemTray(QSystemTrayIcon):
    """系统托盘类，提供最小化到托盘功能"""
    
    def __init__(self, main_window, parent=None):
        super().__init__(parent)
        self.main_window = main_window
        
        # 设置托盘图标
        self.setup_tray_icon()
        
        # 创建托盘菜单
        self.setup_tray_menu()
        
        # 连接信号
        self.activated.connect(self.on_tray_activated)
        
        # 显示托盘图标
        if self.supportsMessages():
            self.showMessage(
                "JIG Data Finder", 
                "程序已启动，点击托盘图标可显示/隐藏主窗口",
                QSystemTrayIcon.Information,
                2000
            )
    
    def setup_tray_icon(self):
        """设置托盘图标"""
        # 尝试使用应用图标
        icon_path = get_icon_path()
        if os.path.exists(icon_path):
            self.setIcon(QIcon(icon_path))
        else:
            # 如果图标文件不存在，使用系统默认图标
            # 在Windows上可以使用内置图标
            self.setIcon(self.style().standardIcon(
                getattr(self.style(), 'SP_ComputerIcon', 0)
            ))
        
        # 设置工具提示
        self.setToolTip("JIG Data Finder - 数据查询助手")
    
    def setup_tray_menu(self):
        """创建托盘右键菜单"""
        tray_menu = QMenu()
        
        # 显示/隐藏主窗口
        show_action = QAction("显示主窗口", self)
        show_action.triggered.connect(self.show_main_window)
        tray_menu.addAction(show_action)
        
        # 分隔线
        tray_menu.addSeparator()
        
        # 退出程序
        quit_action = QAction("退出程序", self)
        quit_action.triggered.connect(self.quit_application)
        tray_menu.addAction(quit_action)
        
        self.setContextMenu(tray_menu)
    
    def on_tray_activated(self, reason):
        """处理托盘图标激活事件"""
        if reason == QSystemTrayIcon.DoubleClick:
            # 双击：显示主窗口并置顶
            self.show_main_window()
            self.main_window.raise_()
            self.main_window.activateWindow()
        elif reason == QSystemTrayIcon.Trigger:
            # 单击：切换显示/隐藏
            if self.main_window.isVisible():
                self.hide_main_window()
            else:
                self.show_main_window()
    
    def show_main_window(self):
        """显示主窗口"""
        self.main_window.show()
        self.main_window.raise_()
        self.main_window.activateWindow()
    
    def hide_main_window(self):
        """隐藏主窗口到托盘"""
        self.main_window.hide()
    
    def quit_application(self):
        """退出应用程序"""
        # 设置标志，表示要真正退出程序
        self.main_window.force_quit = True
        self.main_window.close()  # 这会触发主窗口的closeEvent


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
    
    # 初始化系统托盘（如果启用）
    tray_icon = None
    if config.tray_enabled and QSystemTrayIcon.isSystemTrayAvailable():
        tray_icon = SystemTray(window)
        window.tray_icon = tray_icon  # 将托盘图标引用传递给主窗口
        tray_icon.show()
        print("系统托盘功能已启用")
    elif not QSystemTrayIcon.isSystemTrayAvailable():
        print("警告: 系统不支持托盘功能")
    else:
        print("系统托盘功能已禁用")
    
    window.show()
    
    # 运行应用
    sys.exit(app.exec_())


if __name__ == "__main__":
    main()
