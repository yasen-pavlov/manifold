mod appinfo;
mod settings;
mod steam;
mod store;
mod vdfedit;

use settings::Settings;
use steam::{LibraryDto, RootCandidate};
use store::PresetStore;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WindowEvent};

// Shared across test modules: serializes process-wide env mutation (HOME, XDG_CONFIG_HOME,
// GDK_SCALE, ...) so env-dependent tests in different modules don't race. Test-only.
#[cfg(test)]
pub(crate) static TEST_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[tauri::command]
fn scan_library() -> Result<LibraryDto, String> {
    steam::scan()
}

/// changes: list of (appid, launch_options_value). Empty value clears that game's options.
#[tauri::command]
fn set_launch_options(changes: Vec<(String, String)>) -> Result<LibraryDto, String> {
    steam::write_launch_options(changes)
}

/// changes: list of (appid, compat_tool_internal_name). "default" removes the forced tool.
#[tauri::command]
fn set_compat_tool(changes: Vec<(String, String)>) -> Result<LibraryDto, String> {
    steam::write_compat_tool(changes)
}

#[tauri::command]
fn close_steam() -> Result<LibraryDto, String> {
    steam::close_steam()
}

#[tauri::command]
fn start_steam() -> Result<LibraryDto, String> {
    steam::start_steam()
}

#[tauri::command]
fn load_settings() -> Result<Settings, String> {
    settings::load()
}

#[tauri::command]
fn save_settings(settings: Settings) -> Result<(), String> {
    settings::save(settings)
}

#[tauri::command]
fn discover_steam_roots() -> Vec<RootCandidate> {
    steam::discover_roots()
}

#[tauri::command]
fn get_system_scale() -> f64 {
    settings::system_scale()
}

#[tauri::command]
fn load_presets() -> Result<PresetStore, String> {
    store::load()
}

#[tauri::command]
fn save_presets(store: PresetStore) -> Result<(), String> {
    store::save(store)
}

/// Reveal and focus the main window (used by the tray "Show" item).
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Hide the main window to the tray (used by the tray "Hide" item).
fn hide_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

/// Build the system-tray icon with a Show / Hide / Quit menu.
///
/// Left-click is a shortcut for "Show Manifold"; the menu opens on right-click.
/// On Linux the libayatana appindicator backend does not deliver icon click
/// events, so there the menu (which lists Show / Hide / Quit) is the only
/// interaction surface; the menu works on every platform.
fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show_i = MenuItem::with_id(app, "show", "Show Manifold", true, None::<&str>)?;
    let hide_i = MenuItem::with_id(app, "hide", "Hide to tray", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit Manifold", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_i, &hide_i, &quit_i])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("no default window icon to use for the tray")?;
    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("Manifold")
        .menu(&menu)
        // Left-click is a shortcut for "Show Manifold" (open if hidden, focus if
        // already open); the menu opens on right-click. Where the platform does not
        // deliver click events (Linux appindicator) the menu is the only surface.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "hide" => hide_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            setup_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // When close-to-tray is enabled, the X hides the window instead of
            // quitting. Read the setting live so the toggle takes effect without a restart.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if settings::current().close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            scan_library,
            set_launch_options,
            set_compat_tool,
            close_steam,
            start_steam,
            load_settings,
            save_settings,
            discover_steam_roots,
            get_system_scale,
            load_presets,
            save_presets
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    /// Isolate HOME / XDG_CONFIG_HOME at a temp dir so the command wrappers touch
    /// nothing real; restore on drop. Serialized via the shared env lock.
    struct Env {
        _g: std::sync::MutexGuard<'static, ()>,
        home_prev: Option<String>,
        xdg_prev: Option<String>,
        dir: PathBuf,
    }
    impl Env {
        fn new() -> Self {
            let g = TEST_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let dir = std::env::temp_dir().join(format!("manifold_lib_{}", std::process::id()));
            fs::create_dir_all(&dir).unwrap();
            let home_prev = std::env::var("HOME").ok();
            let xdg_prev = std::env::var("XDG_CONFIG_HOME").ok();
            std::env::set_var("HOME", &dir);
            std::env::set_var("XDG_CONFIG_HOME", dir.join(".config"));
            Env { _g: g, home_prev, xdg_prev, dir }
        }
    }
    impl Drop for Env {
        fn drop(&mut self) {
            steam::set_test_running(None);
            match &self.home_prev {
                Some(h) => std::env::set_var("HOME", h),
                None => std::env::remove_var("HOME"),
            }
            match &self.xdg_prev {
                Some(x) => std::env::set_var("XDG_CONFIG_HOME", x),
                None => std::env::remove_var("XDG_CONFIG_HOME"),
            }
            fs::remove_dir_all(&self.dir).ok();
        }
    }

    #[test]
    fn command_wrappers_delegate_to_modules() {
        let env = Env::new();
        steam::build_test_tree(&env.dir);
        steam::set_test_running(Some(false));

        // library + writes
        assert!(scan_library().is_ok());
        assert!(set_launch_options(vec![("111".into(), "NEW=1 game %command%".into())]).is_ok());
        assert!(set_compat_tool(vec![("111".into(), "proton_9".into())]).is_ok());

        // settings
        assert!(load_settings().is_ok());
        assert!(save_settings(Settings::default()).is_ok());
        assert!(get_system_scale() >= 0.0);
        assert!(discover_steam_roots().iter().any(|r| r.path.ends_with(".steam/steam")));

        // presets
        let loaded = load_presets().unwrap();
        assert!(!loaded.presets.is_empty()); // seeded on first run
        assert!(save_presets(PresetStore::default()).is_ok());

        // process control - no real process is spawned (early-return branches)
        steam::set_test_running(Some(false));
        assert!(close_steam().is_ok());
        steam::set_test_running(Some(true));
        assert!(start_steam().is_ok());
    }
}
