"""
剪贴板处理工具模块

本模块提供剪贴板内容的智能处理功能，主要用于从混合文本中提取JIG ID。
支持从邮件、文档等包含多种信息的文本中自动识别和提取符合格式的JIG ID。

主要功能:
1. 从剪贴板文本中提取JIG ID
2. 判断文本是否为纯净的JIG ID列表
3. 去重和排序处理

类:
    ClipboardProcessor: 剪贴板处理器类

依赖:
    re: Python正则表达式模块
    typing: 类型提示支持

版本: 1.0.0
作者: JIG Data Finder开发团队
日期: 2026-01-09
"""

import re
from typing import List, Set


class ClipboardProcessor:
    """
    剪贴板处理器类
    
    该类负责处理剪贴板内容，主要功能是从混合文本中提取符合格式的JIG ID。
    支持两种JIG ID格式：CJ开头和C4M开头的12位字母数字组合。
    
    主要方法：
        extract_jig_ids(): 从文本中提取所有符合条件的JIG ID
        is_pure_jig_ids(): 判断文本是否为纯净的JIG ID列表
        process_clipboard_content(): 处理剪贴板内容，返回提取结果或原始文本
    
    属性:
        jig_id_pattern: 编译后的正则表达式，用于匹配JIG ID
    """
    
    def __init__(self):
        """初始化剪贴板处理器"""
        # JIG ID正则表达式：
        # 1. CJ开头后跟10位，总共12位，最后两位必须是数字且不能是"00"（排除Lot ID）
        # 2. C4M开头后跟9位，总共12位
        # 使用负向先行断言确保前面不是字母数字，后面不是字母数字
        self.jig_id_pattern = re.compile(r'(?<![A-Za-z0-9])(CJ[A-Z0-9]{8}(?!00)[0-9]{2}|C4M[A-Z0-9]{9})(?![A-Za-z0-9])')
        # 用于完整匹配的正则表达式
        self.jig_id_full_pattern = re.compile(r'^(CJ[A-Z0-9]{8}(?!00)[0-9]{2}|C4M[A-Z0-9]{9})$')
    
    def extract_jig_ids(self, text: str) -> List[str]:
        """
        从文本中提取所有符合条件的JIG ID
        
        该方法使用正则表达式从输入文本中查找所有符合格式的JIG ID，
        并进行去重处理，保持原始顺序。
        
        Args:
            text: 输入文本，可能包含JIG ID和其他内容
            
        Returns:
            List[str]: 提取到的JIG ID列表，已去重并保持原始顺序
            
        Notes:
            - 支持的格式：CJ或C4M开头，后跟10位大写字母或数字
            - 自动去除重复的JIG ID
            - 保持在文本中出现的顺序
            - 如果没有找到任何JIG ID，返回空列表
        """
        if not text:
            return []
        
        # 查找所有匹配的JIG ID
        matches = self.jig_id_pattern.findall(text)
        
        # 由于findall只返回匹配的组（CJ或C4M），我们需要重新查找完整匹配
        full_matches = self.jig_id_pattern.finditer(text)
        
        # 提取完整匹配的JIG ID
        jig_ids = [match.group() for match in full_matches]
        
        # 去重但保持顺序
        seen: Set[str] = set()
        unique_jig_ids = []
        for jig_id in jig_ids:
            if jig_id not in seen:
                seen.add(jig_id)
                unique_jig_ids.append(jig_id)
        
        return unique_jig_ids
    
    def is_pure_jig_ids(self, text: str) -> bool:
        """
        判断文本是否为纯净的JIG ID列表
        
        该方法判断输入文本是否只包含符合格式的JIG ID，每行一个，
        不包含其他任何内容。这用于决定是否需要处理剪贴板内容。
        
        Args:
            text: 输入文本
            
        Returns:
            bool: True表示文本是纯净的JIG ID列表，False表示包含其他内容
            
        Notes:
            - 纯净JIG ID列表的定义：每行一个JIG ID，没有其他内容
            - 允许空行
            - 允许行首行尾的空白字符
            - 如果文本为空，返回False
        """
        if not text:
            return False
        
        # 按行分割文本
        lines = text.strip().split('\n')
        
        # 检查每一行是否都是有效的JIG ID
        for line in lines:
            line = line.strip()
            # 跳过空行
            if not line:
                continue
            # 如果行不为空，检查是否为有效的JIG ID
            if not self.jig_id_full_pattern.fullmatch(line):
                return False
        
        # 所有非空行都是有效的JIG ID
        return len(lines) > 0  # 至少要有一个非空行
    
    def process_clipboard_content(self, text: str) -> str:
        """
        处理剪贴板内容，返回提取结果或原始文本
        
        该方法是剪贴板处理的主要入口点，根据输入文本的内容
        决定是返回提取的JIG ID还是原始文本。
        
        处理逻辑：
        1. 如果文本是纯净的JIG ID列表，直接返回原文本
        2. 如果文本包含JIG ID但不是纯净列表，返回提取的JIG ID
        3. 如果文本不包含任何JIG ID，返回原文本
        
        Args:
            text: 剪贴板文本内容
            
        Returns:
            str: 处理后的文本，可能是提取的JIG ID列表或原始文本
            
        Notes:
            - 提取的JIG ID每行一个
            - 保持原始文本中的顺序
            - 自动去重
        """
        if not text:
            return text
        
        # 如果是纯净的JIG ID列表，直接返回
        if self.is_pure_jig_ids(text):
            return text
        
        # 尝试提取JIG ID
        jig_ids = self.extract_jig_ids(text)
        
        # 如果提取到了JIG ID，返回提取结果
        if jig_ids:
            return '\n'.join(jig_ids)
        
        # 没有提取到JIG ID，返回原文本
        return text


# 创建全局实例，供其他模块使用
clipboard_processor = ClipboardProcessor()