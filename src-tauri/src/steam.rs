// steam.rs — read-only Steam library scanner.
//
// Reads (never writes, this milestone):
//   - libraryfolders.vdf         -> library paths
//   - appmanifest_<appid>.acf    -> appid + name + installed
//   - localconfig.vdf            -> per-appid LaunchOptions
//   - config.vdf                 -> per-appid CompatToolMapping (forced Proton)
//   - compatibilitytools.d/*     -> available custom compat tools
//   - steamapps/common/Proton*   -> available official Proton builds
//   - /proc/*/comm               -> is Steam running?
//
// VDF is parsed only for reading here, so keyvalues-parser's BTreeMap reordering
// is irrelevant — we never render it back. Writes (next milestone) will be surgical.

use keyvalues_parser::{parse, Value, Vdf};
use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

// ----------------------------------------------------------------------------
// DTOs returned to the frontend (shapes match the React mock in src/data.jsx)
// ----------------------------------------------------------------------------

#[derive(Serialize)]
pub struct GameDto {
    pub id: String,     // "app<appid>"
    pub appid: String,
    pub name: String,
    pub status: String, // "installed" | "owned"
    pub compat: String, // internal compat-tool name, or "default"
    pub launch: String, // LaunchOptions string ("" if none)
}

#[derive(Serialize)]
pub struct CompatToolDto {
    pub id: String,   // internal name used in CompatToolMapping
    pub name: String, // display name
    pub note: String,
}

#[derive(Serialize)]
pub struct LibraryDto {
    pub games: Vec<GameDto>,
    pub compat_tools: Vec<CompatToolDto>,
    pub steam_running: bool,
    pub steam_root: String,
    pub steam_user_id: String,
    pub library_path: String,
}

// ----------------------------------------------------------------------------
// VDF navigation helpers (case-insensitive — Steam's casing is inconsistent)
// ----------------------------------------------------------------------------

fn child<'a>(v: &'a Value<'a>, key: &str) -> Option<&'a Value<'a>> {
    let obj = v.get_obj()?;
    obj.iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(key))
        .and_then(|(_, vals)| vals.first())
}

fn nav<'a>(v: &'a Value<'a>, path: &[&str]) -> Option<&'a Value<'a>> {
    let mut cur = v;
    for k in path {
        cur = child(cur, k)?;
    }
    Some(cur)
}

// ----------------------------------------------------------------------------
// Path discovery
// ----------------------------------------------------------------------------

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
}

/// The Steam root we read userdata/config from. ~/.steam/steam and
/// ~/.local/share/Steam are usually the same tree (symlinked).
fn steam_root() -> Option<PathBuf> {
    let candidates = [
        home().join(".steam/steam"),
        home().join(".local/share/Steam"),
        home().join(".steam/root"),
    ];
    candidates.into_iter().find(|p| p.join("config/config.vdf").exists() || p.join("steamapps").is_dir())
}

/// userdata/<id>/config/localconfig.vdf — pick the id dir that actually has one.
fn find_localconfig(root: &Path) -> Option<(String, PathBuf)> {
    let userdata = root.join("userdata");
    let mut best: Option<(String, PathBuf)> = None;
    for entry in fs::read_dir(&userdata).ok()?.flatten() {
        let id = entry.file_name().to_string_lossy().to_string();
        if id == "0" || !id.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let lc = entry.path().join("config/localconfig.vdf");
        if lc.is_file() {
            // prefer the largest (most-populated) localconfig if several users exist
            let size = fs::metadata(&lc).map(|m| m.len()).unwrap_or(0);
            let better = best
                .as_ref()
                .map(|(_, p)| fs::metadata(p).map(|m| m.len()).unwrap_or(0) < size)
                .unwrap_or(true);
            if better {
                best = Some((id, lc));
            }
        }
    }
    best
}

/// All library paths from libraryfolders.vdf (plus the root itself).
fn library_paths(root: &Path) -> Vec<PathBuf> {
    let mut paths = vec![root.to_path_buf()];
    let lf = root.join("steamapps/libraryfolders.vdf");
    if let Ok(text) = fs::read_to_string(&lf) {
        if let Ok(p) = parse(&text) {
            let vdf = Vdf::from(p);
            if let Some(obj) = vdf.value.get_obj() {
                for (_idx, vals) in obj.iter() {
                    if let Some(folder) = vals.first() {
                        if let Some(path) = child(folder, "path").and_then(|v| v.get_str()) {
                            let pb = PathBuf::from(path);
                            if !paths.contains(&pb) {
                                paths.push(pb);
                            }
                        }
                    }
                }
            }
        }
    }
    paths
}

// ----------------------------------------------------------------------------
// Parsers
// ----------------------------------------------------------------------------

struct Installed {
    name: String,
}

/// appid -> installed game (name) from every library's appmanifest_*.acf
fn scan_installed(libs: &[PathBuf]) -> BTreeMap<String, Installed> {
    let mut out = BTreeMap::new();
    for lib in libs {
        let steamapps = lib.join("steamapps");
        let Ok(rd) = fs::read_dir(&steamapps) else { continue };
        for entry in rd.flatten() {
            let fname = entry.file_name();
            let fname = fname.to_string_lossy();
            if !(fname.starts_with("appmanifest_") && fname.ends_with(".acf")) {
                continue;
            }
            let Ok(text) = fs::read_to_string(entry.path()) else { continue };
            let Ok(p) = parse(&text) else { continue };
            let vdf = Vdf::from(p);
            let appid = child(&vdf.value, "appid").and_then(|v| v.get_str());
            let name = child(&vdf.value, "name").and_then(|v| v.get_str());
            if let (Some(appid), Some(name)) = (appid, name) {
                out.insert(appid.to_string(), Installed { name: name.to_string() });
            }
        }
    }
    out
}

/// appid -> LaunchOptions from localconfig.vdf
fn scan_launch_options(localconfig: &Path) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    let Ok(text) = fs::read_to_string(localconfig) else { return out };
    let Ok(p) = parse(&text) else { return out };
    let vdf = Vdf::from(p);
    if let Some(apps) = nav(&vdf.value, &["Software", "Valve", "Steam", "apps"]) {
        if let Some(obj) = apps.get_obj() {
            for (appid, vals) in obj.iter() {
                if let Some(app) = vals.first() {
                    if let Some(lo) = child(app, "LaunchOptions").and_then(|v| v.get_str()) {
                        out.insert(appid.to_string(), lo.to_string());
                    }
                }
            }
        }
    }
    out
}

/// appid -> forced compat-tool internal name from config.vdf CompatToolMapping
fn scan_compat_mapping(config_vdf: &Path) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    let Ok(text) = fs::read_to_string(config_vdf) else { return out };
    let Ok(p) = parse(&text) else { return out };
    let vdf = Vdf::from(p);
    if let Some(map) = nav(
        &vdf.value,
        &["Software", "Valve", "Steam", "CompatToolMapping"],
    ) {
        if let Some(obj) = map.get_obj() {
            for (appid, vals) in obj.iter() {
                if let Some(entry) = vals.first() {
                    if let Some(name) = child(entry, "name").and_then(|v| v.get_str()) {
                        if !name.is_empty() {
                            out.insert(appid.to_string(), name.to_string());
                        }
                    }
                }
            }
        }
    }
    out
}

/// Discover compat tools the user could pick: Default + custom (compatibilitytools.d)
/// + official Proton builds found in steamapps/common.
fn discover_compat_tools(root: &Path, libs: &[PathBuf]) -> Vec<CompatToolDto> {
    let mut tools: Vec<CompatToolDto> = vec![CompatToolDto {
        id: "default".into(),
        name: "Default".into(),
        note: "No forced tool — Steam decides".into(),
    }];
    let mut seen: Vec<String> = vec!["default".into()];

    // custom tools: <dir>/<tool>/compatibilitytool.vdf
    let tool_dirs = [
        root.join("compatibilitytools.d"),
        home().join(".local/share/Steam/compatibilitytools.d"),
        home().join(".steam/root/compatibilitytools.d"),
        PathBuf::from("/usr/share/steam/compatibilitytools.d"),
    ];
    for dir in tool_dirs {
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        for entry in rd.flatten() {
            let vdf_path = entry.path().join("compatibilitytool.vdf");
            let Ok(text) = fs::read_to_string(&vdf_path) else { continue };
            let Ok(p) = parse(&text) else { continue };
            let vdf = Vdf::from(p);
            if let Some(ct) = child(&vdf.value, "compat_tools") {
                if let Some(obj) = ct.get_obj() {
                    for (internal, vals) in obj.iter() {
                        let id = internal.to_string();
                        if seen.iter().any(|s| s == &id) {
                            continue;
                        }
                        let display = vals
                            .first()
                            .and_then(|v| child(v, "display_name"))
                            .and_then(|v| v.get_str())
                            .unwrap_or(&id)
                            .to_string();
                        seen.push(id.clone());
                        tools.push(CompatToolDto {
                            id,
                            name: display,
                            note: "Custom compatibility tool".into(),
                        });
                    }
                }
            }
        }
    }

    // official Proton builds in steamapps/common
    for lib in libs {
        let common = lib.join("steamapps/common");
        let Ok(rd) = fs::read_dir(&common) else { continue };
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("Proton") || !entry.path().is_dir() {
                continue;
            }
            let id = official_proton_internal_name(&name);
            if seen.iter().any(|s| s == &id) {
                continue;
            }
            seen.push(id.clone());
            tools.push(CompatToolDto {
                id,
                name: name.clone(),
                note: "Official Proton build".into(),
            });
        }
    }

    tools
}

/// Best-effort map official Proton folder name -> the internal name Steam uses
/// in CompatToolMapping. Used to populate the picker; refined when we add writes.
fn official_proton_internal_name(folder: &str) -> String {
    let lower = folder.to_lowercase();
    if lower.contains("experimental") {
        return "proton_experimental".into();
    }
    // "Proton 9.0 (Beta)" -> "proton_9"; "Proton 8.0" -> "proton_8"
    if let Some(rest) = lower.strip_prefix("proton ") {
        if let Some(major) = rest.split(['.', ' ']).next() {
            if major.chars().all(|c| c.is_ascii_digit()) && !major.is_empty() {
                return format!("proton_{major}");
            }
        }
    }
    lower.replace([' ', '-', '(', ')'], "_")
}

fn steam_running() -> bool {
    let Ok(rd) = fs::read_dir("/proc") else { return false };
    for entry in rd.flatten() {
        let comm = entry.path().join("comm");
        if let Ok(name) = fs::read_to_string(&comm) {
            if name.trim() == "steam" {
                return true;
            }
        }
    }
    false
}

fn is_noise_app(appid: &str, name: &str) -> bool {
    // Steam runtimes, redistributables, Proton tools — not real games.
    if appid == "228980" {
        return true; // Steamworks Common Redistributables
    }
    let n = name.to_lowercase();
    n.starts_with("proton")
        || n.starts_with("steam linux runtime")
        || n.starts_with("steamworks common")
        || n == "steamvr"
}

// ----------------------------------------------------------------------------
// Public command
// ----------------------------------------------------------------------------

pub fn scan() -> Result<LibraryDto, String> {
    let root = steam_root().ok_or("Steam installation not found")?;
    let libs = library_paths(&root);
    let library_path = libs
        .iter()
        .find(|p| p.join("steamapps").is_dir())
        .cloned()
        .unwrap_or_else(|| root.clone());

    let installed = scan_installed(&libs);
    let (user_id, localconfig) = find_localconfig(&root)
        .ok_or("No localconfig.vdf found (no Steam user data)")?;
    let launch = scan_launch_options(&localconfig);
    let config_vdf = root.join("config/config.vdf");
    let compat = scan_compat_mapping(&config_vdf);
    let compat_tools = discover_compat_tools(&root, &libs);

    // Build the row set: every installed game, plus any owned (not-installed) appid
    // that has been customised (has launch options or a forced compat tool).
    let mut appids: Vec<String> = Vec::new();
    for id in installed.keys() {
        appids.push(id.clone());
    }
    for id in launch.keys().chain(compat.keys()) {
        if !appids.contains(id) {
            appids.push(id.clone());
        }
    }

    let mut games: Vec<GameDto> = Vec::new();
    for appid in appids {
        // Skip appid "0" (the global-default compat bucket) and non-Steam shortcuts
        // (high-bit 32-bit IDs >= 2^31 — out of scope; they live in shortcuts.vdf).
        match appid.parse::<u64>() {
            Ok(n) if n == 0 || n >= 2_147_483_648 => continue,
            Err(_) => continue,
            _ => {}
        }
        let inst = installed.get(&appid);
        let name = match inst {
            Some(i) => i.name.clone(),
            None => format!("App {appid}"),
        };
        if is_noise_app(&appid, &name) {
            continue;
        }
        let status = if inst.is_some() { "installed" } else { "owned" };
        let compat_name = compat.get(&appid).cloned().unwrap_or_else(|| "default".into());
        let launch_opts = launch.get(&appid).cloned().unwrap_or_default();
        games.push(GameDto {
            id: format!("app{appid}"),
            appid: appid.clone(),
            name,
            status: status.into(),
            compat: compat_name,
            launch: launch_opts,
        });
    }

    // Ensure every compat name actually in use is offered in the picker / resolvable.
    let mut tools = compat_tools;
    for g in &games {
        if g.compat != "default" && !tools.iter().any(|t| t.id == g.compat) {
            tools.push(CompatToolDto {
                id: g.compat.clone(),
                name: g.compat.clone(),
                note: "In use (tool not found on disk)".into(),
            });
        }
    }

    games.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(LibraryDto {
        games,
        compat_tools: tools,
        steam_running: steam_running(),
        steam_root: root.to_string_lossy().to_string(),
        steam_user_id: user_id,
        library_path: library_path.to_string_lossy().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "depends on a real local Steam install; run with --ignored --nocapture"]
    fn dump_scan() {
        let lib = scan().expect("scan should succeed on this machine");
        eprintln!(
            "root={} user={} running={} library={}",
            lib.steam_root, lib.steam_user_id, lib.steam_running, lib.library_path
        );
        eprintln!(
            "-> {} games, {} compat tools",
            lib.games.len(),
            lib.compat_tools.len()
        );
        for t in &lib.compat_tools {
            eprintln!("  TOOL  {:<28} {}", t.id, t.name);
        }
        let installed = lib.games.iter().filter(|g| g.status == "installed").count();
        let owned = lib.games.len() - installed;
        eprintln!("-> {installed} installed, {owned} owned-only");
        for g in lib.games.iter().take(60) {
            eprintln!(
                "  {:<10} [{:<9}] {:<34} compat={:<22} launch={:?}",
                g.appid, g.status, g.name, g.compat, g.launch
            );
        }
    }
}
