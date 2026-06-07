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
    0.0 // 0 = auto (follow the desktop / GDK scale)
}

/// The desktop's intended UI scale, when the platform exposes one we can read.
///
/// On Linux/GTK we derive it from GDK_SCALE x GDK_DPI_SCALE (falling back to
/// QT_SCALE_FACTOR). On Windows/macOS there are no such vars and the webview's
/// `devicePixelRatio` already reflects the OS scale, so we return 0.0 to mean
/// "no hint; let the frontend use devicePixelRatio".
pub fn system_scale() -> f64 {
    let parse = |k: &str| {
        std::env::var(k)
            .ok()
            .and_then(|v| v.trim().parse::<f64>().ok())
            .filter(|n| n.is_finite() && *n > 0.0)
    };
    let gdk = parse("GDK_SCALE");
    let dpi = parse("GDK_DPI_SCALE");
    let qt = parse("QT_SCALE_FACTOR");
    if gdk.is_none() && dpi.is_none() && qt.is_none() {
        return 0.0; // no desktop-scale hint on this platform
    }
    let mut s = gdk.unwrap_or(1.0) * dpi.unwrap_or(1.0);
    if (s - 1.0).abs() < 0.001 {
        if let Some(q) = qt {
            s = q;
        }
    }
    if s.is_finite() && s > 0.0 {
        s.clamp(0.5, 3.0)
    } else {
        0.0
    }
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
    /// When true, closing the window hides Manifold to the tray instead of quitting.
    #[serde(default)]
    pub close_to_tray: bool,
    /// When true, Manifold launches hidden in the tray (open it from the tray icon).
    #[serde(default)]
    pub start_minimized: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            steam_root: String::new(),
            silent_start: true,
            window_controls: default_window_controls(),
            ui_scale: default_ui_scale(),
            close_to_tray: false,
            start_minimized: false,
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

        let s = Settings {
            steam_root: "/x/steam".into(),
            silent_start: false,
            window_controls: default_window_controls(),
            ui_scale: default_ui_scale(),
            close_to_tray: true,
            start_minimized: true,
        };
        write_at(&path, &s).unwrap();
        let back: Settings = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(back.steam_root, "/x/steam");
        assert!(!back.silent_start);
        assert!(back.close_to_tray);
        assert!(back.start_minimized);

        // missing fields fall back to defaults (forward/backward compat)
        let partial: Settings = serde_json::from_str("{}").unwrap();
        assert!(partial.silent_start);
        assert_eq!(partial.steam_root, "");
        assert!(!partial.close_to_tray);
        assert!(!partial.start_minimized);

        fs::remove_dir_all(&dir).ok();
    }

    use std::sync::atomic::{AtomicU32, Ordering};
    static SC: AtomicU32 = AtomicU32::new(0);
    fn uniq() -> String {
        format!("{}_{}", std::process::id(), SC.fetch_add(1, Ordering::SeqCst))
    }

    /// Serializes + isolates env mutation for the listed keys; restores on drop.
    struct Env {
        _g: std::sync::MutexGuard<'static, ()>,
        saved: Vec<(&'static str, Option<String>)>,
    }
    impl Env {
        fn new(keys: &[&'static str]) -> Self {
            let g = crate::TEST_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let saved = keys.iter().map(|k| (*k, std::env::var(k).ok())).collect();
            for k in keys {
                std::env::remove_var(k);
            }
            Env { _g: g, saved }
        }
        fn set(&self, k: &str, v: impl AsRef<std::ffi::OsStr>) {
            std::env::set_var(k, v);
        }
    }
    impl Drop for Env {
        fn drop(&mut self) {
            for (k, v) in &self.saved {
                match v {
                    Some(x) => std::env::set_var(k, x),
                    None => std::env::remove_var(k),
                }
            }
        }
    }

    #[test]
    fn system_scale_reads_desktop_hints() {
        let e = Env::new(&["GDK_SCALE", "GDK_DPI_SCALE", "QT_SCALE_FACTOR"]);
        // no hints -> 0.0 (let the frontend use devicePixelRatio)
        assert_eq!(system_scale(), 0.0);
        // GDK_SCALE alone
        e.set("GDK_SCALE", "2");
        assert_eq!(system_scale(), 2.0);
        // GDK product ~1 falls back to QT_SCALE_FACTOR
        e.set("GDK_SCALE", "1");
        e.set("QT_SCALE_FACTOR", "1.5");
        assert_eq!(system_scale(), 1.5);
        // out-of-range is clamped
        e.set("GDK_SCALE", "10");
        assert_eq!(system_scale(), 3.0);
        // garbage is ignored
        e.set("GDK_SCALE", "not-a-number");
        std::env::remove_var("QT_SCALE_FACTOR");
        assert_eq!(system_scale(), 0.0);
    }

    #[test]
    fn save_then_current_via_xdg() {
        let e = Env::new(&["XDG_CONFIG_HOME", "HOME"]);
        let dir = std::env::temp_dir().join(format!("manifold_cfg_{}", uniq()));
        e.set("XDG_CONFIG_HOME", &dir);
        save(Settings {
            steam_root: "/x/steam".into(),
            silent_start: false,
            window_controls: "left".into(),
            ui_scale: 1.5,
            close_to_tray: false,
            start_minimized: false,
        })
        .unwrap();
        assert!(dir.join("manifold/settings.json").exists());
        let c = current();
        assert_eq!(c.steam_root, "/x/steam");
        assert!(!c.silent_start);
        assert_eq!(c.window_controls, "left");
        assert!(load().is_ok());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn config_dir_falls_back_to_home_and_defaults_when_absent() {
        let e = Env::new(&["XDG_CONFIG_HOME", "HOME"]);
        let dir = std::env::temp_dir().join(format!("manifold_home_{}", uniq()));
        e.set("HOME", &dir); // no XDG_CONFIG_HOME -> uses HOME/.config
        // nothing written yet -> defaults
        assert_eq!(current().steam_root, "");
        assert!(current().silent_start);
        fs::remove_dir_all(&dir).ok();
    }
}
