"""
设置对话框 - 应用程序设置界面

本模块包含 SettingsDialog 类，这是一个继承自 QDialog 的设置对话框，
用于显示和修改应用程序的各种设置项。

主要功能:
1. 提供基本的设置界面框架
2. 预留设置项的接口，便于后续扩展
3. 采用与主窗口一致的浅色风格

类:
    SettingsDialog: 设置对话框类

依赖:
    PySide2.QtWidgets: Qt对话框基类
    PySide2.QtCore: Qt核心模块
    app.config: 应用程序配置

版本: 1.0.0
作者: JIG Data Finder开发团队
日期: 2026-01-09
"""

import sys
import os

# 添加src目录到路径，以便可以导入其他模块
current_dir = os.path.dirname(os.path.abspath(__file__))
src_dir = os.path.dirname(current_dir)
if src_dir not in sys.path:
    sys.path.insert(0, src_dir)

from PySide2.QtWidgets import (QDialog, QVBoxLayout, QHBoxLayout, QLabel,
                             QPushButton, QWidget, QFrame, QScrollArea,
                             QLineEdit, QFileDialog, QSpinBox)
from PySide2.QtCore import Qt
from app.config import config


class SettingsDialog(QDialog):
    """
    设置对话框类
    
    该类继承自 QDialog，用于显示应用程序的设置界面。采用模态对话框形式，
    确保设置界面显示时主窗口不可操作。
    
    主要功能：
        1. 提供基本的设置界面布局
        2. 预留设置项的接口（暂时不添加具体设置项）
        3. 提供确定和取消按钮
        4. 应用与主窗口一致的浅色风格
    
    使用方法：
        在主窗口中创建 SettingsDialog 实例并调用 exec_() 方法显示。
    """
    
    def __init__(self, parent=None):
        """
        初始化 SettingsDialog 实例
        
        Args:
            parent: 父窗口对象，默认为None
        """
        super().__init__(parent)
        
        # 设置对话框属性
        self.setWindowTitle("设置")
        self.setModal(True)  # 设置为模态对话框
        self.setMinimumWidth(900)
        self.setMinimumHeight(600)
        
        # 初始化UI
        self.init_ui()
        
    def init_ui(self):
        """
        初始化设置对话框的用户界面组件和布局。
        
        主要功能：
        1. 创建主布局和滚动区域
        2. 创建设置内容区域（预留接口）
        3. 创建底部按钮区域（确定、取消）
        4. 应用与主窗口一致的样式
        """
        # 创建主垂直布局
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)
        
        # 创建滚动区域，用于容纳设置内容
        scroll_area = QScrollArea()
        scroll_area.setWidgetResizable(True)
        scroll_area.setHorizontalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        scroll_area.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        
        # 创建设置内容容器
        content_widget = QWidget()
        content_widget.setObjectName("SettingsContent")
        content_layout = QVBoxLayout(content_widget)
        content_layout.setContentsMargins(20, 20, 20, 20)
        content_layout.setSpacing(16)
        
        # =========================================
        # 设置内容区域
        # =========================================
        
        # 标题标签
        title_label = QLabel("应用程序设置")
        title_label.setObjectName("SettingsTitle")
        title_label.setAlignment(Qt.AlignCenter)
        content_layout.addWidget(title_label)
        
        # 分隔线
        separator = QFrame()
        separator.setFrameShape(QFrame.HLine)
        separator.setFrameShadow(QFrame.Sunken)
        separator.setObjectName("SettingsSeparator")
        content_layout.addWidget(separator)
        
        # =========================================
        # 文件设置分组
        # =========================================
        file_settings_frame = QFrame()
        file_settings_frame.setObjectName("SettingsGroupFrame")
        file_settings_layout = QVBoxLayout(file_settings_frame)
        file_settings_layout.setContentsMargins(0, 0, 0, 0)
        file_settings_layout.setSpacing(8)
        
        # 文件设置分组标题
        file_settings_title = QLabel("文件设置")
        file_settings_title.setObjectName("SettingsGroupTitle")
        file_settings_layout.addWidget(file_settings_title)
        
        # 默认文件路径设置
        default_path_container = QWidget()
        default_path_layout = QHBoxLayout(default_path_container)
        default_path_layout.setContentsMargins(0, 0, 0, 0)
        default_path_layout.setSpacing(8)
        
        # 标签
        default_path_label = QLabel("默认文件路径:")
        default_path_label.setFixedWidth(80)
        
        # 路径输入框
        self.default_path_edit = QLineEdit()
        self.default_path_edit.setPlaceholderText("留空表示使用系统默认路径")
        self.default_path_edit.setEnabled(False)
        self.default_path_edit.setText(config.default_file_dialog_path)
        
        # 浏览按钮
        self.btn_browse_default_path = QPushButton("···")
        self.btn_browse_default_path.setCursor(Qt.PointingHandCursor)
        self.btn_browse_default_path.setFixedWidth(40)
        
        # 组装默认路径设置
        default_path_layout.addWidget(default_path_label)
        default_path_layout.addWidget(self.default_path_edit, 1)
        default_path_layout.addWidget(self.btn_browse_default_path)

        file_settings_layout.addWidget(default_path_container)
        
        # 默认导出路径设置
        default_export_path_container = QWidget()
        default_export_path_layout = QHBoxLayout(default_export_path_container)
        default_export_path_layout.setContentsMargins(0, 0, 0, 0)
        default_export_path_layout.setSpacing(8)
        
        # 标签
        default_export_path_label = QLabel("默认导出路径:")
        default_export_path_label.setFixedWidth(80)
        
        # 路径输入框
        self.default_export_path_edit = QLineEdit()
        self.default_export_path_edit.setPlaceholderText("留空表示使用系统默认路径")
        self.default_export_path_edit.setEnabled(False)
        self.default_export_path_edit.setText(config.default_export_path)
        
        # 浏览按钮
        self.btn_browse_default_export_path = QPushButton("···")
        self.btn_browse_default_export_path.setCursor(Qt.PointingHandCursor)
        self.btn_browse_default_export_path.setFixedWidth(40)
        
        # 组装默认导出路径设置
        default_export_path_layout.addWidget(default_export_path_label)
        default_export_path_layout.addWidget(self.default_export_path_edit, 1)
        default_export_path_layout.addWidget(self.btn_browse_default_export_path)

        file_settings_layout.addWidget(default_export_path_container)

        
        # 添加文件设置分组到内容布局
        content_layout.addWidget(file_settings_frame)
        
        # =========================================
        # 界面设置分组
        # =========================================
        ui_settings_frame = QFrame()
        ui_settings_frame.setObjectName("SettingsGroupFrame")
        ui_settings_layout = QVBoxLayout(ui_settings_frame)
        ui_settings_layout.setContentsMargins(0, 0, 0, 0)
        ui_settings_layout.setSpacing(8)
        
        # 界面设置分组标题
        ui_settings_title = QLabel("界面设置")
        ui_settings_title.setObjectName("SettingsGroupTitle")
        ui_settings_layout.addWidget(ui_settings_title)
        
        # 表格行高设置
        row_height_container = QWidget()
        row_height_layout = QHBoxLayout(row_height_container)
        row_height_layout.setContentsMargins(0, 0, 0, 0)
        row_height_layout.setSpacing(8)
        
        # 标签
        row_height_label = QLabel("表格行高:")
        row_height_label.setFixedWidth(80)
        
        # 行高输入框
        self.row_height_spinbox = QSpinBox()
        self.row_height_spinbox.setRange(config.table_row_height_min, config.table_row_height_max)
        self.row_height_spinbox.setValue(config.table_default_row_height)
        self.row_height_spinbox.setFixedWidth(80)  # 限制宽度为100px
        
        # 组装行高设置
        row_height_layout.addWidget(row_height_label)
        row_height_layout.addWidget(self.row_height_spinbox)  # 移除stretch参数
        
        # 提醒标签
        restart_tip = QLabel("(保存后需重启软件生效)")
        restart_tip.setStyleSheet("color: #666; font-size: 11px;")
        row_height_layout.addWidget(restart_tip)
        
        row_height_layout.addStretch()  # 添加弹簧，确保输入框靠左对齐
        ui_settings_layout.addWidget(row_height_container)
        
        # 窗口大小设置
        window_size_container = QWidget()
        window_size_layout = QHBoxLayout(window_size_container)
        window_size_layout.setContentsMargins(0, 0, 0, 0)
        window_size_layout.setSpacing(8)
        
        # 标签
        window_size_label = QLabel("窗口大小:")
        window_size_label.setFixedWidth(80)
        
        # 宽度输入框
        self.window_width_spinbox = QSpinBox()
        self.window_width_spinbox.setRange(800, 1920)  # 最小800，最大1920
        self.window_width_spinbox.setValue(config.window_size[0])
        self.window_width_spinbox.setFixedWidth(80)
        
        # 尺寸连接符
        size_connector = QLabel("×")
        size_connector.setAlignment(Qt.AlignCenter)
        size_connector.setFixedWidth(20)
        
        # 高度输入框
        self.window_height_spinbox = QSpinBox()
        self.window_height_spinbox.setRange(600, 1080)  # 最小600，最大1080
        self.window_height_spinbox.setValue(config.window_size[1])
        self.window_height_spinbox.setFixedWidth(80)
        
        # 组装窗口大小设置
        window_size_layout.addWidget(window_size_label)
        window_size_layout.addWidget(self.window_width_spinbox)
        window_size_layout.addWidget(size_connector)
        window_size_layout.addWidget(self.window_height_spinbox)
        window_size_layout.addStretch()  # 添加弹簧，确保控件靠左对齐
        ui_settings_layout.addWidget(window_size_container)
        
        # 添加界面设置分组到内容布局
        content_layout.addWidget(ui_settings_frame)
        
        # 添加弹簧，将内容推到顶部
        content_layout.addStretch()
        
        # 将内容容器设置为滚动区域的部件
        scroll_area.setWidget(content_widget)
        main_layout.addWidget(scroll_area, 1)  # 滚动区域占据主要空间
        
        # =========================================
        # 底部按钮区域
        # =========================================
        button_frame = QFrame()
        button_frame.setObjectName("SettingsButtonFrame")
        button_layout = QHBoxLayout(button_frame)
        button_layout.setContentsMargins(20, 16, 20, 16)
        button_layout.setSpacing(12)
        
        # 添加弹簧，将按钮推到右侧
        button_layout.addStretch()
        
        # 确定按钮
        self.btn_ok = QPushButton("确定")
        self.btn_ok.setObjectName("btn_ok")
        self.btn_ok.setCursor(Qt.PointingHandCursor)
        self.btn_ok.setFixedWidth(80)
        
        # 取消按钮
        self.btn_cancel = QPushButton("取消")
        self.btn_cancel.setCursor(Qt.PointingHandCursor)
        self.btn_cancel.setFixedWidth(80)
        
        # 组装按钮布局
        button_layout.addWidget(self.btn_cancel)
        button_layout.addWidget(self.btn_ok)
        
        main_layout.addWidget(button_frame)
        
        # 绑定按钮事件
        self.btn_ok.clicked.connect(self.accept)
        self.btn_cancel.clicked.connect(self.reject)
        self.btn_browse_default_path.clicked.connect(self.browse_default_path)
        self.btn_browse_default_export_path.clicked.connect(self.browse_default_export_path)
        
    def browse_default_path(self):
        """
        浏览默认文件路径
        
        打开文件夹选择对话框，让用户选择默认的文件对话框路径。
        """
        # 打开文件夹选择对话框
        folder_path = QFileDialog.getExistingDirectory(
            self,
            "选择默认文件路径",
            self.default_path_edit.text() if self.default_path_edit.text() else ""
        )
        
        # 如果用户选择了路径，更新输入框
        if folder_path:
            self.default_path_edit.setText(folder_path)
    
    def browse_default_export_path(self):
        """
        浏览默认导出路径
        
        打开文件夹选择对话框，让用户选择默认的导出文件保存路径。
        """
        # 打开文件夹选择对话框
        folder_path = QFileDialog.getExistingDirectory(
            self,
            "选择默认导出路径",
            self.default_export_path_edit.text() if self.default_export_path_edit.text() else ""
        )
        
        # 如果用户选择了路径，更新输入框
        if folder_path:
            self.default_export_path_edit.setText(folder_path)
        
    def get_settings(self):
        """
        获取当前设置值
        
        返回:
            dict: 包含所有设置值的字典
        """
        settings = {
            "default_file_dialog_path": self.default_path_edit.text().strip(),
            "default_export_path": self.default_export_path_edit.text().strip(),
            "table_default_row_height": self.row_height_spinbox.value(),
            "window_size": (self.window_width_spinbox.value(), self.window_height_spinbox.value())
        }
        return settings
        
    def set_settings(self, settings):
        """
        设置界面值
        
        Args:
            settings: 包含设置值的字典
        """
        # 设置默认文件路径
        if "default_file_dialog_path" in settings:
            self.default_path_edit.setText(settings["default_file_dialog_path"])
        
        # 设置默认导出路径
        if "default_export_path" in settings:
            self.default_export_path_edit.setText(settings["default_export_path"])
        
        # 设置表格行高
        if "table_default_row_height" in settings:
            self.row_height_spinbox.setValue(settings["table_default_row_height"])
        
        # 设置窗口大小
        if "window_size" in settings:
            width, height = settings["window_size"]
            self.window_width_spinbox.setValue(width)
            self.window_height_spinbox.setValue(height)


if __name__ == "__main__":
    # 测试代码
    from PySide2.QtWidgets import QApplication

    app = QApplication(sys.argv)

    qss_path = os.path.join(src_dir, 'styles', 'style.qss')
    
    if os.path.exists(qss_path):
        try:
            # 读取 QSS 文件并应用
            with open(qss_path, 'r', encoding='utf-8') as f:
                style_sheet = f.read()
                app.setStyleSheet(style_sheet)
            print(f"成功加载样式表: {qss_path}")
        except Exception as e:
            print(f"样式表加载失败: {e}")
    else:
        print(f"警告: 找不到样式文件 {qss_path}")
    
    
    dialog = SettingsDialog()
    dialog.show()
    sys.exit(app.exec_())
