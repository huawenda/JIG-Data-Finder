"""
JIG ID 文本输入框组件

本模块包含 JigIdTextEdit 类，这是一个继承自 QPlainTextEdit 的自定义文本输入框，
专门用于JIG ID的输入。该组件集成了智能剪贴板处理功能，能够在用户粘贴时
自动从混合文本中提取纯净的JIG ID。

主要功能:
1. 拦截粘贴操作，自动提取JIG ID
2. 保持原有粘贴功能不受影响
3. 支持配置开关控制自动处理功能

类:
    JigIdTextEdit: 自定义的文本输入框类

依赖:
    PySide2.QtWidgets: Qt文本输入框基类
    PySide2.QtGui: Qt键盘事件类
    PySide2.QtCore: Qt核心模块，包含剪贴板和按键序列
    utils.clipboard_processor: 剪贴板处理工具
    app.config: 应用程序配置

版本: 1.0.0
作者: JIG Data Finder开发团队
日期: 2026-01-09
"""

from PySide2.QtWidgets import QPlainTextEdit,QApplication
from PySide2.QtGui import QKeyEvent, QKeySequence
from PySide2.QtCore import Qt
from utils.clipboard_processor import clipboard_processor
from app.config import config


class JigIdTextEdit(QPlainTextEdit):
    """
    JIG ID 文本输入框类
    
    该类继承自 QPlainTextEdit，专门用于JIG ID的输入。主要特性是集成了
    智能剪贴板处理功能，当用户执行粘贴操作时，会自动从剪贴板内容中
    提取符合格式的JIG ID。
    
    主要功能：
        1. 拦截Ctrl+V粘贴操作，进行智能处理
        2. 判断剪贴板内容是否需要处理
        3. 保持原有粘贴功能完全兼容
        4. 支持通过配置开关控制功能
    
    使用方法：
        替换原有的 QPlainTextEdit 为 JigIdTextEdit 即可，
        无需额外的配置或代码修改。
    """
    
    def __init__(self, parent=None):
        """
        初始化 JigIdTextEdit 实例
        
        Args:
            parent: 父窗口对象，默认为None
        """
        super().__init__(parent)
        
        # 设置占位符文本
        self.setPlaceholderText("在此处粘贴 Jig ID，每行一个...")
    
    def keyPressEvent(self, event: QKeyEvent):
        """
        键盘事件处理方法
        
        该方法重写了基类的键盘事件处理，主要用于拦截粘贴操作。
        当检测到粘贴操作（Ctrl+V或Shift+Insert）时，会进行智能处理。
        
        处理逻辑：
        1. 检查是否为粘贴操作
        2. 检查剪贴板自动处理功能是否启用
        3. 获取剪贴板内容并处理
        4. 根据处理结果决定是插入处理后的内容还是执行默认粘贴
        
        Args:
            event: 键盘事件对象
            
        Notes:
            - 支持标准粘贴快捷键：Ctrl+V和Shift+Insert
            - 只有在配置启用时才进行智能处理
            - 保持原有粘贴功能的完整兼容性
        """
        # 检查是否为粘贴操作
        if event.matches(QKeySequence.Paste):
            # 检查剪贴板自动处理功能是否启用
            if config.clipboard_auto_process_enabled:
                # 获取剪贴板内容
                clipboard = QApplication.clipboard()
                clipboard_text = clipboard.text()
                
                # 处理剪贴板内容
                processed_text = clipboard_processor.process_clipboard_content(clipboard_text)
                
                # 如果处理后的文本与原文本不同，说明进行了提取操作
                if processed_text != clipboard_text:
                    # 插入处理后的文本
                    self.insertPlainText(processed_text)
                    event.accept()
                    return
            
            # 如果功能未启用或内容未变化，执行默认粘贴
            super().keyPressEvent(event)
        else:
            # 非粘贴操作，执行默认处理
            super().keyPressEvent(event)
    
    def pasteEvent(self):
        """
        粘贴事件处理方法
        
        该方法提供了另一种粘贴处理方式，主要处理通过右键菜单
        或其他方式触发的粘贴操作。处理逻辑与keyPressEvent中的
        粘贴处理相同。
        
        Notes:
            - 该方法作为备用处理方式
            - 主要处理非键盘快捷键触发的粘贴操作
            - 与keyPressEvent保持一致的处理逻辑
        """
        # 检查剪贴板自动处理功能是否启用
        if config.clipboard_auto_process_enabled:
            # 获取剪贴板内容
            clipboard = QApplication.clipboard()
            clipboard_text = clipboard.text()
            
            # 处理剪贴板内容
            processed_text = clipboard_processor.process_clipboard_content(clipboard_text)
            
            # 如果处理后的文本与原文本不同，说明进行了提取操作
            if processed_text != clipboard_text:
                # 插入处理后的文本
                self.insertPlainText(processed_text)
                return
        
        # 如果功能未启用或内容未变化，执行默认粘贴
        super().pasteEvent()