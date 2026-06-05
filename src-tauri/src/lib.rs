mod appinfo;
mod steam;
mod store;
mod vdfedit;

use steam::LibraryDto;
use store::PresetStore;

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
fn load_presets() -> Result<PresetStore, String> {
    store::load()
}

#[tauri::command]
fn save_presets(store: PresetStore) -> Result<(), String> {
    store::save(store)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            scan_library,
            set_launch_options,
            set_compat_tool,
            close_steam,
            start_steam,
            load_presets,
            save_presets
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
