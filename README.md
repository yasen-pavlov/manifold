# Manifold

A small Tauri + React desktop app to **bulk-manage Steam games' launch options and
compatibility (Proton) version** on Linux — view your whole library in one dense table,
build reusable launch-option presets, and apply them (or set the compat tool) across many
games at once.

> Steam owns `localconfig.vdf` / `config.vdf` and rewrites them on exit, so Manifold only
> writes while Steam is closed, always backs up first, and edits surgically.

## Stack

- **Tauri v2** (Rust backend) + **React 19** + **Vite**
- VDF parsing via `keyvalues-parser`

## Develop

```sh
npm install
npm run tauri dev      # native window + hot reload
npm run tauri build    # release bundle
```

## Status

- **Milestone 1 (done):** read-only library scan — parses `localconfig.vdf` (launch
  options), `config.vdf` (compat-tool mapping), appmanifests and library folders; detects
  whether Steam is running.
- **Milestone 2 (done):** guarded writes for launch options and compat tool — a surgical,
  lossless VDF text editor (`vdfedit.rs`, no key reordering) behind a Steam-closed guard,
  re-parse verification, timestamped backup (`~/.local/share/manifold/backups/`) and atomic
  rename. Frontend applies changes via the backend and refreshes from disk; Undo re-writes
  the previous per-game values.
- **Milestone 3 (done):** preset/option persistence — `store.rs` loads/saves
  `~/.config/manifold/presets.json` (seeded with defaults on first run, atomic writes);
  the frontend loads on startup and persists on every preset/option edit.
- **Names for owned/uninstalled games (done):** `appinfo.rs` parses Steam's local binary
  `appcache/appinfo.vdf` (v27/28/29, string-table aware) to resolve appid → name, so games
  without an `appmanifest` show their real name instead of `App <id>` (offline, no network).
- **Steam process control (done):** `close_steam` (`steam -shutdown` + wait) / `start_steam`
  commands. The banner/footer expose Close/Start, and applying changes while Steam is running
  prompts to close → apply → (optionally) reopen Steam.
- **Next:** the structured option builder (categorized Proton/MangoHud/DXVK menu with
  descriptions), then stretch items (ProtonDB links, preset sharing).
