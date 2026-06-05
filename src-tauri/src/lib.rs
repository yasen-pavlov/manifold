mod steam;
mod vdfedit;

use steam::LibraryDto;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            scan_library,
            set_launch_options,
            set_compat_tool
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
