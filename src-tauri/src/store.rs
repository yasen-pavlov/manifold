// store.rs — persistence for user-created presets and single-options.
//
// Stored as JSON at ~/.config/manifold/presets.json. On first run the file is seeded
// with a set of sensible defaults so the app isn't empty.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PresetItem {
    pub id: String,
    pub kind: String, // "preset" | "option"
    pub name: String,
    #[serde(default)]
    pub desc: String,
    pub value: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct PresetStore {
    pub presets: Vec<PresetItem>,
    pub options: Vec<PresetItem>,
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

fn presets_path() -> PathBuf {
    config_dir().join("presets.json")
}

fn item(id: &str, kind: &str, name: &str, desc: &str, value: &str) -> PresetItem {
    PresetItem {
        id: id.into(),
        kind: kind.into(),
        name: name.into(),
        desc: desc.into(),
        value: value.into(),
    }
}

fn default_store() -> PresetStore {
    PresetStore {
        presets: vec![
            item("p_hdr", "preset", "Native HDR", "Wayland-native HDR pipeline (Proton + DXVK).", "PROTON_ENABLE_WAYLAND=1 PROTON_ENABLE_HDR=1 DXVK_HDR=1 game %command%"),
            item("p_xw", "preset", "XWayland (overlay)", "Force XWayland — for overlays & legacy capture.", "game_xwayland %command%"),
            item("p_gs", "preset", "Gamescope HDR", "Run inside a gamescope micro-compositor.", "game_gamescope %command%"),
            item("p_opti", "preset", "OptiScaler (DLSS→FSR4)", "Swap DLSS/XeSS for FSR4 via OptiScaler.", "PROTON_USE_OPTISCALER=1 game %command%"),
        ],
        options: vec![
            item("o_opti", "option", "PROTON_USE_OPTISCALER=1", "Force OptiScaler (use FSR4 in DLSS/XeSS-only games)", "PROTON_USE_OPTISCALER=1"),
            item("o_dlss", "option", "PROTON_DLSS_UPGRADE=1", "Deploy DLSS DLLs so OptiScaler can hook DLSS", "PROTON_DLSS_UPGRADE=1"),
            item("o_mh", "option", "mangohud", "Show the MangoHud performance overlay", "mangohud"),
            item("o_hud", "option", "DXVK_HUD=fps", "DXVK FPS counter", "DXVK_HUD=fps"),
            item("o_log", "option", "PROTON_LOG=1", "Write a Proton debug log", "PROTON_LOG=1"),
            item("o_gm", "option", "gamemoderun", "Run under Feral GameMode", "gamemoderun"),
        ],
    }
}

fn write_store_at(path: &Path, store: &PresetStore) -> Result<(), String> {
    let dir = path.parent().ok_or("presets path has no parent")?;
    fs::create_dir_all(dir).map_err(|e| format!("create config dir: {e}"))?;
    let json = serde_json::to_string_pretty(store).map_err(|e| format!("serialize presets: {e}"))?;
    let tmp = dir.join(format!(".presets.tmp.{}", std::process::id()));
    fs::write(&tmp, json).map_err(|e| format!("write presets temp: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("save presets: {e}")
    })?;
    Ok(())
}

fn read_store(path: &Path) -> Result<PresetStore, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("read presets: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("parse presets.json: {e}"))
}

/// Load the preset store. Seeds defaults (and writes them) on first run.
pub fn load() -> Result<PresetStore, String> {
    let path = presets_path();
    if !path.exists() {
        let def = default_store();
        // best-effort seed; ignore write failure so the UI still gets defaults
        let _ = write_store_at(&path, &def);
        return Ok(def);
    }
    read_store(&path)
}

/// Persist the whole preset store.
pub fn save(store: PresetStore) -> Result<(), String> {
    write_store_at(&presets_path(), &store)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_round_trips() {
        let dir = std::env::temp_dir().join(format!("manifold_store_{}", std::process::id()));
        let path = dir.join("presets.json");
        let _ = fs::remove_dir_all(&dir);

        // write defaults, read them back
        let def = default_store();
        write_store_at(&path, &def).unwrap();
        let loaded = read_store(&path).unwrap();
        assert_eq!(loaded.presets.len(), def.presets.len());
        assert_eq!(loaded.options.len(), def.options.len());
        assert_eq!(loaded.presets[0].name, "Native HDR");

        // mutate + persist + reload
        let mut s = loaded;
        s.presets.push(item("p_custom", "preset", "My Preset", "desc", "gamemoderun game %command%"));
        write_store_at(&path, &s).unwrap();
        let again = read_store(&path).unwrap();
        assert!(again.presets.iter().any(|p| p.id == "p_custom" && p.value.contains("gamemoderun")));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn defaults_are_sane() {
        let d = default_store();
        assert!(d.presets.iter().all(|p| p.kind == "preset" && p.value.contains("%command%")));
        assert!(d.options.iter().all(|o| o.kind == "option"));
    }
}
