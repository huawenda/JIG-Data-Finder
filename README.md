<div align="center">

<img src="docs/icon-drafts/concept-a-target.svg" width="96" height="96" alt="JIG Data Finder" />

# JIG Data Finder

**MES JIG 数据查询助手 · Tauri 桌面端**

按 Jig ID 从 MES 导出的 Excel 里快速定位记录，按 P/N、CST、工序透视汇总，并核对 Jig 型号与尺寸是否匹配。

</div>

---

## 功能

- **四条工作视图**
  - **查询结果**：粘贴 Jig ID（每行一个，支持从邮件正文直接粘贴并自动挑出 ID），左连接源数据，未命中的行标记为「【未找到】」。
  - **结果透视**：按 P/N × CST × 工序汇总命中记录，计数格可点击下钻到明细。
  - **全量透视**：全量数据透视，带工序轨道、显示范围（全部 / 生产中 / 单个 P/N）、可用性筛选（全部 / 可用 / 非可用），总计行冻结在底部。
  - **数据审查**：按 P/N 过滤，按「所有对象 / 尺寸不匹配」两档查看，异常行标红可直接导出。
- **透视下钻**：点击任意非空计数格进入明细，面包屑显示 `P/N › CST › 工序`，`← 返回` 或 `Esc` 退出；明细默认标出尺寸不匹配。
- **型号尺寸匹配**：维护「Jig 对应型号 → 对应尺寸」规则，支持拖拽与上下移动排序、重复/空值校验。
- **尺寸校验**：按 P/N 提取段与尺寸串做严格 4 位全等比较，不匹配行在界面与导出文件中标红。
- **导出**：当前页一键导出 Excel；查询结果与数据审查页的尺寸异常会带红色标记。
- **其他**：浅色 / 深色 / 跟随系统主题、可调行高、系统托盘、关闭到托盘、导出文件名时间戳、覆盖式滚动条（不占宽高、滚动时出现）。

## 技术栈

| 层 | 选型 |
|---|---|
| 桌面宿主 | Tauri 2（Rust） |
| 前端 | React 18 + TypeScript + Vite 6 |
| 表格 | TanStack Virtual（虚拟滚动）+ CSS Grid 布局 |
| Excel | `xlsx` 读取，`xlsx-js-style` 导出带样式 |
| 测试 | Vitest（纯 TS 业务逻辑可脱离 DOM 单测） |
| 运行平台 | Windows 10 1803+ / Windows 11（x64），使用系统自带 WebView2，无需安装额外依赖 |

## 环境要求

- Node.js 18+ 与 npm
- Rust stable 工具链（`cargo`）
- Visual Studio 2022 Build Tools（C++ 桌面开发负载，提供 `cl` / `link`）
- Python 3（仅生成绿色分发包时需要）

## 开发

```powershell
npm install
```

推荐直接双击 `dev.cmd`：它会释放 1420 端口、关闭遗留的 JIG 进程、加载 MSVC 环境后启动 Tauri dev。

也可以手动启动（注意需要先在当前终端加载 MSVC 环境）：

```powershell
npm run tauri:dev
```

只调试前端界面：

```powershell
npm run dev        # Vite，浏览器打开 http://localhost:1420
```

## 构建与打包

```powershell
# 前端产物 (dist/)
npm run build

# 桌面端免安装 exe
# 需已加载 MSVC 环境 (可调用 tools\msvc-env.cmd)
npm run tauri:build
# 产物: src-tauri/target/release/jig-data-finder.exe

# 绿色版目录 + zip
python tools/package-release.py
# 产物: dist-package/JIG-Data-Finder-2.0.0-win64.zip
```

> 出包约定：只生成免安装可执行文件与绿色版 zip，不生成 NSIS / MSI 安装包。

重新生成应用图标（源文件为矢量稿）：

```powershell
npx tauri icon docs/icon-drafts/concept-a-target.svg
```

## 使用说明

### 源数据要求

读取 MES 导出的 `.xlsx` / `.xls`，需要包含以下列（缺失列会导致对应功能不可用）：

`P/N`、`Lot ID`、`CST ID`、`Slot No`、`Jig ID`、`Jig 对应型号`、`Glass判定`、`工程`、`工程名`

- 默认只处理 `Jig状态 = INPRODUCTION` 的记录；
- 透视的「生产中」范围以 `工程 = 50000` 识别；
- 产线容量上限：40 个 CST × 20 层 = 800 条 JIG 记录。

### 可用性口径

全量透视的「可用 / 非可用」按**工程列**分类：

- **可用**：`PNP`、`PNP 2nd`、`Jig 洗净及检查`、`Jig Loading`、`Jig Unloading`
- **非可用**：其余工序（N判定、分离、目视Stage、搬出待机、搬出、入库等）

### 配置

配置保存在 `%APPDATA%\JIG Data Finder\config.json`，键名与 1.x（Python + PySide2）版本保持一致，可平滑升级。
界面里的「设置」「型号尺寸匹配」会即时写回该文件。

### 快捷键

| 按键 | 作用 |
|---|---|
| `Ctrl+Enter` | 开始查询 |
| `Esc` | 退出透视明细 / 关闭设置面板 |

## 项目结构

```
src/core/       纯 TS 业务逻辑(配置/读取/查询/透视/审查/校验), 可单测
src/ui/         React 组件(Grid / OverlayScrollbar / 各对话框)
src/styles/     设计令牌与全局样式
src-tauri/      Rust 宿主、能力权限、图标
tests/          Vitest 用例与测试数据
tools/          造数、读盘校验、打包脚本
docs/           领域规则、界面截图、图标设计稿
```

## 测试与校验

```powershell
npm run verify   # 类型检查 + 全部单测 + Excel 读取链路校验
```

## 领域约定

- **JIG** 指一张 2.2 m × 2.5 m 的金属板材，只作名词，不译为「夹具」；
- 信息层级为 `P/N → Lot ID / CST ID / 工程名 → Slot No → Jig ID`；
- `(CST, Slot)` 全局唯一，一层一块 JIG；
- 空值规则：LOT 不能为空，CST 可以为空（仅 Jig Loading 阶段允许），透视读取时 CST 为空会用 Lot ID 回填。

更完整的业务规则见 [docs/domain-rules.md](docs/domain-rules.md)。

## 作者

huawenda
