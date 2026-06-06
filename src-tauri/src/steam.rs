// steam.rs - read-only Steam library scanner.
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
// is irrelevant - we never render it back. Writes (next milestone) will be surgical.

use crate::vdfedit;
use keyvalues_parser::{parse, Value, Vdf};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread::sleep;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const APPS_PATH: &[&str] = &["Software", "Valve", "Steam", "apps"];
const COMPAT_PATH: &[&str] = &["Software", "Valve", "Steam", "CompatToolMapping"];

// ----------------------------------------------------------------------------
// DTOs returned to the frontend (shapes match the React mock in src/data.jsx)
// ----------------------------------------------------------------------------

#[derive(Serialize, Debug)]
pub struct GameDto {
    pub id: String,     // "app<appid>"
    pub appid: String,
    pub name: String,
    pub status: String, // "installed" | "owned"
    pub compat: String, // internal compat-tool name, or "default"
    pub launch: String, // LaunchOptions string ("" if none)
}

#[derive(Serialize, Debug)]
pub struct CompatToolDto {
    pub id: String,   // internal name used in CompatToolMapping
    pub name: String, // display name
    pub note: String,
}

#[derive(Serialize, Debug)]
pub struct LibraryDto {
    pub games: Vec<GameDto>,
    pub compat_tools: Vec<CompatToolDto>,
    pub steam_running: bool,
    pub steam_root: String,
    pub steam_user_id: String,
    pub library_path: String,
}

// ----------------------------------------------------------------------------
// VDF navigation helpers (case-insensitive - Steam's casing is inconsistent)
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

fn root_is_valid(p: &Path) -> bool {
    p.join("config/config.vdf").exists() || p.join("steamapps").is_dir()
}

fn candidate_roots() -> Vec<PathBuf> {
    vec![
        home().join(".steam/steam"),
        home().join(".local/share/Steam"),
        home().join(".steam/root"),
    ]
}

/// The Steam root we read userdata/config from. Honors the settings override
/// (if valid), otherwise auto-detects. ~/.steam/steam and ~/.local/share/Steam
/// are usually the same tree (symlinked).
fn steam_root() -> Option<PathBuf> {
    let override_root = crate::settings::current().steam_root;
    let override_root = override_root.trim();
    if !override_root.is_empty() {
        let p = PathBuf::from(override_root);
        if root_is_valid(&p) {
            return Some(p);
        }
    }
    candidate_roots().into_iter().find(|p| root_is_valid(p))
}

#[derive(Serialize, Debug)]
pub struct RootCandidate {
    pub path: String,
    pub valid: bool,
}

/// Steam roots found on disk, for the settings UI to offer as choices.
pub fn discover_roots() -> Vec<RootCandidate> {
    let mut out = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for p in candidate_roots() {
        if !p.exists() {
            continue;
        }
        let path = p.to_string_lossy().to_string();
        if seen.contains(&path) {
            continue;
        }
        seen.push(path.clone());
        out.push(RootCandidate { valid: root_is_valid(&p), path });
    }
    out
}

/// userdata/<id>/config/localconfig.vdf - pick the id dir that actually has one.
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
    let Ok(text) = fs::read_to_string(&lf) else { return paths };
    let Ok(parsed) = parse(&text) else { return paths };
    let vdf = Vdf::from(parsed);
    let Some(obj) = vdf.value.get_obj() else { return paths };
    for (_idx, vals) in obj.iter() {
        let path = vals
            .first()
            .and_then(|folder| child(folder, "path"))
            .and_then(|v| v.get_str());
        let Some(path) = path else { continue };
        let pb = PathBuf::from(path);
        if !paths.contains(&pb) {
            paths.push(pb);
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
    let map = nav(&vdf.value, &["Software", "Valve", "Steam", "CompatToolMapping"]).and_then(|m| m.get_obj());
    let Some(obj) = map else { return out };
    for (appid, vals) in obj.iter() {
        let name = vals
            .first()
            .and_then(|entry| child(entry, "name"))
            .and_then(|v| v.get_str());
        let Some(name) = name else { continue };
        if !name.is_empty() {
            out.insert(appid.to_string(), name.to_string());
        }
    }
    out
}

/// Custom compat tools from every compatibilitytools.d directory.
fn custom_compat_tools(root: &Path) -> Vec<CompatToolDto> {
    let tool_dirs = [
        root.join("compatibilitytools.d"),
        home().join(".local/share/Steam/compatibilitytools.d"),
        home().join(".steam/root/compatibilitytools.d"),
        PathBuf::from("/usr/share/steam/compatibilitytools.d"),
    ];
    let mut out = Vec::new();
    for dir in tool_dirs {
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        for entry in rd.flatten() {
            let Ok(text) = fs::read_to_string(entry.path().join("compatibilitytool.vdf")) else { continue };
            let Ok(p) = parse(&text) else { continue };
            let vdf = Vdf::from(p);
            let Some(obj) = child(&vdf.value, "compat_tools").and_then(|ct| ct.get_obj()) else { continue };
            for (internal, vals) in obj.iter() {
                let id = internal.to_string();
                let display = vals
                    .first()
                    .and_then(|v| child(v, "display_name"))
                    .and_then(|v| v.get_str())
                    .unwrap_or(&id)
                    .to_string();
                out.push(CompatToolDto { id, name: display, note: "Custom compatibility tool".into() });
            }
        }
    }
    out
}

/// Official Proton builds found in any library's steamapps/common.
fn official_proton_tools(libs: &[PathBuf]) -> Vec<CompatToolDto> {
    let mut out = Vec::new();
    for lib in libs {
        let Ok(rd) = fs::read_dir(lib.join("steamapps/common")) else { continue };
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("Proton") || !entry.path().is_dir() {
                continue;
            }
            out.push(CompatToolDto {
                id: official_proton_internal_name(&name),
                name,
                note: "Official Proton build".into(),
            });
        }
    }
    out
}

/// Discover compat tools the user could pick: Default + custom (compatibilitytools.d)
/// + official Proton builds found in steamapps/common. Deduplicated by internal id.
fn discover_compat_tools(root: &Path, libs: &[PathBuf]) -> Vec<CompatToolDto> {
    let mut tools = vec![CompatToolDto {
        id: "default".into(),
        name: "Default".into(),
        note: "No forced tool - Steam decides".into(),
    }];
    let mut seen: Vec<String> = vec!["default".into()];
    for tool in custom_compat_tools(root).into_iter().chain(official_proton_tools(libs)) {
        if seen.iter().any(|s| s == &tool.id) {
            continue;
        }
        seen.push(tool.id.clone());
        tools.push(tool);
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

// Test seam: lets tests force the Steam-running state deterministically (the real
// check reads /proc, which differs between dev machines and CI). Compiled out of
// release builds. Thread-local so parallel tests don't interfere.
#[cfg(test)]
thread_local! {
    static TEST_RUNNING: std::cell::Cell<Option<bool>> = const { std::cell::Cell::new(None) };
}
#[cfg(test)]
pub(crate) fn set_test_running(v: Option<bool>) {
    TEST_RUNNING.with(|c| c.set(v));
}

/// Build a minimal fake Steam tree under `home` (test-only, shared with lib tests).
#[cfg(test)]
pub(crate) fn build_test_tree(home: &Path) -> PathBuf {
    let root = home.join(".steam/steam");
    fs::create_dir_all(root.join("config")).unwrap();
    fs::create_dir_all(root.join("steamapps/common/Proton 9.0 (Beta)")).unwrap();
    fs::create_dir_all(root.join("compatibilitytools.d/mytool")).unwrap();
    fs::create_dir_all(root.join("userdata/123/config")).unwrap();

    fs::write(
        root.join("config/config.vdf"),
        "\"InstallConfigStore\"\n{\n\t\"Software\"\n\t{\n\t\t\"Valve\"\n\t\t{\n\t\t\t\"Steam\"\n\t\t\t{\n\t\t\t\t\"CompatToolMapping\"\n\t\t\t\t{\n\t\t\t\t\t\"111\"\n\t\t\t\t\t{\n\t\t\t\t\t\t\"name\"\t\t\"proton_experimental\"\n\t\t\t\t\t\t\"config\"\t\t\"\"\n\t\t\t\t\t\t\"priority\"\t\t\"250\"\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n}\n",
    )
    .unwrap();
    fs::write(
        root.join("steamapps/libraryfolders.vdf"),
        format!(
            "\"libraryfolders\"\n{{\n\t\"0\"\n\t{{\n\t\t\"path\"\t\t\"{}\"\n\t}}\n}}\n",
            root.to_string_lossy()
        ),
    )
    .unwrap();
    fs::write(
        root.join("steamapps/appmanifest_111.acf"),
        "\"AppState\"\n{\n\t\"appid\"\t\t\"111\"\n\t\"name\"\t\t\"Game One\"\n}\n",
    )
    .unwrap();
    fs::write(
        root.join("compatibilitytools.d/mytool/compatibilitytool.vdf"),
        "\"compatibilitytools\"\n{\n\t\"compat_tools\"\n\t{\n\t\t\"my_custom_proton\"\n\t\t{\n\t\t\t\"display_name\"\t\t\"My Custom Proton\"\n\t\t}\n\t}\n}\n",
    )
    .unwrap();
    fs::write(
        root.join("userdata/123/config/localconfig.vdf"),
        "\"UserLocalConfigStore\"\n{\n\t\"Software\"\n\t{\n\t\t\"Valve\"\n\t\t{\n\t\t\t\"Steam\"\n\t\t\t{\n\t\t\t\t\"apps\"\n\t\t\t\t{\n\t\t\t\t\t\"111\"\n\t\t\t\t\t{\n\t\t\t\t\t\t\"LaunchOptions\"\t\t\"mangohud %command%\"\n\t\t\t\t\t}\n\t\t\t\t\t\"222\"\n\t\t\t\t\t{\n\t\t\t\t\t\t\"LaunchOptions\"\t\t\"gamescope %command%\"\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n}\n",
    )
    .unwrap();
    root
}

fn steam_running() -> bool {
    #[cfg(test)]
    if let Some(v) = TEST_RUNNING.with(|c| c.get()) {
        return v;
    }
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
    // Steam runtimes, redistributables, Proton tools - not real games.
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

/// Build one game row. Returns None for entries we skip (appid 0, non-Steam
/// shortcuts >= 2^31, or runtime/redistributable "noise" apps).
fn build_game(
    appid: &str,
    installed: &BTreeMap<String, Installed>,
    launch: &BTreeMap<String, String>,
    compat: &BTreeMap<String, String>,
    resolved: &HashMap<u32, String>,
) -> Option<GameDto> {
    match appid.parse::<u64>() {
        Ok(n) if n == 0 || n >= 2_147_483_648 => return None,
        Err(_) => return None,
        _ => {}
    }
    let inst = installed.get(appid);
    let name = match inst {
        Some(i) => i.name.clone(),
        None => appid
            .parse::<u32>()
            .ok()
            .and_then(|n| resolved.get(&n).cloned())
            .unwrap_or_else(|| format!("App {appid}")),
    };
    if is_noise_app(appid, &name) {
        return None;
    }
    Some(GameDto {
        id: format!("app{appid}"),
        appid: appid.to_string(),
        name,
        status: if inst.is_some() { "installed" } else { "owned" }.into(),
        compat: compat.get(appid).cloned().unwrap_or_else(|| "default".into()),
        launch: launch.get(appid).cloned().unwrap_or_default(),
    })
}

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

    // Resolve names for owned/uninstalled games (no appmanifest) from appinfo.vdf.
    let uninstalled: HashSet<u32> = appids
        .iter()
        .filter(|a| !installed.contains_key(*a))
        .filter_map(|a| a.parse::<u32>().ok())
        .filter(|n| *n != 0 && *n < 2_147_483_648)
        .collect();
    let resolved = crate::appinfo::resolve_names(&uninstalled);

    let mut games: Vec<GameDto> = appids
        .iter()
        .filter_map(|appid| build_game(appid, &installed, &launch, &compat, &resolved))
        .collect();

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

// ----------------------------------------------------------------------------
// Write path (guarded): Steam-closed check + verify + backup + atomic rename
// ----------------------------------------------------------------------------

/// Read a string value at `path` from VDF text (reordering is irrelevant for reads).
pub(crate) fn read_path_string(text: &str, path: &[&str]) -> Option<String> {
    let vdf = Vdf::from(parse(text).ok()?);
    nav(&vdf.value, path).and_then(|v| v.get_str()).map(|s| s.to_string())
}

#[cfg(test)]
pub(crate) fn test_read<'a>(v: &'a Value<'a>, path: &[&str]) -> Option<String> {
    nav(v, path).and_then(|x| x.get_str()).map(|s| s.to_string())
}

fn timestamped_backup(src: &Path) -> Result<PathBuf, String> {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let dir = home().join(".local/share/manifold/backups");
    fs::create_dir_all(&dir).map_err(|e| format!("create backup dir: {e}"))?;
    let stem = src.file_name().and_then(|s| s.to_str()).unwrap_or("file.vdf");
    let dst = dir.join(format!("{stem}.{ts}.bak"));
    fs::copy(src, &dst).map_err(|e| format!("write backup: {e}"))?;
    Ok(dst)
}

fn atomic_write(path: &Path, contents: &str) -> Result<(), String> {
    let dir = path.parent().ok_or("target has no parent directory")?;
    let tmp = dir.join(format!(".manifold.tmp.{}", std::process::id()));
    fs::write(&tmp, contents).map_err(|e| format!("write temp file: {e}"))?;
    if let Ok(meta) = fs::metadata(path) {
        let _ = fs::set_permissions(&tmp, meta.permissions());
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("atomic rename: {e}")
    })?;
    Ok(())
}

fn guard_steam_closed() -> Result<(), String> {
    if steam_running() {
        return Err(
            "Steam is running - close it before writing, or changes will be clobbered when Steam exits."
                .into(),
        );
    }
    Ok(())
}

/// Apply LaunchOptions changes (appid -> value) to localconfig.vdf.
pub fn write_launch_options(changes: Vec<(String, String)>) -> Result<LibraryDto, String> {
    if changes.is_empty() {
        return scan();
    }
    guard_steam_closed()?;
    let root = steam_root().ok_or("Steam installation not found")?;
    let (_user, localconfig) = find_localconfig(&root).ok_or("localconfig.vdf not found")?;
    let original = fs::read_to_string(&localconfig).map_err(|e| format!("read localconfig.vdf: {e}"))?;

    let mut text = original.clone();
    for (appid, value) in &changes {
        text = vdfedit::upsert_app_fields(&text, APPS_PATH, appid, &[("LaunchOptions", value)])?;
    }

    // Verify: still valid VDF, and every target now reads back exactly as intended.
    if parse(&text).is_err() {
        return Err("internal: edited localconfig.vdf failed to re-parse - write aborted".into());
    }
    for (appid, value) in &changes {
        let path = ["Software", "Valve", "Steam", "apps", appid.as_str(), "LaunchOptions"];
        if read_path_string(&text, &path).as_deref() != Some(value.as_str()) {
            return Err(format!("verification failed for appid {appid} - write aborted"));
        }
    }

    if text != original {
        timestamped_backup(&localconfig)?;
        atomic_write(&localconfig, &text)?;
    }
    scan()
}

/// Apply compat-tool changes (appid -> internal tool name; "default" removes the mapping)
/// to config.vdf.
pub fn write_compat_tool(changes: Vec<(String, String)>) -> Result<LibraryDto, String> {
    if changes.is_empty() {
        return scan();
    }
    guard_steam_closed()?;
    let root = steam_root().ok_or("Steam installation not found")?;
    let config_vdf = root.join("config/config.vdf");
    let original = fs::read_to_string(&config_vdf).map_err(|e| format!("read config.vdf: {e}"))?;

    let mut text = original.clone();
    for (appid, tool) in &changes {
        if tool == "default" {
            text = vdfedit::remove_app_block(&text, COMPAT_PATH, appid)?;
        } else {
            text = vdfedit::upsert_app_fields(
                &text,
                COMPAT_PATH,
                appid,
                &[("name", tool.as_str()), ("config", ""), ("priority", "250")],
            )?;
        }
    }

    if parse(&text).is_err() {
        return Err("internal: edited config.vdf failed to re-parse - write aborted".into());
    }
    for (appid, tool) in &changes {
        let path = ["Software", "Valve", "Steam", "CompatToolMapping", appid.as_str(), "name"];
        let got = read_path_string(&text, &path);
        if tool == "default" {
            if got.is_some() {
                return Err(format!("verification failed (compat not cleared) for appid {appid}"));
            }
        } else if got.as_deref() != Some(tool.as_str()) {
            return Err(format!("verification failed (compat) for appid {appid}"));
        }
    }

    if text != original {
        timestamped_backup(&config_vdf)?;
        atomic_write(&config_vdf, &text)?;
    }
    scan()
}

// ----------------------------------------------------------------------------
// Steam process control (so the user can close/reopen Steam to make writes stick)
// ----------------------------------------------------------------------------

/// Ask Steam to shut down cleanly (`steam -shutdown`) and wait for the client to exit.
/// This also closes any running games. Returns a fresh scan once Steam is gone.
pub fn close_steam() -> Result<LibraryDto, String> {
    if !steam_running() {
        return scan();
    }
    Command::new("steam")
        .arg("-shutdown")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("failed to run `steam -shutdown`: {e}"))?;
    // poll up to ~30s for the client process to disappear
    for _ in 0..60 {
        if !steam_running() {
            return scan();
        }
        sleep(Duration::from_millis(500));
    }
    Err("Steam did not shut down within 30s".into())
}

/// Launch Steam (detached) and wait briefly for it to come up. Uses `-silent`
/// (start minimized to tray) when enabled in settings.
pub fn start_steam() -> Result<LibraryDto, String> {
    if steam_running() {
        return scan();
    }
    let mut cmd = Command::new("steam");
    if crate::settings::current().silent_start {
        cmd.arg("-silent");
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to launch Steam: {e}"))?;
    for _ in 0..40 {
        if steam_running() {
            break;
        }
        sleep(Duration::from_millis(500));
    }
    scan()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_contents() {
        let dir = std::env::temp_dir().join(format!("manifold_test_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let f = dir.join("x.vdf");
        fs::write(&f, "old contents").unwrap();
        atomic_write(&f, "new contents").unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "new contents");
        // no stray temp file left behind
        let leftover = fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).any(|e| {
            e.file_name().to_string_lossy().starts_with(".manifold.tmp")
        });
        assert!(!leftover, "temp file should be renamed away");
        fs::remove_dir_all(&dir).ok();
    }

    // ---- pure parser / helper tests (no env, safe in parallel) ----------------

    #[test]
    fn official_proton_names_map_sensibly() {
        assert_eq!(official_proton_internal_name("Proton - Experimental"), "proton_experimental");
        assert_eq!(official_proton_internal_name("Proton 9.0 (Beta)"), "proton_9");
        assert_eq!(official_proton_internal_name("Proton 8.0"), "proton_8");
        // unrecognized shapes are slugified
        assert_eq!(official_proton_internal_name("GE-Proton9-20"), "ge_proton9_20");
    }

    #[test]
    fn noise_apps_are_filtered() {
        assert!(is_noise_app("228980", "Steamworks Common Redistributables"));
        assert!(is_noise_app("1", "Proton 9.0"));
        assert!(is_noise_app("2", "Steam Linux Runtime 3.0"));
        assert!(is_noise_app("3", "SteamVR"));
        assert!(!is_noise_app("1245620", "Elden Ring"));
    }

    #[test]
    fn root_validity_and_read_path() {
        let dir = std::env::temp_dir().join(format!("manifold_rv_{}", unique()));
        fs::create_dir_all(dir.join("steamapps")).unwrap();
        assert!(root_is_valid(&dir));
        assert!(!root_is_valid(&dir.join("nope")));
        // read_path_string navigates from the root object's value (top key stripped)
        let cfg = "\"a\"\n{\n  \"b\"\n  {\n    \"c\"  \"hi\"\n  }\n}\n";
        assert_eq!(read_path_string(cfg, &["b", "c"]).as_deref(), Some("hi"));
        assert_eq!(read_path_string(cfg, &["missing"]), None);
        assert_eq!(read_path_string("not valid vdf {{{", &["a"]), None);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn parses_installed_launch_and_compat_from_fixtures() {
        let dir = std::env::temp_dir().join(format!("manifold_fx_{}", unique()));
        let root = build_test_tree(&dir);
        let libs = library_paths(&root);
        assert!(libs.contains(&root));

        let installed = scan_installed(&libs);
        assert_eq!(installed.get("111").map(|i| i.name.as_str()), Some("Game One"));

        let (uid, lc) = find_localconfig(&root).unwrap();
        assert_eq!(uid, "123");
        let launch = scan_launch_options(&lc);
        assert_eq!(launch.get("111").map(|s| s.as_str()), Some("mangohud %command%"));
        assert_eq!(launch.get("222").map(|s| s.as_str()), Some("gamescope %command%"));

        let compat = scan_compat_mapping(&root.join("config/config.vdf"));
        assert_eq!(compat.get("111").map(|s| s.as_str()), Some("proton_experimental"));

        let tools = discover_compat_tools(&root, &libs);
        let ids: Vec<&str> = tools.iter().map(|t| t.id.as_str()).collect();
        assert!(ids.contains(&"default"));
        assert!(ids.contains(&"my_custom_proton"));
        assert!(ids.contains(&"proton_9"));
        fs::remove_dir_all(&dir).ok();
    }

    // ---- env-isolated integration tests (serialized) --------------------------

    #[test]
    fn scan_reads_a_fake_install() {
        let env = TestEnv::new();
        build_test_tree(env.home());
        set_test_running(Some(false));
        let lib = scan().expect("scan");
        assert!(!lib.steam_running);
        let one = lib.games.iter().find(|g| g.appid == "111").unwrap();
        assert_eq!(one.name, "Game One");
        assert_eq!(one.status, "installed");
        assert_eq!(one.compat, "proton_experimental");
        assert_eq!(one.launch, "mangohud %command%");
        // 222 has launch options but no manifest -> owned-only, name unresolved
        let two = lib.games.iter().find(|g| g.appid == "222").unwrap();
        assert_eq!(two.status, "owned");
        assert!(lib.compat_tools.iter().any(|t| t.id == "my_custom_proton"));
    }

    #[test]
    fn write_launch_options_edits_and_backs_up() {
        let env = TestEnv::new();
        let root = build_test_tree(env.home());
        set_test_running(Some(false));
        let lc = root.join("userdata/123/config/localconfig.vdf");

        // empty changes is a no-op that still returns a scan
        assert!(write_launch_options(vec![]).is_ok());

        write_launch_options(vec![("111".into(), "MANIFOLD_TEST=1 game %command%".into())]).unwrap();
        let after = fs::read_to_string(&lc).unwrap();
        assert!(after.contains("MANIFOLD_TEST=1 game %command%"));
        // a timestamped backup was written under the (temp) home
        let bdir = env.home().join(".local/share/manifold/backups");
        let n = fs::read_dir(&bdir).map(|r| r.count()).unwrap_or(0);
        assert!(n >= 1, "expected a backup file");
    }

    #[test]
    fn write_compat_tool_sets_and_clears() {
        let env = TestEnv::new();
        let root = build_test_tree(env.home());
        set_test_running(Some(false));
        let cfg = root.join("config/config.vdf");

        write_compat_tool(vec![
            ("222".into(), "proton_9".into()),
            ("111".into(), "default".into()),
        ])
        .unwrap();
        let text = fs::read_to_string(&cfg).unwrap();
        assert_eq!(
            read_path_string(&text, &["Software", "Valve", "Steam", "CompatToolMapping", "222", "name"]).as_deref(),
            Some("proton_9"),
        );
        // 111 mapping was removed
        assert_eq!(
            read_path_string(&text, &["Software", "Valve", "Steam", "CompatToolMapping", "111", "name"]),
            None,
        );
    }

    #[test]
    fn writes_are_refused_while_steam_runs() {
        let env = TestEnv::new();
        let root = build_test_tree(env.home());
        let lc = root.join("userdata/123/config/localconfig.vdf");
        let before = fs::read_to_string(&lc).unwrap();
        set_test_running(Some(true));
        let res = write_launch_options(vec![("111".into(), "X=1 game %command%".into())]);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("Steam is running"));
        assert_eq!(fs::read_to_string(&lc).unwrap(), before, "file must be untouched");
    }

    #[test]
    fn discover_roots_finds_the_fake_install() {
        let env = TestEnv::new();
        build_test_tree(env.home());
        let roots = discover_roots();
        assert!(roots.iter().any(|r| r.path.ends_with(".steam/steam") && r.valid));
    }

    #[test]
    fn operations_error_without_an_install() {
        let _env = TestEnv::new(); // empty temp HOME, no Steam tree
        set_test_running(Some(false));
        assert!(scan().is_err());
        assert!(write_launch_options(vec![("1".into(), "x %command%".into())]).is_err());
        assert!(write_compat_tool(vec![("1".into(), "proton_9".into())]).is_err());
        assert!(discover_roots().is_empty());
    }

    #[test]
    fn steam_process_control_early_returns() {
        let env = TestEnv::new();
        build_test_tree(env.home());
        // not running -> close is a no-op scan (no process spawned)
        set_test_running(Some(false));
        assert!(close_steam().is_ok());
        // running -> start is a no-op scan (no process spawned)
        set_test_running(Some(true));
        assert!(start_steam().is_ok());
    }

    // ---- test infrastructure --------------------------------------------------

    use std::sync::atomic::{AtomicU32, Ordering};

    use crate::TEST_ENV_LOCK as ENV_LOCK;
    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn unique() -> String {
        format!("{}_{}", std::process::id(), COUNTER.fetch_add(1, Ordering::SeqCst))
    }

    /// Serializes env mutation across tests and points HOME / XDG_CONFIG_HOME at a temp dir,
    /// so scan/write paths and backups stay fully isolated. Restores on drop.
    struct TestEnv {
        _guard: std::sync::MutexGuard<'static, ()>,
        home_prev: Option<String>,
        xdg_prev: Option<String>,
        dir: PathBuf,
    }
    impl TestEnv {
        fn new() -> Self {
            let guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let dir = std::env::temp_dir().join(format!("manifold_env_{}", unique()));
            fs::create_dir_all(&dir).unwrap();
            let home_prev = std::env::var("HOME").ok();
            let xdg_prev = std::env::var("XDG_CONFIG_HOME").ok();
            std::env::set_var("HOME", &dir);
            std::env::set_var("XDG_CONFIG_HOME", dir.join(".config"));
            TestEnv { _guard: guard, home_prev, xdg_prev, dir }
        }
        fn home(&self) -> &Path {
            &self.dir
        }
    }
    impl Drop for TestEnv {
        fn drop(&mut self) {
            set_test_running(None);
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


    /// With Steam running, a write must be refused AND leave the file byte-for-byte intact.
    #[test]
    #[ignore = "checks the live Steam-running guard; run with --ignored --nocapture"]
    fn guard_blocks_live_write() {
        if !steam_running() {
            eprintln!("Steam not running - guard test skipped (close-state path)");
            return;
        }
        let root = steam_root().unwrap();
        let (_u, lc) = find_localconfig(&root).unwrap();
        let before = fs::read_to_string(&lc).unwrap();
        let appid = scan_launch_options(&lc).keys().next().cloned().unwrap();
        let res = write_launch_options(vec![(appid, "MANIFOLD_GUARD_TEST=1 game %command%".into())]);
        assert!(res.is_err(), "write must be refused while Steam runs");
        let err = res.unwrap_err();
        eprintln!("guard returned: {err}");
        assert!(err.contains("Steam is running"));
        let after = fs::read_to_string(&lc).unwrap();
        assert_eq!(before, after, "localconfig.vdf must be untouched when the guard blocks");
    }

    /// Apply a launch-options edit to the REAL localconfig.vdf in memory (writes nothing)
    /// and assert the change is correct and the diff is minimal (no reordering/loss).
    #[test]
    #[ignore = "reads the real localconfig.vdf; run with --ignored --nocapture"]
    fn real_file_minimal_diff() {
        let root = steam_root().expect("steam root");
        let (_u, lc) = find_localconfig(&root).expect("localconfig");
        let original = fs::read_to_string(&lc).expect("read");
        let launch = scan_launch_options(&lc);
        let appid = launch
            .keys()
            .next()
            .cloned()
            .expect("at least one game with launch options");
        let new_val = "MANIFOLD_SELFTEST=1 game %command%";
        let edited = vdfedit::upsert_app_fields(&original, APPS_PATH, &appid, &[("LaunchOptions", new_val)])
            .expect("edit");

        assert!(parse(&edited).is_ok(), "edited file must still parse");
        let path = ["Software", "Valve", "Steam", "apps", appid.as_str(), "LaunchOptions"];
        assert_eq!(read_path_string(&edited, &path).as_deref(), Some(new_val));

        let diff_lines = original
            .lines()
            .zip(edited.lines())
            .filter(|(a, b)| a != b)
            .count();
        let len_delta = (edited.len() as isize - original.len() as isize).abs();
        eprintln!(
            "appid={appid}  changed_lines~={diff_lines}  len_delta={len_delta}  (orig {} lines, edit {} lines)",
            original.lines().count(),
            edited.lines().count()
        );
        // Replacing one value should touch exactly one line and not reorder anything.
        assert_eq!(original.lines().count(), edited.lines().count(), "line count must be stable");
        assert!(diff_lines <= 1, "only the edited line should differ, got {diff_lines}");
    }

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
