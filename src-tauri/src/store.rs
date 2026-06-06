// store.rs - persistence for user-created presets.
//
// A preset is a saved launch line: an ordered list of building blocks composed to a single
// `... %command%` string. There is ONE unified list (the old "presets" vs "single options"
// distinction is gone - single options are now catalogue building blocks in the UI).
//
// Stored as JSON at ~/.config/manifold/presets.json. On first run the file is seeded with a
// set of sensible defaults so the app isn't empty. Legacy files (with a separate `options`
// list and per-item `kind`) are migrated on load and rewritten in the new shape.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// A saved launch line. `value` is the composed `... %command%` string - the source of
/// truth that gets written to Steam. The UI parses it into editable pills and composes it
/// back, so the persisted format stays decoupled from the (evolving) catalogue schema.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PresetItem {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub desc: String,
    pub value: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct PresetStore {
    pub presets: Vec<PresetItem>,
}

/// Legacy on-disk shape (pre-merge): two lists, each item carrying a `kind`. Used only to
/// read older files; we never write this shape again.
#[derive(Deserialize)]
struct LegacyItem {
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    desc: String,
    value: String,
}

#[derive(Deserialize)]
struct LegacyStore {
    #[serde(default)]
    presets: Vec<LegacyItem>,
    #[serde(default)]
    options: Vec<LegacyItem>,
}

/// Default single-option ids that were seeded by older versions. On migration these are
/// dropped (they now live in the UI catalogue); any other (user-created) option is kept by
/// converting it into a preset so no user data is lost.
const SEEDED_OPTION_IDS: &[&str] = &["o_opti", "o_dlss", "o_mh", "o_hud", "o_log", "o_gm"];

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

fn item(id: &str, name: &str, desc: &str, value: &str) -> PresetItem {
    PresetItem {
        id: id.into(),
        name: name.into(),
        desc: desc.into(),
        value: value.into(),
    }
}

fn default_store() -> PresetStore {
    PresetStore {
        presets: vec![
            item(
                "pre_hdr",
                "Native HDR",
                "Wayland-native HDR pipeline with the MangoHud overlay.",
                "PROTON_ENABLE_WAYLAND=1 PROTON_ENABLE_HDR=1 DXVK_HDR=1 mangohud %command%",
            ),
            item(
                "pre_opti",
                "OptiScaler (DLSS to FSR4)",
                "Force FSR4 in DLSS/XeSS-only games via OptiScaler.",
                "PROTON_USE_OPTISCALER=1 PROTON_DLSS_UPGRADE=1 game %command%",
            ),
            item(
                "pre_gs",
                "Gamescope HDR",
                "4K240 gamescope session with HDR and VRR.",
                "PROTON_USE_NTSYNC=1 ENABLE_GAMESCOPE_WSI=1 DXVK_HDR=1 gamescope -W 3840 -H 2160 -r 240 -o 60 -f --adaptive-sync --hdr-enabled -- %command%",
            ),
            item(
                "pre_perf",
                "CachyOS performance",
                "Performance power profile under GameMode, capped at 120.",
                "DXVK_FRAME_RATE=120 game-performance gamemoderun game %command%",
            ),
        ],
    }
}

/// Fold a legacy two-list store into the unified single list. Returns the merged store and
/// whether a migration actually happened (so the caller can rewrite the file).
fn migrate(legacy: LegacyStore) -> (PresetStore, bool) {
    let had_options = !legacy.options.is_empty();
    let mut presets: Vec<PresetItem> = legacy
        .presets
        .into_iter()
        .map(|i| item(&i.id, &i.name, &i.desc, &i.value))
        .collect();

    // Keep user-created options (anything not in the old default seed) by promoting them to
    // presets; drop the seeded defaults, which are now catalogue building blocks.
    for o in legacy.options {
        if SEEDED_OPTION_IDS.contains(&o.id.as_str()) {
            continue;
        }
        presets.push(item(&o.id, &o.name, &o.desc, &o.value));
    }

    (PresetStore { presets }, had_options)
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

/// Read + migrate a store file. Returns the unified store and whether it should be rewritten.
fn read_store(path: &Path) -> Result<(PresetStore, bool), String> {
    let text = fs::read_to_string(path).map_err(|e| format!("read presets: {e}"))?;
    let legacy: LegacyStore =
        serde_json::from_str(&text).map_err(|e| format!("parse presets.json: {e}"))?;
    Ok(migrate(legacy))
}

/// Load the preset store. Seeds defaults (and writes them) on first run; migrates + rewrites
/// legacy files in place.
pub fn load() -> Result<PresetStore, String> {
    let path = presets_path();
    if !path.exists() {
        let def = default_store();
        // best-effort seed; ignore write failure so the UI still gets defaults
        let _ = write_store_at(&path, &def);
        return Ok(def);
    }
    let (store, migrated) = read_store(&path)?;
    if migrated {
        // best-effort rewrite in the new shape; ignore failure so load still succeeds
        let _ = write_store_at(&path, &store);
    }
    Ok(store)
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
        let (loaded, migrated) = read_store(&path).unwrap();
        assert!(!migrated, "a fresh new-shape file must not report a migration");
        assert_eq!(loaded.presets.len(), def.presets.len());
        assert_eq!(loaded.presets[0].name, "Native HDR");

        // mutate + persist + reload
        let mut s = loaded;
        s.presets
            .push(item("p_custom", "My Preset", "desc", "gamemoderun game %command%"));
        write_store_at(&path, &s).unwrap();
        let (again, _) = read_store(&path).unwrap();
        assert!(again
            .presets
            .iter()
            .any(|p| p.id == "p_custom" && p.value.contains("gamemoderun")));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn defaults_are_sane() {
        let d = default_store();
        assert!(d.presets.iter().all(|p| p.value.contains("%command%")));
        // exactly one %command% in each seed
        assert!(d
            .presets
            .iter()
            .all(|p| p.value.matches("%command%").count() == 1));
    }

    #[test]
    fn migrates_legacy_two_list_file() {
        let dir = std::env::temp_dir().join(format!("manifold_migrate_{}", std::process::id()));
        let path = dir.join("presets.json");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        // a legacy file: one real preset, one seeded option (dropped), one custom option (kept)
        let legacy = r#"{
            "presets": [
                {"id":"p_hdr","kind":"preset","name":"Native HDR","desc":"d","value":"DXVK_HDR=1 game %command%"}
            ],
            "options": [
                {"id":"o_mh","kind":"option","name":"mangohud","desc":"overlay","value":"mangohud"},
                {"id":"o_custom","kind":"option","name":"My env","desc":"mine","value":"MY_VAR=1"}
            ]
        }"#;
        fs::write(&path, legacy).unwrap();

        let (store, migrated) = read_store(&path).unwrap();
        assert!(migrated, "legacy file with options must report a migration");
        assert!(store.presets.iter().any(|p| p.id == "p_hdr"));
        assert!(
            !store.presets.iter().any(|p| p.id == "o_mh"),
            "seeded default option should be dropped"
        );
        assert!(
            store.presets.iter().any(|p| p.id == "o_custom" && p.value == "MY_VAR=1"),
            "user-created option should be promoted to a preset"
        );

        // load() should rewrite it in the new shape (no more `options`, no `kind`)
        let _ = super::write_store_at(&path, &store);
        let text = fs::read_to_string(&path).unwrap();
        assert!(!text.contains("\"options\""));
        assert!(!text.contains("\"kind\""));

        fs::remove_dir_all(&dir).ok();
    }
}
