//! JIG Data Finder - Tauri 宿主层
//!
//! 职责范围刻意收窄: 窗口/托盘/单实例/对话框。
//! 所有数据处理都在前端 TypeScript (src/core) 完成, 这里不含业务逻辑,
//! 保证 Python 迁移过来的计算结果可被纯函数测试覆盖。

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

/// 托盘菜单文案 ID 与前端约定的状态标记
const MENU_SHOW: &str = "show";
const MENU_QUIT: &str = "quit";

/// 托盘图标 ID, 供 set_tray_enabled 查找
const TRAY_ID: &str = "main-tray";

/// 记录窗口是否已被用户显式关闭 (点"退出程序"才真正退出)
static FORCE_QUIT: Mutex<bool> = Mutex::new(false);

/// 关闭窗口时是否隐藏到托盘, 由前端启动时同步
static CLOSE_TO_TRAY: Mutex<bool> = Mutex::new(true);

/// 是否显示系统托盘图标, 由前端启动和保存设置时同步
///
/// 托盘图标必须在 setup 阶段就建好 (那时前端还没跑, 读不到配置),
/// 所以这里用"先建后显隐"而不是"按需创建": 前端拿到配置后调
/// set_tray_enabled 把它 show/hide。
static TRAY_ENABLED: Mutex<bool> = Mutex::new(true);

fn set_force_quit(value: bool) {
    if let Ok(mut flag) = FORCE_QUIT.lock() {
        *flag = value;
    }
}

fn should_force_quit() -> bool {
    FORCE_QUIT.lock().map(|f| *f).unwrap_or(false)
}

fn close_to_tray() -> bool {
    CLOSE_TO_TRAY.lock().map(|f| *f).unwrap_or(true)
}

fn tray_enabled() -> bool {
    TRAY_ENABLED.lock().map(|f| *f).unwrap_or(true)
}

/// 前端在启动和保存设置时调用, 同步"关闭到托盘"开关
#[tauri::command]
fn set_close_to_tray(enabled: bool) {
    if let Ok(mut flag) = CLOSE_TO_TRAY.lock() {
        *flag = enabled;
    }
}

/// 前端在启动和保存设置时调用, 同步"显示托盘图标"开关
///
/// 关掉时图标真的从系统托盘消失 (不是只隐藏菜单), 与旧版
/// `if config.tray_enabled and QSystemTrayIcon.isSystemTrayAvailable()`
/// 的语义一致 —— 托盘不可用时也不注册图标。
#[tauri::command]
fn set_tray_enabled(app: tauri::AppHandle, enabled: bool) {
    if let Ok(mut flag) = TRAY_ENABLED.lock() {
        *flag = enabled;
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        // 失败不致命: 只是图标状态没对上, 下次启动会重来
        let _ = tray.set_visible(enabled);
    }
}

#[tauri::command]
fn is_force_quit() -> bool {
    should_force_quit()
}

/// 返回配置目录: `%APPDATA%\JIG Data Finder`
///
/// 必须与旧版 Python 版 (config.py get_config_dir) 完全一致, 否则
/// 新版读不到旧版留下的设置, 用户升级后要重新配置一遍。
///
/// 注意: **不能**用 tauri 的 `app_data_dir()` / `app_config_dir()`。
/// 那两个都会按 bundle identifier 再套一层, 实际返回
/// `%APPDATA%\com.jigdatafinder.app\...`, 与旧版路径不同 —— 真机验证
/// 时正是踩了这个坑, 配置读写全部落到了错误目录。
///
/// 这里直接从环境变量取 %APPDATA%, 与 Python 的 os.getenv('APPDATA')
/// 语义一致; 环境变量缺失时回退到用户目录手工拼接 (同 Python 版做法)。
#[tauri::command]
fn legacy_config_dir() -> Result<String, String> {
    let appdata = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            // 与 Python 版一致: APPDATA 缺失时手工构建
            let home = std::env::var_os("USERPROFILE")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("."));
            home.join("AppData").join("Roaming")
        });
    Ok(appdata.join("JIG Data Finder").to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单实例: 再次启动时聚焦已有窗口, 避免配置被并发写坏
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            is_force_quit,
            set_close_to_tray,
            set_tray_enabled,
            legacy_config_dir
        ])
        .setup(|app| {
            let show_item = MenuItem::with_id(app, MENU_SHOW, "显示主窗口", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, MENU_QUIT, "退出程序", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &PredefinedMenuItem::separator(app)?, &quit_item])?;

            TrayIconBuilder::with_id(TRAY_ID)
                .icon(app.default_window_icon().cloned().unwrap())
                .tooltip("JIG Data Finder - 数据查询助手")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        MENU_SHOW => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                            }
                        }
                        MENU_QUIT => {
                            set_force_quit(true);
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.close();
                            } else {
                                app.exit(0);
                            }
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    // 单击切换显示/隐藏, 双击置前, 对齐 PySide2 版行为
                    if let TrayIconEvent::Click { button, button_state, .. } = event {
                        let Some(win) = tray.app_handle().get_webview_window("main") else {
                            return;
                        };
                        match (button, button_state) {
                            (MouseButton::Left, MouseButtonState::Up) => {
                                // is_visible 返回 Result, 出错时按"不可见"处理并显示窗口
                                if win.is_visible().unwrap_or(false) {
                                    let _ = win.hide();
                                } else {
                                    let _ = win.show();
                                    let _ = win.set_focus();
                                }
                            }
                            (MouseButton::Left, MouseButtonState::Down) => {}
                            _ => {}
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // 托盘菜单的"退出程序"会置位 force_quit, 此时真正关闭。
                if should_force_quit() {
                    return;
                }
                // 用户点右上角关闭: 若配置启用了关闭到托盘, 隐藏窗口继续运行。
                // 配置由前端在启动时通过 set_close_to_tray 同步过来,
                // 避免宿主层去解析 %APPDATA% 下的 JSON。
                //
                // 两个开关必须一起看: 托盘图标是唯一的"把窗口找回来"的
                // 入口, 若它被关掉而这里仍隐藏窗口, 用户点了关闭就再也
                // 打不回来 (只能杀进程)。所以任一为关, 关闭窗口就等于
                // 退出程序 —— 此时不能 prevent_close, 否则窗口关不掉。
                if close_to_tray() && tray_enabled() {
                    let _ = window.hide();
                    api.prevent_close();
                } else {
                    set_force_quit(true);
                    /*
                     * 必须显式 exit(0): 只把窗口关掉是不够的。
                     * 托盘图标注册后 Tauri 的事件循环不会因为"最后一个
                     * 窗口消失"而退出 (托盘本身就是常驻对象), 进程会
                     * 留在后台 —— 窗口没了、图标也可能没有, 用户既看不见
                     * 也找不回来, 只能去任务管理器杀。
                     */
                    window.app_handle().exit(0);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running JIG Data Finder");
}