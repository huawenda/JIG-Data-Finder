"""
MainWindow - 主窗口类
"""

import sys
import os
import pandas as pd
from PySide2.QtWidgets import (QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, QProgressBar,
                             QLabel, QLineEdit, QPushButton, QTableView,QComboBox,
                             QFileDialog, QSplitter, QMessageBox, QFrame, QHeaderView,QTabWidget,
                             QCheckBox, QDialog)
from PySide2.QtCore import Qt, QThread, Signal

# 添加src目录到路径，以便可以导入其他模块
current_dir = os.path.dirname(os.path.abspath(__file__))
src_dir = os.path.dirname(current_dir)
if src_dir not in sys.path:
    sys.path.insert(0, src_dir)

# 导入路径工具模块
from core.worker import ExcelWorker
from app.config import config
from core.data_model import PandasModel
from ui.jig_id_text_edit import JigIdTextEdit
from ui.settings_dialog import SettingsDialog


class MainWindow(QMainWindow):
    """主窗口类"""
    
    sig_req_load = Signal(str)
    sig_req_query = Signal(list)
    sig_req_process_source = Signal()

    def __init__(self):
        super().__init__()
        self.setWindowTitle(config.window_title)
        self.resize(*config.window_size)
        
        # 使用 Windows 原生窗口框架
        self.setWindowFlags(Qt.Window)
        
        # 创建主内容容器作为 centralWidget
        self.content_widget = QWidget()
        self.content_widget.setObjectName("MainContent")
        self.content_widget.setAttribute(Qt.WA_StyledBackground, True)
        self.setCentralWidget(self.content_widget)
        
        # 初始化UI
        self.init_ui()
        
        self.init_thread()

    def init_ui(self):
        """
        初始化主窗口的用户界面组件和布局。
        
        主要功能：
        1. 设置整体布局边距和间距（使用 config.gap_size）
        2. 创建顶部文件加载区（卡片化设计），包含文件路径输入、浏览和加载按钮
        3. 创建中间分栏区（QSplitter）：
           - 左侧：Jig ID 输入区，支持多行输入，包含清空和查询按钮
           - 右侧：结果展示区，使用标签页显示三种视图：
             * 查询结果明细表
             * 查询结果透视表
             * 全量数据透视表
        4. 创建底部状态栏，显示状态信息和操作日志
        5. 绑定所有UI控件的事件信号到对应的槽函数
        6. 初始化数据存储变量（current_result_df, current_query_pivot_df, current_pivot_df）
        
        注意：所有尺寸和样式配置均从 app.config 模块读取。
        """
        # 使用配置中的值初始化布局参数
        GAP_SIZE = config.gap_size
        
        # 创建主垂直布局
        main_layout = QVBoxLayout(self.content_widget)
        main_layout.setContentsMargins(GAP_SIZE, GAP_SIZE, GAP_SIZE, GAP_SIZE)
        main_layout.setSpacing(GAP_SIZE)
        
        # 定义统一头部高度（从配置读取）
        HEADER_HEIGHT = config.header_height
        
        # =========================================
        # 第一部分：顶部文件加载区 (卡片化设计)
        # =========================================
        top_frame = QFrame()
        top_frame.setObjectName("CardFrame")
        top_frame.setAttribute(Qt.WA_StyledBackground, True)
        top_layout = QHBoxLayout(top_frame)
        top_layout.setContentsMargins(16, 12, 16, 12)
        top_layout.setSpacing(12)
        
        # 文件路径输入框（只读）
        self.path_edit = QLineEdit()
        self.path_edit.setEnabled(False)
        self.path_edit.setPlaceholderText("请选择导出的 MES 源数据 Excel 文件...")
        self.path_edit.setMinimumHeight(32)
        
        # 浏览按钮
        self.btn_browse = QPushButton("浏览...")
        self.btn_browse.setCursor(Qt.PointingHandCursor)
        self.btn_browse.setFixedWidth(80)
        
        # 加载数据按钮
        self.btn_load = QPushButton("加载数据")
        self.btn_load.setObjectName("btn_load")
        self.btn_load.setCursor(Qt.PointingHandCursor)
        self.btn_load.setFixedWidth(100)
        
        # 设置按钮
        self.btn_settings = QPushButton("设置")
        self.btn_settings.setCursor(Qt.PointingHandCursor)
        self.btn_settings.setFixedWidth(80)
        
        # 组装顶部布局
        top_layout.addWidget(QLabel("源文件:"))
        top_layout.addWidget(self.path_edit, 1)
        top_layout.addWidget(self.btn_browse)
        top_layout.addWidget(self.btn_load)
        top_layout.addWidget(self.btn_settings)
        
        # =========================================
        # 第二部分：中间分栏区（左右分栏布局）
        # =========================================
        splitter = QSplitter(Qt.Horizontal)
        splitter.setHandleWidth(GAP_SIZE)
        splitter.setChildrenCollapsible(False)
        
        # --- 左侧：Jig ID 输入区 (卡片化设计) ---
        left_frame = QFrame()
        left_frame.setObjectName("CardFrame")
        left_frame.setAttribute(Qt.WA_StyledBackground, True)
        left_layout = QVBoxLayout(left_frame)
        left_layout.setContentsMargins(16, 8, 16, 16)
        left_layout.setSpacing(0)
        
        # 左侧头部容器（标题 + 清空按钮）
        left_header_container = QWidget()
        left_header_container.setFixedHeight(HEADER_HEIGHT)
        left_header_layout = QHBoxLayout(left_header_container)
        left_header_layout.setContentsMargins(0, 0, 0, 0)
        
        lbl_input = QLabel("输入 Jig ID")
        lbl_input.setObjectName("SectionTitle")
        
        self.btn_clear = QPushButton("清空")
        self.btn_clear.setObjectName("btn_clear")
        self.btn_clear.setCursor(Qt.PointingHandCursor)
        self.btn_clear.setFixedSize(60, 28)
        
        left_header_layout.addWidget(lbl_input)
        left_header_layout.addStretch()
        left_header_layout.addWidget(self.btn_clear)
        
        # Jig ID 多行文本输入框（使用自定义的JigIdTextEdit）
        self.input_text = JigIdTextEdit()
        
        # 查询按钮
        self.btn_query = QPushButton("开始查询  >>")
        self.btn_query.setObjectName("btn_query")
        self.btn_query.setCursor(Qt.PointingHandCursor)
        self.btn_query.setEnabled(False)  # 初始禁用，加载数据后启用
        self.btn_query.setFixedHeight(45)
        
        # 组装左侧布局
        left_layout.addWidget(left_header_container)
        left_layout.addWidget(self.input_text, 1)
        left_layout.addSpacing(10) 
        left_layout.addWidget(self.btn_query)
        
        # --- 右侧：查询结果展示区 (卡片化设计) ---
        right_frame = QFrame()
        right_frame.setObjectName("CardFrame")
        right_frame.setAttribute(Qt.WA_StyledBackground, True)
        right_layout = QVBoxLayout(right_frame)
        right_layout.setContentsMargins(16, 8, 16, 16)
        right_layout.setSpacing(0)

        # 创建标签页容器，用于显示三种不同的数据视图
        self.tabs = QTabWidget()
        self.tabs.setCursor(Qt.ArrowCursor)
        
        # Tab 1: 查询结果明细表
        self.tab_detail = QWidget()
        layout_detail = QVBoxLayout(self.tab_detail)
        layout_detail.setContentsMargins(0, 0, 0, 0)

        # 尺寸验证工具栏
        detail_toolbar = QWidget()
        detail_toolbar_layout = QHBoxLayout(detail_toolbar)
        detail_toolbar_layout.setContentsMargins(10, 5, 10, 0)
        
        # 尺寸验证开关
        self.size_validation_checkbox = QCheckBox("尺寸验证")
        self.size_validation_checkbox.setChecked(config.size_validation_enabled)
        self.size_validation_checkbox.setCursor(Qt.PointingHandCursor)
        self.size_validation_checkbox.setObjectName("sizeValidationCheckbox")
            
        detail_toolbar_layout.addWidget(self.size_validation_checkbox)
        detail_toolbar_layout.addStretch()  # 弹簧，把控件顶到左边
        
        layout_detail.addWidget(detail_toolbar)  # 先加工具栏

        self.table_view = QTableView()
        self.table_view.verticalHeader().setVisible(False)
        self.table_view.verticalHeader().setDefaultSectionSize(config.table_default_row_height)
        
        # 设置表头属性
        header = self.table_view.horizontalHeader()
        header.setStretchLastSection(False)
        header.setSectionResizeMode(QHeaderView.Interactive)
        self.table_view.setHorizontalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        layout_detail.addWidget(self.table_view, 1)  # 表格占据剩余空间

        # Tab 2: 查询结果透视表
        self.tab_query_pivot = QWidget()
        layout_qp = QVBoxLayout(self.tab_query_pivot)
        layout_qp.setContentsMargins(0, 0, 0, 0)
        
        self.query_pivot_table = QTableView()
        self.query_pivot_table.verticalHeader().setVisible(False)
        self.query_pivot_table.verticalHeader().setDefaultSectionSize(config.table_default_row_height)

        layout_qp.addWidget(self.query_pivot_table)

        # Tab 3: 全量数据透视表
        self.tab_pivot = QWidget()   
        layout_pivot = QVBoxLayout(self.tab_pivot)
        layout_pivot.setContentsMargins(0, 0, 0, 0)

        # 顶部工具栏容器
        pivot_toolbar = QWidget()
        pivot_toolbar_layout = QHBoxLayout(pivot_toolbar)
        pivot_toolbar_layout.setContentsMargins(10, 5, 10, 0)
        
        # 筛选标签和下拉框
        pivot_toolbar_layout.addWidget(QLabel("显示范围:"))
        self.combo_filter = QComboBox()
        self.combo_filter.addItems(["全部数据", "生产中"])
        self.combo_filter.setFixedWidth(120)
        pivot_toolbar_layout.addWidget(self.combo_filter)
        pivot_toolbar_layout.addStretch() # 弹簧，把控件顶到左边
        
        layout_pivot.addWidget(pivot_toolbar) # 先加工具栏
        
        self.pivot_table_view = QTableView()
        self.pivot_table_view.verticalHeader().setVisible(False)
        self.pivot_table_view.verticalHeader().setDefaultSectionSize(config.table_default_row_height)

        layout_pivot.addWidget(self.pivot_table_view)

        # 绑定信号
        self.combo_filter.currentIndexChanged.connect(self.on_pivot_filter_changed)

        # Tab 4: 审查页
        self.tab_review = QWidget()
        layout_review = QVBoxLayout(self.tab_review)
        layout_review.setContentsMargins(0, 0, 0, 0)

        # 工具栏
        review_toolbar = QWidget()
        review_toolbar_layout = QHBoxLayout(review_toolbar)
        review_toolbar_layout.setContentsMargins(10, 5, 10, 0)

        review_toolbar_layout.addWidget(QLabel("P/N:"))
        self.combo_pn = QComboBox()
        self.combo_pn.setFixedWidth(150)
        review_toolbar_layout.addWidget(self.combo_pn)
        review_toolbar_layout.addStretch()

        layout_review.addWidget(review_toolbar)

        # 表格视图
        self.review_table_view = QTableView()
        self.review_table_view.verticalHeader().setVisible(False)
        self.review_table_view.verticalHeader().setDefaultSectionSize(config.table_default_row_height)
        layout_review.addWidget(self.review_table_view)

        # 添加四个标签页到标签容器
        self.tabs.addTab(self.tab_detail, "查询结果")
        self.tabs.addTab(self.tab_query_pivot, "查询结果透视")
        self.tabs.addTab(self.tab_pivot, "全量数据透视")
        self.tabs.addTab(self.tab_review, "审查")
        
        # 导出按钮（根据当前标签页显示不同的导出功能）
        self.btn_export = QPushButton("导出查询结果")
        self.btn_export.setObjectName("btn_export")
        self.btn_export.setCursor(Qt.PointingHandCursor)
        self.btn_export.setFixedHeight(45)
        
        # 组装右侧布局
        right_layout.addWidget(self.tabs, 1) # 添加 tabs 代替原来的 table_view
        right_layout.addSpacing(10)
        right_layout.addWidget(self.btn_export)
        
        # 将左右两侧添加到分割器
        splitter.addWidget(left_frame)
        splitter.addWidget(right_frame)
        splitter.setSizes(config.splitter_sizes)
        splitter.setStretchFactor(0, 1)
        splitter.setStretchFactor(1, 2)
        splitter.setCollapsible(0, False)
        splitter.setCollapsible(1, False)

        # 设置左侧面板的最小和最大宽度
        left_frame.setMinimumWidth(config.left_panel_min_width)
        left_frame.setMaximumWidth(config.left_panel_max_width)
        
        # 组装主布局：顶部文件加载区 + 中间分栏区
        main_layout.addWidget(top_frame)
        main_layout.addWidget(splitter, 1)
        
        # =========================================
        # 第三部分：底部状态栏
        # =========================================
        self.status_bar_widget = QWidget()
        self.status_bar_widget.setObjectName("CustomStatusBar")
        self.status_bar_widget.setFixedHeight(28)
        
        status_layout = QHBoxLayout(self.status_bar_widget)
        status_layout.setContentsMargins(10, 0, 10, 0)
        
        self.status_label = QLabel(" 状态 : 等待加载")
        self.status_label.setObjectName("StatusLabel")

        # 进度条
        self.loading_bar = QProgressBar()
        self.loading_bar.setFixedSize(150, 6) # 细长条，宽150px，高6px
        self.loading_bar.setTextVisible(False) # 不显示百分比文字
        self.loading_bar.setRange(0, 0) # 关键：设为 0-0 会触发"繁忙模式"动画
        self.loading_bar.hide() # 默认隐藏
        
        self.log_label = QLabel("准备就绪 ")
        self.log_label.setObjectName("LogLabel")
        
        status_layout.addWidget(self.status_label)
        status_layout.addStretch()

        # 将进度条添加到布局中 (在日志标签之前)
        status_layout.addWidget(self.loading_bar) 
        status_layout.addSpacing(10) # 加一点间距

        status_layout.addWidget(self.log_label)
        
        main_layout.addWidget(self.status_bar_widget)

        # 绑定所有UI控件的事件信号到对应的槽函数
        self.btn_browse.clicked.connect(self.select_file)
        self.btn_load.clicked.connect(self.start_load)
        self.btn_query.clicked.connect(self.start_query)
        self.btn_export.clicked.connect(self.export_excel)
        self.btn_clear.clicked.connect(self.on_clear)
        self.btn_settings.clicked.connect(self.show_settings)  # 设置按钮点击事件
        self.tabs.currentChanged.connect(self.on_tab_changed) # 监听标签切换
        self.size_validation_checkbox.stateChanged.connect(self.on_size_validation_changed) # 尺寸验证开关
        self.combo_pn.currentIndexChanged.connect(self.on_pn_filter_changed) # P/N 筛选
        
        # 初始化数据存储变量
        self.current_result_df = None
        self.current_query_pivot_df = None
        self.current_pivot_df = None
        self.current_detail_model = None  # 当前明细表模型
        self.current_review_df = None  # 审查页完整数据
        self.current_review_model = None  # 审查页表格模型
        
    def init_thread(self):
        """初始化工作线程"""
        self.thread = QThread()
        self.worker = ExcelWorker()
        self.worker.moveToThread(self.thread)

        self.sig_req_load.connect(self.worker.load_data)
        self.sig_req_query.connect(self.worker.query_data)
        self.sig_req_process_source.connect(self.worker.process_source_data)
        
        # 信号连接
        self.worker.sig_log.connect(self.update_log)
        self.worker.sig_data_loaded.connect(self.on_data_loaded)
        self.worker.sig_query_finished.connect(self.on_query_finished)
        self.worker.sig_source_data_processed.connect(self.update_review_view)
        
        # 启动线程
        self.thread.start()

    def update_log(self, msg):
        """更新日志"""
        self.log_label.setText(msg)

    def select_file(self):
        """选择文件"""
        # 使用配置的默认文件路径
        default_path = config.default_file_dialog_path if config.default_file_dialog_path else ""
        
        path, _ = QFileDialog.getOpenFileName(
            self,
            "选择 Excel",
            default_path,  # 设置默认路径
            config.excel_file_filter
        )
        if path:
            self.path_edit.setText(path)

    def start_load(self):
        """开始加载数据"""
        path = self.path_edit.text()
        if not path:
            return
        self.btn_load.setEnabled(False)
        self.btn_load.setText("加载中...")
        self.status_label.setText("状态 : 数据加载中")

        self.status_label.setStyleSheet("")

        # 显示进度条
        self.loading_bar.show()

        self.sig_req_load.emit(path)

    def on_data_loaded(self, success,data_package):
        """数据加载完成处理"""
        # 隐藏进度条
        self.loading_bar.hide()

        self.btn_load.setEnabled(True)
        self.btn_load.setText("加载数据")

        if success:
            # 缓存全量数据包 {"all": df, "prod": df}
            self.full_pivot_data = data_package 
            
            # 默认显示 "全部"
            self.combo_filter.setCurrentIndex(0)
            self.update_full_pivot_view("all") # 抽离一个更新方法

            self.status_label.setText("状态 : 数据已加载")
            self.status_label.setStyleSheet("color: #10B981; font-weight: bold;")
            self.btn_query.setEnabled(True)

            if data_package:
                self.status_label.setText("状态 : 数据已加载")
                self.status_label.setStyleSheet("color: #10B981; font-weight: bold;")
                self.btn_query.setEnabled(True)

                # self.tabs.setCurrentIndex(2) 

            QMessageBox.information(self, "成功", "源数据加载成功！")
            
            # 处理源数据用于审查页
            self.sig_req_process_source.emit()
        else:
            self.status_label.setText("状态: 加载失败")
            self.status_label.setStyleSheet("color: #EF4444;")

    def update_full_pivot_view(self, key):
        """更新全量透视表视图"""
        if not hasattr(self, 'full_pivot_data') or not self.full_pivot_data:
            return
            
        df = self.full_pivot_data.get(key)
        self.current_pivot_df = df # 更新当前导出的目标
        
        model = PandasModel(df, show_row_numbers=False)
        self.pivot_table_view.setModel(model)
        self.pivot_table_view.resizeColumnsToContents()
        # ... 设置行高等样式 ...

    def on_pivot_filter_changed(self, index):
        """下拉框切换处理"""
        if index == 0:
            self.update_full_pivot_view("all")
        else:
            self.update_full_pivot_view("prod")

    def start_query(self):
        """开始查询"""
        text = self.input_text.toPlainText()
        if not text.strip():
            return
        # 清洗输入：按行分割，去空格
        ids = [line.strip() for line in text.split('\n') if line.strip()]
        self.sig_req_query.emit(ids)

    def on_query_finished(self, df_detail, df_query_pivot):
        """
        [修改] 查询完成处理
        接收两个 DataFrame: 明细表 和 透视表
        """
        # 1. 处理明细表 (Tab 1)
        self.current_result_df = df_detail
        model_detail = PandasModel(df_detail,show_row_numbers=True)
        self.table_view.setModel(model_detail)
        
        # 保存模型引用，以便后续更新尺寸验证状态
        self.current_detail_model = model_detail
        
        # 应用当前尺寸验证设置
        model_detail.set_size_validation_enabled(self.size_validation_checkbox.isChecked())
        
        # 明细表列宽设置
        self.table_view.setColumnWidth(0, config.table_row_number_width)
        for i, col_name in enumerate(df_detail.columns):
            if col_name in config.adaptive_columns:
                self.table_view.resizeColumnToContents(i + 1)
            else:
                self.table_view.setColumnWidth(i + 1, config.table_default_column_width)

        # 2. 处理查询透视表 (Tab 2)
        self.current_query_pivot_df = df_query_pivot
        model_qp = PandasModel(df_query_pivot, show_row_numbers=False)
        self.query_pivot_table.setModel(model_qp)
        self.query_pivot_table.resizeColumnsToContents()
        self.query_pivot_table.setColumnWidth(0, 120) # P/N
        self.query_pivot_table.setColumnWidth(1, 150) # CST ID

        # 切换到结果表 Tab
        self.tabs.setCurrentIndex(0)

    def update_review_view(self, df_review):
        """
        更新审查页视图
        
        该方法接收处理后的源数据,更新审查页的表格视图和 P/N combobox:
        1. 保存完整数据用于筛选
        2. 初始化 P/N combobox 的选项 (全部 + 所有唯一 P/N 值)
        3. 创建表格模型并设置到表格视图
        4. 审查页的表格模型默认启用尺寸验证功能
        
        Args:
            df_review: 处理后的源数据 DataFrame
        """
        # 1. 保存完整数据用于筛选
        self.current_review_df = df_review
        
        if df_review.empty:
            self.update_log("没有审查数据")
            self.review_table_view.setModel(None)
            self.combo_pn.clear()
            return
        
        # 2. 初始化 P/N combobox 的选项
        self.combo_pn.blockSignals(True)  # 阻止信号触发
        self.combo_pn.clear()
        self.combo_pn.addItem("全部")  # 添加"全部"选项
        
        # 获取所有唯一的 P/N 值并排序
        if "P/N" in df_review.columns:
            unique_pns = df_review["P/N"].unique()
            unique_pns = sorted([pn for pn in unique_pns if pd.notna(pn) and str(pn).strip()])
            for pn in unique_pns:
                self.combo_pn.addItem(str(pn))
        
        self.combo_pn.blockSignals(False)  # 恢复信号触发
        
        # 3. 创建表格模型并设置到表格视图
        model_review = PandasModel(df_review, show_row_numbers=True)
        self.current_review_model = model_review
        
        # 审查页的表格模型默认启用尺寸验证功能 (独立于查询页)
        model_review.set_size_validation_enabled(True)
        
        self.review_table_view.setModel(model_review)
        
        # 4. 设置列宽
        self.review_table_view.setColumnWidth(0, config.table_row_number_width)
        for i, col_name in enumerate(df_review.columns):
            if col_name in config.adaptive_columns:
                self.review_table_view.resizeColumnToContents(i + 1)
            else:
                self.review_table_view.setColumnWidth(i + 1, config.table_default_column_width)

    def on_pn_filter_changed(self, index):
        """
        P/N combobox 切换处理
        
        根据 P/N combobox 的选择筛选显示的数据:
        - 选择"全部": 显示所有数据
        - 选择特定 P/N: 只显示该 P/N 的数据
        
        Args:
            index: combobox 的当前索引 (0 表示"全部", 其他表示特定 P/N)
        """
        if self.current_review_df is None or self.current_review_df.empty:
            return
        
        # 获取当前选择的 P/N
        selected_pn = self.combo_pn.currentText()
        
        if selected_pn == "全部":
            # 显示所有数据
            filtered_df = self.current_review_df
            self.update_log(f"显示全部审查数据,共 {len(filtered_df)} 行")
        else:
            # 筛选特定 P/N 的数据
            if "P/N" in self.current_review_df.columns:
                filtered_df = self.current_review_df[self.current_review_df["P/N"] == selected_pn]
                self.update_log(f"筛选 P/N: {selected_pn},共 {len(filtered_df)} 行")
            else:
                filtered_df = self.current_review_df
        
        # 更新表格视图
        model_review = PandasModel(filtered_df, show_row_numbers=True)
        self.current_review_model = model_review
        
        # 审查页的表格模型默认启用尺寸验证功能
        model_review.set_size_validation_enabled(True)
        
        self.review_table_view.setModel(model_review)
        
        # 设置列宽
        self.review_table_view.setColumnWidth(0, config.table_row_number_width)
        for i, col_name in enumerate(filtered_df.columns):
            if col_name in config.adaptive_columns:
                self.review_table_view.resizeColumnToContents(i + 1)
            else:
                self.review_table_view.setColumnWidth(i + 1, config.table_default_column_width)

    def on_tab_changed(self, index):
        """标签页切换时更新按钮文字"""
        if index == 0:
            self.btn_export.setText("导出查询结果")
        elif index == 1:
            self.btn_export.setText("导出查询结果透视表")
        elif index == 2:
            self.btn_export.setText("导出全量数据透视表")
        else:
            self.btn_export.setText("导出审查数据")

    def export_excel(self):
        """导出Excel - 根据当前标签页导出不同数据"""
        current_idx = self.tabs.currentIndex()
        
        target_df = None
        default_name = ""
        
        if current_idx == 0:
            # 导出明细
            target_df = self.current_result_df
            default_name = config.default_export_filename
        elif current_idx == 1:
            # 查询透视
            target_df = self.current_query_pivot_df
            default_name = "查询结果透视表.xlsx"
        elif current_idx == 2:
            # 导出透视表
            target_df = self.current_pivot_df
            default_name = "全量数据透视表.xlsx"
        else:
            # 审查数据 (暂不实现导出功能)
            QMessageBox.warning(self, "提示", "审查数据导出功能暂未实现")
            return

        if target_df is None or target_df.empty:
            QMessageBox.warning(self, "警告", "当前页面没有可导出的数据")
            return

        # 构建默认保存路径
        default_path = default_name
        if config.default_export_path:
            # 如果有配置的默认导出路径，组合成完整路径
            default_path = os.path.join(config.default_export_path, default_name)

        path, _ = QFileDialog.getSaveFileName(self, "保存文件", default_path, config.excel_file_filter)
        if path:
            try:
                target_df.to_excel(path, index=False)
                QMessageBox.information(self, "成功", "导出成功！")
            except Exception as e:
                QMessageBox.critical(self, "错误", config.get_error_message("excel_export_error", error=str(e)))
    
    def on_clear(self):
        """清空输入和结果"""
        # 检查输入区和结果区是否有内容
        has_input = bool(self.input_text.toPlainText().strip())
        has_result = self.table_view.model() is not None
        
        # 如果两者都没有内容，直接执行清空操作
        if not has_input and not has_result:
            return
        
        # 否则弹出确认对话框
        reply = QMessageBox.question(self, "确认", config.get_error_message("clear_confirm"), 
                                  QMessageBox.Ok | QMessageBox.Cancel, QMessageBox.Cancel)
        
        if reply == QMessageBox.Ok:
            self.clear_content()
    
    def clear_content(self):
        """清空内容"""
        self.input_text.clear()

        # 清空明细
        self.table_view.setModel(None)
        self.current_result_df = None
        self.current_detail_model = None
        
        # 清空查询透视
        self.query_pivot_table.setModel(None)
        self.current_query_pivot_df = None
        
        self.update_log("已清空输入和查询结果")

    def on_size_validation_changed(self, state):
        """
        尺寸验证开关状态改变处理
        
        Args:
            state: 开关状态 (Qt.Checked 或 Qt.Unchecked)
        """
        enabled = (state == Qt.Checked)
        
        # 注意：运行期间的开关状态不更新配置
        # 只影响当前会话的功能状态，不改变默认状态
        
        # 如果当前有明细表模型，更新其尺寸验证状态
        if self.current_detail_model is not None:
            self.current_detail_model.set_size_validation_enabled(enabled)
        
        # 更新日志
        status = "启用" if enabled else "禁用"
        self.update_log(f"尺寸验证功能已{status}")
    
    def show_settings(self):
        """
        显示设置对话框
        
        此方法处理设置按钮的点击事件，创建并显示设置对话框。
        对话框采用模态显示，确保设置界面显示时主窗口不可操作。
        """
        # 创建设置对话框
        settings_dialog = SettingsDialog(self)
        
        # 显示对话框并等待用户操作
        result = settings_dialog.exec_()
        
        # 根据用户操作处理结果
        if result == QDialog.Accepted:
            # 用户点击了"确定"按钮，保存设置
            settings = settings_dialog.get_settings()
            
            # 更新配置
            config.default_file_dialog_path = settings.get("default_file_dialog_path", "")
            config.default_export_path = settings.get("default_export_path", "")
            config.table_default_row_height = settings.get("table_default_row_height", config.table_default_row_height)
            config.clipboard_auto_process_enabled = settings.get("clipboard_auto_process_enabled", config.clipboard_auto_process_enabled)
            config.size_validation_enabled = settings.get("size_validation_enabled", config.size_validation_enabled)
            
            # 更新窗口大小
            if "window_size" in settings:
                new_window_size = settings["window_size"]
                if new_window_size != config.window_size:
                    config.window_size = new_window_size
                    # 立即应用新的窗口大小
                    self.resize(*new_window_size)
            
            # 注意：尺寸验证默认状态配置只保存，不立即应用到界面
            # 只在软件启动时应用默认状态，运行期间用户可自由切换
            
            # 保存配置到文件
            try:
                config.save()
                self.update_log("设置已保存")
            except Exception as e:
                self.update_log(f"保存设置失败: {str(e)}")

    def closeEvent(self, event):
        """关闭事件处理"""
        self.thread.quit()
        self.thread.wait()
        event.accept()


if __name__ == "__main__":
    # 测试代码
    import sys
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

    Window = MainWindow()
    Window.show()
    sys.exit(app.exec_())
