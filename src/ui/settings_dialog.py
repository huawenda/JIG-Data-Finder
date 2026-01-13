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

# 添加src目录到路径
current_dir = os.path.dirname(os.path.abspath(__file__))
src_dir = os.path.dirname(current_dir)
if src_dir not in sys.path:
    sys.path.insert(0, src_dir)

from PySide2.QtWidgets import (QDialog, QVBoxLayout, QHBoxLayout, QLabel,
                             QPushButton, QWidget, QFrame, QScrollArea,
                             QLineEdit, QFileDialog, QSpinBox, QCheckBox, QComboBox)
from PySide2.QtCore import Qt
from app.config import config


class SettingsDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("设置")
        self.setModal(True)
        self.resize(850, 600) #稍微调整默认尺寸
        
        # 1. 关键：设置对话框整体背景属性，确保能被 QSS 穿透
        self.setAttribute(Qt.WA_StyledBackground, True)
        self.setObjectName("SettingsDialog")
        
        self.init_ui()
        
    def init_ui(self):
        # 主布局
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)
        
        # 滚动区域
        scroll_area = QScrollArea()
        scroll_area.setWidgetResizable(True)
        scroll_area.setFrameShape(QFrame.NoFrame) # 去除滚动区域边框
        scroll_area.setObjectName("SettingsScrollArea")
        
        # 内容容器
        content_widget = QWidget()
        content_widget.setObjectName("SettingsContentWidget")
        content_widget.setAttribute(Qt.WA_StyledBackground, True)
        
        content_layout = QVBoxLayout(content_widget)
        content_layout.setContentsMargins(24, 24, 24, 24) # 增加外边距
        content_layout.setSpacing(20) # 卡片之间的间距
        
        # =========================================
        # 1. 文件设置卡片
        # =========================================
        card_file = self.create_card("文件路径配置")
        layout_file = card_file.layout()
        
        # 默认文件路径
        layout_file.addLayout(self.create_path_row(
            "源文件默认路径:", 
            self.create_line_edit(config.default_file_dialog_path, "default_path_edit"),
            self.browse_default_path
        ))
        
        # 默认导出路径
        layout_file.addLayout(self.create_path_row(
            "导出文件默认路径:", 
            self.create_line_edit(config.default_export_path, "default_export_path_edit"),
            self.browse_default_export_path
        ))
        
        content_layout.addWidget(card_file)
        
        # =========================================
        # 2. 界面设置卡片
        # =========================================
        card_ui = self.create_card("界面显示")
        layout_ui = card_ui.layout()
        
        # 表格行高
        row_height_layout = QHBoxLayout()
        lbl_height = QLabel("表格行高:")
        lbl_height.setFixedWidth(55)
        
        self.row_height_spinbox = QSpinBox()
        self.row_height_spinbox.setRange(config.table_row_height_min, config.table_row_height_max)
        self.row_height_spinbox.setValue(config.table_default_row_height)
        self.row_height_spinbox.setFixedWidth(80)
        self.row_height_spinbox.setFixedHeight(25) # 统一高度
        
        lbl_tip = QLabel(" (保存后需重启软件生效)")
        lbl_tip.setObjectName("TipLabel")
        
        row_height_layout.addWidget(lbl_height)
        row_height_layout.addWidget(self.row_height_spinbox)
        row_height_layout.addWidget(lbl_tip)
        row_height_layout.addStretch()
        
        layout_ui.addLayout(row_height_layout)
        
        # 窗口大小
        win_size_layout = QHBoxLayout()
        lbl_size = QLabel("窗口尺寸:")
        lbl_size.setFixedWidth(55)
        
        self.window_width_spinbox = QSpinBox()
        self.window_width_spinbox.setRange(800, 1920)
        self.window_width_spinbox.setValue(config.window_size[0])
        self.window_width_spinbox.setFixedWidth(80)
        self.window_width_spinbox.setFixedHeight(25)
        self.window_width_spinbox.setSuffix(" px") # 添加单位后缀
        
        lbl_x = QLabel("×")
        lbl_x.setAlignment(Qt.AlignCenter)
        lbl_x.setFixedWidth(5)
        
        self.window_height_spinbox = QSpinBox()
        self.window_height_spinbox.setRange(600, 1080)
        self.window_height_spinbox.setValue(config.window_size[1])
        self.window_height_spinbox.setFixedWidth(80)
        self.window_height_spinbox.setFixedHeight(25)
        self.window_height_spinbox.setSuffix(" px")
        
        win_size_layout.addWidget(lbl_size)
        win_size_layout.addWidget(self.window_width_spinbox)
        win_size_layout.addWidget(lbl_x)
        win_size_layout.addWidget(self.window_height_spinbox)
        win_size_layout.addStretch()
        
        layout_ui.addLayout(win_size_layout)
        
        # 窗口关闭时隐藏至系统托盘
        tray_layout = QHBoxLayout()
        lbl_tray = QLabel("窗口关闭时隐藏至系统托盘:")
        lbl_tray.setFixedWidth(160)
        
        self.close_to_tray_checkbox = QCheckBox("启用")
        self.close_to_tray_checkbox.setChecked(config.close_to_tray)
        self.close_to_tray_checkbox.setCursor(Qt.PointingHandCursor)
        
        tray_layout.addWidget(lbl_tray)
        tray_layout.addWidget(self.close_to_tray_checkbox)
        tray_layout.addStretch()
        layout_ui.addLayout(tray_layout)
        
        content_layout.addWidget(card_ui)
        
        # =========================================
        # 3. 功能开关卡片
        # =========================================
        card_feature = self.create_card("功能增强")
        layout_feature = card_feature.layout()
        
        # 剪贴板
        clip_layout = QHBoxLayout()
        lbl_clip = QLabel("剪贴板自动处理:")
        lbl_clip.setFixedWidth(95)
        
        self.clipboard_auto_process_checkbox = QCheckBox("启用")
        self.clipboard_auto_process_checkbox.setChecked(config.clipboard_auto_process_enabled)
        self.clipboard_auto_process_checkbox.setCursor(Qt.PointingHandCursor)
        
        clip_layout.addWidget(lbl_clip)
        clip_layout.addWidget(self.clipboard_auto_process_checkbox)
        clip_layout.addStretch()
        layout_feature.addLayout(clip_layout)
        
        # 尺寸验证
        valid_layout = QHBoxLayout()
        lbl_valid = QLabel("尺寸验证默认状态:")
        lbl_valid.setFixedWidth(106)
        
        self.size_validation_combo = QComboBox()
        self.size_validation_combo.addItems(["开启", "关闭"])
        self.size_validation_combo.setFixedWidth(80)
        self.size_validation_combo.setFixedHeight(25)
        self.size_validation_combo.setCursor(Qt.PointingHandCursor)
        current_index = 0 if config.size_validation_enabled else 1
        self.size_validation_combo.setCurrentIndex(current_index)
        
        valid_layout.addWidget(lbl_valid)
        valid_layout.addWidget(self.size_validation_combo)
        valid_layout.addStretch()
        layout_feature.addLayout(valid_layout)
        
        content_layout.addWidget(card_feature)
        content_layout.addStretch() # 底部弹簧
        
        # 设置滚动区域内容
        scroll_area.setWidget(content_widget)
        main_layout.addWidget(scroll_area, 1)
        
        # =========================================
        # 底部按钮栏 (白色背景，固定在底部)
        # =========================================
        button_frame = QFrame()
        button_frame.setObjectName("SettingsBottomBar") # 专用ID用于样式
        button_frame.setAttribute(Qt.WA_StyledBackground, True)
        
        btn_layout = QHBoxLayout(button_frame)
        btn_layout.setContentsMargins(24, 16, 24, 16)
        btn_layout.setSpacing(12)
        btn_layout.addStretch()
        
        self.btn_cancel = QPushButton("取消")
        self.btn_cancel.setCursor(Qt.PointingHandCursor)
        self.btn_cancel.setFixedWidth(90)
        self.btn_cancel.setFixedHeight(36)
        
        self.btn_ok = QPushButton("保存设置") # 改名让意图更清晰
        self.btn_ok.setObjectName("btn_ok")
        self.btn_ok.setCursor(Qt.PointingHandCursor)
        self.btn_ok.setFixedWidth(100)
        self.btn_ok.setFixedHeight(36)
        
        btn_layout.addWidget(self.btn_cancel)
        btn_layout.addWidget(self.btn_ok)
        
        main_layout.addWidget(button_frame)
        
        # 绑定事件
        self.btn_ok.clicked.connect(self.accept)
        self.btn_cancel.clicked.connect(self.reject)
        
    def create_card(self, title_text):
        """辅助函数：创建统一风格的卡片"""
        frame = QFrame()
        frame.setObjectName("CardFrame") # 复用主窗口的卡片样式
        frame.setAttribute(Qt.WA_StyledBackground, True)
        
        layout = QVBoxLayout(frame)
        layout.setContentsMargins(24, 20, 24, 24)
        layout.setSpacing(16)
        
        # 卡片标题
        title = QLabel(title_text)
        title.setObjectName("CardTitle") # 新的样式ID
        layout.addWidget(title)
        
        # 标题下的分割线
        line = QFrame()
        line.setObjectName("CardSeparator")
        line.setFrameShape(QFrame.HLine)
        line.setFixedHeight(1)
        layout.addWidget(line)
        layout.addSpacing(4) # 线和内容再加点距离
        
        return frame

    def create_line_edit(self, text, attr_name):
        """辅助函数：创建输入框"""
        edit = QLineEdit()
        edit.setText(text)
        edit.setPlaceholderText("留空表示使用系统默认路径")
        edit.setEnabled(False) # 路径通常只读，通过按钮修改
        edit.setFixedHeight(32)
        # 将其绑定到实例变量，以便 get_settings 访问
        setattr(self, attr_name, edit) 
        return edit

    def create_path_row(self, label_text, edit_widget, browse_callback):
        """辅助函数：创建路径选择行"""
        layout = QHBoxLayout()
        
        label = QLabel(label_text)
        label.setFixedWidth(106) # 统一标签宽度
        
        btn = QPushButton("浏览...")
        btn.setCursor(Qt.PointingHandCursor)
        btn.setFixedWidth(80)
        btn.setFixedHeight(32)
        btn.clicked.connect(browse_callback)
        # 将按钮也保存一下，如果以后需要引用
        
        layout.addWidget(label)
        layout.addWidget(edit_widget, 1)
        layout.addWidget(btn)
        return layout

    def browse_default_path(self):
        folder = QFileDialog.getExistingDirectory(self, "选择默认文件路径", self.default_path_edit.text())
        if folder: self.default_path_edit.setText(folder)
            
    def browse_default_export_path(self):
        folder = QFileDialog.getExistingDirectory(self, "选择默认导出路径", self.default_export_path_edit.text())
        if folder: self.default_export_path_edit.setText(folder)

    def get_settings(self):
        return {
            "default_file_dialog_path": self.default_path_edit.text().strip(),
            "default_export_path": self.default_export_path_edit.text().strip(),
            "table_default_row_height": self.row_height_spinbox.value(),
            "window_size": (self.window_width_spinbox.value(), self.window_height_spinbox.value()),
            "clipboard_auto_process_enabled": self.clipboard_auto_process_checkbox.isChecked(),
            "size_validation_enabled": self.size_validation_combo.currentText() == "开启",
            "close_to_tray": self.close_to_tray_checkbox.isChecked()
        }
        
    def set_settings(self, settings):
        # (保持原有的逻辑不变，这里为了节省篇幅略过，逻辑是一样的)
        if "default_file_dialog_path" in settings:
            self.default_path_edit.setText(settings["default_file_dialog_path"])
        if "default_export_path" in settings:
            self.default_export_path_edit.setText(settings["default_export_path"])
        if "table_default_row_height" in settings:
            self.row_height_spinbox.setValue(settings["table_default_row_height"])
        if "window_size" in settings:
            w, h = settings["window_size"]
            self.window_width_spinbox.setValue(w)
            self.window_height_spinbox.setValue(h)
        if "clipboard_auto_process_enabled" in settings:
            self.clipboard_auto_process_checkbox.setChecked(settings["clipboard_auto_process_enabled"])
        if "size_validation_enabled" in settings:
            idx = 0 if settings["size_validation_enabled"] else 1
            self.size_validation_combo.setCurrentIndex(idx)
        if "close_to_tray" in settings:
            self.close_to_tray_checkbox.setChecked(settings["close_to_tray"])

if __name__ == "__main__":
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
