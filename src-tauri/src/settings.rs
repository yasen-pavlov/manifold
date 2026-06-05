// settings.rs - app settings, persisted at ~/.config/manifold/settings.json.
//
// Kept intentionally small but easy to grow: add a field with a #[serde(default ...)]
// and it stays backward-compatible with existing settings files.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

fn default_silent_start() -> bool {
    true
}

fn default_window_controls() -> String {
    "auto".into()
}

fn default_ui_scale() -> f64 {
    1.0
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Settings {
    /// Explicit Steam root override. Empty string => auto-detect.
    #[serde(default)]
    pub steam_root: String,
    /// Start Steam minimized to tray (`steam -silent`).
    #[serde(default = "default_silent_start")]
    pub silent_start: bool,
    /// Window-control button placement: "auto" | "left" | "right" | "hidden".
    #[serde(default = "default_window_controls")]
    pub window_controls: String,
    /// Interface zoom factor (1.0 = 100%).
    #[serde(default = "default_ui_scale")]
    pub ui_scale: f64,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            steam_root: String::new(),
            silent_start: true,
            window_controls: default_window_controls(),
            ui_scale: default_ui_scale(),
        }
    }
}

fn config_dir() -> PathBuf {
    if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
        if !xdg.is_empty() {
            return PathBuf::from(xdg).join("manifold");
        }
    }
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
        .join(".config")
        .join("manifold")
}

fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

fn read() -> Option<Settings> {
    let text = fs::read_to_string(settings_path()).ok()?;
    serde_json::from_str(&text).ok()
}

/// Current settings, falling back to defaults if absent/unreadable. No side effects.
pub fn current() -> Settings {
    read().unwrap_or_default()
}

/// Explicit load command result (same as current(), but surfaced to the frontend).
pub fn load() -> Result<Settings, String> {
    Ok(current())
}

fn write_at(path: &Path, s: &Settings) -> Result<(), String> {
    let dir = path.parent().ok_or("settings path has no parent")?;
    fs::create_dir_all(dir).map_err(|e| format!("create config dir: {e}"))?;
    let json = serde_json::to_string_pretty(s).map_err(|e| format!("serialize settings: {e}"))?;
    let tmp = dir.join(format!(".settings.tmp.{}", std::process::id()));
    fs::write(&tmp, json).map_err(|e| format!("write settings temp: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("save settings: {e}")
    })?;
    Ok(())
}

pub fn save(s: Settings) -> Result<(), String> {
    write_at(&settings_path(), &s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_roundtrip() {
        let d = Settings::default();
        assert!(d.silent_start);
        assert_eq!(d.steam_root, "");

        let dir = std::env::temp_dir().join(format!("manifold_set_{}", std::process::id()));
        let path = dir.join("settings.json");
        let _ = fs::remove_dir_all(&dir);

        let s = Settings { steam_root: "/x/steam".into(), silent_start: false };
        write_at(&path, &s).unwrap();
        let back: Settings = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(back.steam_root, "/x/steam");
        assert!(!back.silent_start);

        // missing fields fall back to defaults (forward/backward compat)
        let partial: Settings = serde_json::from_str("{}").unwrap();
        assert!(partial.silent_start);
        assert_eq!(partial.steam_root, "");

        fs::remove_dir_all(&dir).ok();
    }
}
