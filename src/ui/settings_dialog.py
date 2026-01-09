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

from PySide2.QtWidgets import (QDialog, QVBoxLayout, QHBoxLayout, QLabel,
                             QPushButton, QWidget, QFrame, QScrollArea,
                             QLineEdit, QFileDialog, QGridLayout)
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

        
        # 添加文件设置分组到内容布局
        content_layout.addWidget(file_settings_frame)
        
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
        
    def get_settings(self):
        """
        获取当前设置值
        
        返回:
            dict: 包含所有设置值的字典
        """
        settings = {
            "default_file_dialog_path": self.default_path_edit.text().strip()
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


if __name__ == "__main__":
    # 测试代码
    import sys
    from PySide2.QtWidgets import QApplication
    
    app = QApplication(sys.argv)
    dialog = SettingsDialog()
    dialog.show()
    sys.exit(app.exec_())