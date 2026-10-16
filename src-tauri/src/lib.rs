//! JIG Data Finder - Tauri 宿主层
//!
//! 职责范围刻意收窄: 窗口/托盘/单实例/对话框。
//! 所有数据处理都在前端 TypeScript (src/core) 完成, 这里不含业务逻辑,
//! 保证 Python 迁移过来的计算结果可被纯函数测试覆盖。

use std::sync::Mutex;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

/// 托盘菜单文案 ID 与前端约定的状态标记
const MENU_SHOW: &str = "show";
const MENU_QUIT: &str = "quit";

/// 记录窗口是否已被用户显式关闭 (点"退出程序"才真正退出)
static FORCE_QUIT: Mutex<bool> = Mutex::new(false);

fn set_force_quit(value: bool) {
    if let Ok(mut flag) = FORCE_QUIT.lock() {
        *flag = value;
    }
}

fn should_force_quit() -> bool {
    FORCE_QUIT.lock().map(|f| *f).unwrap_or(false)
}

#[tauri::command]
fn is_force_quit() -> bool {
    should_force_quit()
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
        .invoke_handler(tauri::generate_handler![is_force_quit])
        .setup(|app| {
            let show_item = MenuItem::with_id(app, MENU_SHOW, "显示主窗口", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, MENU_QUIT, "退出程序", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &PredefinedMenuItem::separator(app)?, &quit_item])?;

            TrayIconBuilder::with_id("main-tray")
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
                                if win.is_visible() {
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
                // 用户点右上角关闭: 若启用了关闭到托盘, 则隐藏而非退出。
                // 该开关保存在 %APPDATA% 配置里, 由前端决定, 这里通过
                // 事件阻止默认退出并把控制权交给前端。
                if !should_force_quit() {
                    let handle = window.clone();
                    // 询问前端是否应关闭到托盘 (默认关闭)
                    handle
                        .eval("window.__onCloseRequested && window.__onCloseRequested()")
                        .ok();
                    api.prevent_close();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running JIG Data Finder");
}