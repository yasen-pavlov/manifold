// app.tsx - Manifold main: state, routing, window chrome, keyboard
import { useState as aS, useEffect as aE, useMemo as aM, useCallback as aC } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "./icons";
import { GAMES, compatName, setCompatTools } from "./data";
import { parseLine } from "./catalogue-data";
import { BuilderSurface, PresetsList } from "./builder";
import { Toolbar, GamesTable, BulkBar, Footer } from "./table";
import { CompatPicker, RowMenu, SteamBanner, SteamConfirm, SettingsSheet, WindowControls, Toasts, EmptyState } from "./surfaces";
import { BackupsView, CommandPalette } from "./presets";
import type { RowAction, SteamChoice } from "./surfaces";
import type {
  AnchorRect, Backup, BuilderContext, Change, Command, Counts, DiscoveredRoot, Filters,
  Game, LibraryDto, MixedLine, Pill, Preset, PresetDraft, Settings, SortState, Toast,
  UndoAction, WindowControlsPref,
} from "./types";

type OSKind = 'mac' | 'windows' | 'linux';
type ControlsSide = 'left' | 'right' | 'none';

function detectOS(): OSKind {
  const p = typeof navigator === 'undefined' ? '' : (navigator.platform || '');
  if (/mac/i.test(p)) return 'mac';
  if (/win/i.test(p)) return 'windows';
  return 'linux';
}
const OS = detectOS();
function resolveControlsSide(pref: WindowControlsPref): ControlsSide {
  if (pref === 'hidden') return 'none';
  if (pref === 'left' || pref === 'right') return pref;
  return OS === 'mac' ? 'left' : 'right'; // auto
}
const clampScale = (v: number): number => Math.min(2, Math.max(0.6, Math.round((Number(v) || 1) * 100) / 100));
// `target` is the desired visual scale vs native (e.g. 1.2 = 120%). We apply it with CSS
// `zoom` (a layout zoom: re-lays-out and re-rasterizes text/SVG, so it stays crisp instead
// of a blurry bitmap upscale). Divide by devicePixelRatio so that if WebKitGTK already
// applied device scaling we don't double up (and more of the scale comes from crisp device
// pixels when available).
function applyZoom(target: number): void {
  try {
    const dpr = globalThis.devicePixelRatio || 1;
    document.documentElement.style.zoom = String(clampScale(target) / dpr);
  } catch { /* no-op */ }
}

let _tid = 0;

// Best-effort debug log for expected fallbacks (e.g. running outside Tauri); silent in prod.
const logDev = (...args: unknown[]): void => { if (import.meta.env?.DEV) console.debug(...args); };

// A toast may carry these write-specific extras when raised by a launch/compat write.
interface ToastInput {
  kind?: 'ok' | 'err';
  title: string;
  sub?: string;
  undo?: UndoAction;
  sticky?: boolean;
}
type WriteMeta = { title?: string; sub?: string; undo?: UndoAction };

function App() {
  const [games, setGames] = aS<Game[]>([]);
  const [presets, setPresets] = aS<Preset[]>([]);
  const [, setLoading] = aS(true);
  const [, setScanError] = aS<string | null>(null);

  const [selected, setSelected] = aS<Set<string>>(() => new Set());
  const [search, setSearch] = aS('');
  const [filters, setFilters] = aS<Filters>({ installed: false, owned: false, custom: false, forced: false });
  const [sort, setSort] = aS<SortState>({ col: 'name', dir: 'asc' });
  const [tab, setTab] = aS('library');

  const [steamRunning, setSteamRunning] = aS(false);
  const [bannerDismissed, setBannerDismissed] = aS(false);
  const [empty, setEmpty] = aS(false);

  const [builder, setBuilder] = aS<BuilderContext | null>(null);             // open builder context (apply or preset), else null
  const [compatPop, setCompatPop] = aS<{ anchor: AnchorRect; targets: Game[] } | null>(null); // compat popover: anchor rect + target games, else null
  const [rowMenu, setRowMenu] = aS<{ anchor: AnchorRect; game: Game } | null>(null);  // row menu: anchor rect + the row game, else null
  const [cmdk, setCmdk] = aS(false);
  const [toasts, setToasts] = aS<Toast[]>([]);
  const [steamPrompt, setSteamPrompt] = aS<{ count: number; run: (mode: SteamChoice) => void } | null>(null); // pending close-Steam confirm
  const [steamBusy, setSteamBusy] = aS(false);
  const [settings, setSettings] = aS<Settings>({ steam_root: '', silent_start: true, window_controls: 'auto', ui_scale: 0 });
  const [settingsOpen, setSettingsOpen] = aS(false);
  const [discoveredRoots, setDiscoveredRoots] = aS<DiscoveredRoot[]>([]);
  const [steamRoot, setSteamRoot] = aS('');
  const [systemScale, setSystemScale] = aS(1);
  // Effective scale target: explicit override (ui_scale > 0), else follow the desktop.
  const effectiveScale = (s: Settings): number => (s && s.ui_scale > 0 ? s.ui_scale : systemScale);

  /* ---------- toasts ---------- */
  const removeToast = aC((id: number) => setToasts((ts) => ts.filter((x) => x.id !== id)), []);
  const toast = aC((t: ToastInput) => {
    const id = ++_tid;
    setToasts((ts) => [...ts, { ...t, id }]);
    setTimeout(() => removeToast(id), t.sticky ? 99999 : 4800);
  }, [removeToast]);
  const dismissToast = removeToast;

  /* ---------- derived ---------- */
  const counts: Counts = aM(() => ({
    installed: games.filter((g) => g.status === 'installed').length,
    owned: games.filter((g) => g.status === 'owned').length,
    custom: games.filter((g) => g.launch.trim()).length,
    forced: games.filter((g) => g.compat !== 'default').length,
  }), [games]);

  const rows = aM(() => {
    let r = games;
    const q = search.trim().toLowerCase();
    if (q) r = r.filter((g) => g.name.toLowerCase().includes(q) || g.appid.includes(q) || g.launch.toLowerCase().includes(q));
    if (filters.installed) r = r.filter((g) => g.status === 'installed');
    if (filters.owned) r = r.filter((g) => g.status === 'owned');
    if (filters.custom) r = r.filter((g) => g.launch.trim());
    if (filters.forced) r = r.filter((g) => g.compat !== 'default');
    const dir = sort.dir === 'asc' ? 1 : -1;
    const cmps: Record<string, (a: Game, b: Game) => number> = {
      name: (a, b) => a.name.localeCompare(b.name),
      appid: (a, b) => Number(a.appid) - Number(b.appid),
      status: (a, b) => {
        if (a.status === b.status) return a.name.localeCompare(b.name);
        return a.status === 'installed' ? -1 : 1;
      },
      compat: (a, b) => compatName(a.compat).localeCompare(compatName(b.compat)),
    };
    const cmp = cmps[sort.col] || (() => 0);
    return [...r].sort((a, b) => cmp(a, b) * dir);
  }, [games, search, filters, sort]);

  const filteredIds = aM(() => rows.map((r) => r.id), [rows]);
  const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));
  const someSelected = filteredIds.some((id) => selected.has(id));
  let headState: boolean | 'dash' = false;
  if (allSelected) headState = true;
  else if (someSelected) headState = 'dash';

  const targets = aM(() => games.filter((g) => selected.has(g.id)), [games, selected]);

  /* ---------- selection ---------- */
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) { n.delete(id); } else { n.add(id); } return n; });
  const toggleAll = () => setSelected((s) => {
    const n = new Set(s);
    if (allSelected) filteredIds.forEach((id) => n.delete(id));
    else filteredIds.forEach((id) => n.add(id));
    return n;
  });
  const clearSel = () => setSelected(new Set());
  const selectAll = () => setSelected(new Set(filteredIds));
  const toggleFilter = (id: keyof Filters) => setFilters((f) => ({ ...f, [id]: !f[id] }));

  /* ---------- open the builder for a set of games (apply context) ---------- */
  const openBuilderFor = (gameList: Game[]) => {
    if (!gameList || gameList.length === 0) return;
    const lines = [...new Set(gameList.map((g) => g.launch || ''))];
    const sharedLine = lines.length === 1 ? lines[0] : '';
    const mixedMap = new Map<string, number>();
    gameList.forEach((g) => mixedMap.set(g.launch || '', (mixedMap.get(g.launch || '') || 0) + 1));
    const mixedLines: MixedLine[] = [...mixedMap.entries()].sort((a, b) => b[1] - a[1]);
    setBuilder({
      mode: 'apply',
      targets: gameList,
      initialPills: sharedLine ? parseLine(sharedLine) : [],
      mixedLines,
    });
  };

  /* ---------- writes (via the Rust backend) ---------- */
  const refreshFrom = (lib: LibraryDto) => {
    setCompatTools(lib.compat_tools || []);
    setGames(Array.isArray(lib.games) ? lib.games : []);
    setSteamRunning(!!lib.steam_running);
    if (lib.steam_root) setSteamRoot(lib.steam_root);
  };
  const plural = (n: number): string => `${n} game${n === 1 ? '' : 's'}`;

  /* ---------- Steam process control ---------- */
  const closeSteam = async () => {
    setSteamBusy(true);
    try {
      const lib = await invoke<LibraryDto>('close_steam');
      refreshFrom(lib);
      toast({ kind: 'ok', title: 'Steam closed', sub: 'Changes will stick now.' });
    } catch (e) {
      toast({ kind: 'err', title: 'Could not close Steam', sub: String(e) });
    } finally { setSteamBusy(false); }
  };
  const startSteam = async () => {
    setSteamBusy(true);
    try {
      const lib = await invoke<LibraryDto>('start_steam');
      refreshFrom(lib);
      toast({ kind: 'ok', title: 'Steam started' });
    } catch (e) {
      toast({ kind: 'err', title: 'Could not start Steam', sub: String(e) });
    } finally { setSteamBusy(false); }
  };

  // Run a write thunk, handling the case where Steam is running. mode:
  //   'reopen' close→write→reopen · 'closed' close→write · 'cancel' abort
  const runWrite = async (writeThunk: () => Promise<void>, mode: SteamChoice) => {
    if (mode === 'cancel') return;
    try {
      if (mode === 'reopen' || mode === 'closed') {
        setSteamBusy(true);
        const c = await invoke<LibraryDto>('close_steam'); refreshFrom(c);
      }
      await writeThunk();
      if (mode === 'reopen') {
        const s = await invoke<LibraryDto>('start_steam'); refreshFrom(s);
        toast({ kind: 'ok', title: 'Steam reopened' });
      }
    } catch (e) {
      toast({ kind: 'err', title: 'Failed', sub: String(e) });
    } finally { setSteamBusy(false); }
  };

  // changes: [[appid, value], ...]
  const writeLaunch = async (changes: Change[], { title, sub, undo }: WriteMeta = {}) => {
    try {
      const lib = await invoke<LibraryDto>('set_launch_options', { changes });
      refreshFrom(lib);
      toast({ kind: 'ok', title: title ?? '', sub, undo });
    } catch (e) {
      toast({ kind: 'err', title: 'Write failed', sub: String(e) });
    }
  };
  const writeCompat = async (changes: Change[], { title, sub, undo }: WriteMeta = {}) => {
    try {
      const lib = await invoke<LibraryDto>('set_compat_tool', { changes });
      refreshFrom(lib);
      toast({ kind: 'ok', title: title ?? '', sub, undo });
    } catch (e) {
      toast({ kind: 'err', title: 'Write failed', sub: String(e) });
    }
  };

  // If Steam is running, prompt to close (and optionally reopen); else write directly.
  const applyWrite = (count: number, writeThunk: () => Promise<void>) => {
    if (steamRunning) {
      setSteamPrompt({ count, run: (mode) => { setSteamPrompt(null); runWrite(writeThunk, mode); } });
    } else {
      writeThunk();
    }
  };

  const applyLaunch = (ids: string[], value: string) => {
    const ts = games.filter((g) => ids.includes(g.id));
    if (ts.length === 0) return;
    const undo: UndoAction = { kind: 'launch', changes: ts.map((g) => [g.appid, g.launch || '']) };
    const changes: Change[] = ts.map((g) => [g.appid, value]);
    setBuilder(null);
    applyWrite(ts.length, () => writeLaunch(changes, {
      title: value ? `Launch options set · ${plural(ts.length)}` : `Launch options cleared · ${plural(ts.length)}`,
      sub: value || undefined,
      undo,
    }));
  };
  const applyCompat = (ids: string[], compat: string) => {
    const ts = games.filter((g) => ids.includes(g.id));
    if (ts.length === 0) return;
    const undo: UndoAction = { kind: 'compat', changes: ts.map((g) => [g.appid, g.compat || 'default']) };
    const changes: Change[] = ts.map((g) => [g.appid, compat]);
    setCompatPop(null);
    applyWrite(ts.length, () => writeCompat(changes, { title: `Compatibility set · ${plural(ts.length)}`, sub: compatName(compat), undo }));
  };
  const clearLaunch = (ids: string[]) => applyLaunch(ids, '');
  const onUndo = (t: Toast) => {
    dismissToast(t.id);
    if (!t.undo) return;
    if (t.undo.kind === 'launch') writeLaunch(t.undo.changes, { title: 'Reverted launch options' });
    else if (t.undo.kind === 'compat') writeCompat(t.undo.changes, { title: 'Reverted compatibility' });
  };

  /* ---------- preset CRUD (persisted to ~/.config/manifold/presets.json) ---------- */
  // A preset is { id, name, desc, value } - one unified list, value is the launch string.
  const persistPresets = (next: Preset[]) => {
    setPresets(next);
    invoke('save_presets', { store: { presets: next } })
      .catch((e) => toast({ kind: 'err', title: 'Could not save presets', sub: String(e) }));
  };
  const savePreset = (preset: PresetDraft) => {
    const exists = preset.id && presets.some((p) => p.id === preset.id);
    const next = exists
      ? presets.map((p) => (p.id === preset.id ? { ...p, ...preset } : p))
      : [...presets, { ...preset, id: preset.id || ('pre_' + Date.now()) }];
    persistPresets(next);
    setBuilder(null);
    toast({ kind: 'ok', title: exists ? 'Preset saved' : 'Preset created', sub: preset.name });
  };
  const deletePreset = (p: Preset) => {
    persistPresets(presets.filter((x) => x.id !== p.id));
    toast({ kind: 'ok', title: 'Preset deleted', sub: p.name });
  };
  const duplicatePreset = (p: Preset) => persistPresets([...presets, { ...p, id: 'pre_' + Date.now(), name: p.name + ' copy' }]);
  const applyPresetToSelection = (p: Preset) => applyLaunch(targets.map((t) => t.id), p.value);
  // "Save as preset" from the apply context: reopen the builder in preset mode, carrying the line.
  const startFromApply = (_kind: string, pills: Pill[]) => setBuilder({ mode: 'preset', preset: null, initialPills: pills.map((p) => ({ ...p })) });

  /* ---------- row menu actions ---------- */
  const rowAction = (action: RowAction) => {
    if (!rowMenu) return;
    const g = rowMenu.game; setRowMenu(null);
    if (action === 'launch') openBuilderFor([g]);
    else if (action === 'compat') setCompatPop({ anchor: rowMenu.anchor, targets: [g] });
    else if (action === 'clear') clearLaunch([g.id]);
    else if (action === 'copyLaunch') { navigator.clipboard?.writeText(g.launch); toast({ kind: 'ok', title: 'Copied launch string' }); }
    else if (action === 'copyId') { navigator.clipboard?.writeText(g.appid); toast({ kind: 'ok', title: 'Copied AppID', sub: g.appid }); }
  };

  /* ---------- commands ---------- */
  const centerAnchor = (): AnchorRect => ({ left: globalThis.innerWidth / 2 - 129, top: 130, bottom: 150 });
  const commands: Command[] = aM(() => {
    const sel = targets.length;
    const pl = sel === 1 ? '' : 's';
    const selectionCmds: Command[] = sel > 0 ? [
      { id: 'c_launch', group: 'Selection', icon: 'terminal', name: `Set launch options on ${sel} game${pl}…`, hint: '', run: () => openBuilderFor(targets) },
      { id: 'c_compat', group: 'Selection', icon: 'cpu', name: `Set compatibility on ${sel} game${pl}…`, run: () => setCompatPop({ anchor: centerAnchor(), targets }) },
      { id: 'c_clear', group: 'Selection', icon: 'x', name: `Clear launch options on ${sel} game${pl}`, run: () => clearLaunch(targets.map((t) => t.id)) },
      { id: 'c_desel', group: 'Selection', icon: 'x', name: 'Deselect all', run: clearSel },
    ] : [];
    return [
      ...selectionCmds,
      { id: 'c_selall', group: 'Selection', icon: 'check', name: 'Select all (filtered)', run: selectAll },
      { id: 'g_lib', group: 'Go to', icon: 'layers', name: 'Library', run: () => setTab('library') },
      { id: 'g_pre', group: 'Go to', icon: 'bookmark', name: 'Presets', run: () => setTab('presets') },
      { id: 'g_bak', group: 'Go to', icon: 'history', name: 'Backups', run: () => setTab('backups') },
      { id: 'n_pre', group: 'Create', icon: 'plus', name: 'New preset', run: () => { setTab('presets'); setBuilder({ mode: 'preset', preset: null, initialPills: [] }); } },
      { id: 'steam_ctl', group: 'Steam', icon: 'power', name: steamRunning ? 'Close Steam' : 'Start Steam', run: () => (steamRunning ? closeSteam() : startSteam()) },
      { id: 'l_rescan', group: 'Library', icon: 'refresh', name: 'Re-scan library', run: () => loadLibrary() },
      { id: 'settings', group: 'Go to', icon: 'settings', name: 'Settings', run: () => setSettingsOpen(true) },
    ];
  }, [targets, steamRunning, empty, games, counts]);

  /* ---------- load real library from the Rust backend ---------- */
  const loadLibrary = aC(async ({ quiet }: { quiet?: boolean } = {}): Promise<LibraryDto | null> => {
    setLoading(true);
    try {
      const lib = await invoke<LibraryDto>('scan_library');
      setCompatTools(lib.compat_tools || []);
      setGames(Array.isArray(lib.games) ? lib.games : []);
      setSteamRunning(!!lib.steam_running);
      if (lib.steam_root) setSteamRoot(lib.steam_root);
      setBannerDismissed(false);
      setEmpty((lib.games || []).length === 0);
      setScanError(null);
      if (!quiet) {
        const inst = (lib.games || []).filter((g) => g.status === 'installed').length;
        setToasts((ts) => [...ts, { id: ++_tid, kind: 'ok', title: 'Library scanned', sub: `${(lib.games || []).length} games · ${inst} installed` }]);
      }
      return lib;
    } catch (e) {
      // Not running under Tauri (e.g. `vite preview`) - fall back to mock data
      // so the UI is still demoable in a plain browser.
      setGames(GAMES.map((g) => ({ ...g })));
      setScanError(String(e));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  aE(() => { loadLibrary({ quiet: true }); }, [loadLibrary]);

  /* ---------- load persisted presets/options from the backend ---------- */
  aE(() => {
    let cancelled = false;
    (async () => {
      try {
        const store = await invoke<{ presets?: Preset[] } | null>('load_presets');
        if (cancelled || !store) return;
        setPresets(Array.isArray(store.presets) ? store.presets : []);
      } catch (e) {
        // not under Tauri (e.g. vite preview) - keep the in-memory defaults
        logDev('load_presets unavailable:', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* ---------- load settings + discovered Steam roots ---------- */
  aE(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await invoke<Settings | null>('load_settings');
        let sys = 0;
        try { sys = await invoke<number>('get_system_scale'); } catch { /* none */ }
        if (!cancelled) {
          if (s) setSettings(s);
          // Desktop scale: explicit hint (Linux GDK) if any, else the webview's
          // devicePixelRatio (already reflects OS scale on Windows/macOS).
          const os = sys > 0 ? sys : (globalThis.devicePixelRatio || 1);
          setSystemScale(os);
          applyZoom(s && s.ui_scale > 0 ? s.ui_scale : os);
        }
        const roots = await invoke<DiscoveredRoot[]>('discover_steam_roots');
        if (!cancelled && Array.isArray(roots)) setDiscoveredRoots(roots);
      } catch (e) {
        // not under Tauri - keep defaults
        logDev('settings/roots unavailable:', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const saveSettings = async (next: Settings) => {
    setSettings(next);
    setSettingsOpen(false);
    applyZoom(effectiveScale(next));
    try {
      await invoke('save_settings', { settings: next });
      toast({ kind: 'ok', title: 'Settings saved' });
      await loadLibrary({ quiet: true }); // re-scan in case the Steam path changed
    } catch (e) {
      toast({ kind: 'err', title: 'Could not save settings', sub: String(e) });
    }
  };
  const closeSettings = () => { applyZoom(effectiveScale(settings)); setSettingsOpen(false); };

  /* ---------- dev: deep-link to a surface for screenshots ---------- */
  aE(() => {
    const p = new URLSearchParams(location.search).get('open');
    if (!p) return;
    const first = games.slice(0, 4);
    if (p === 'launch') { setSelected(new Set(first.map((g) => g.id))); openBuilderFor(first); }
    else if (p === 'launchmixed') { const t = [games.find((g) => g.launch.includes('OPTISCALER')), games.find((g) => !g.launch), games.find((g) => g.launch.includes('HDR'))].filter((g): g is Game => Boolean(g)); setSelected(new Set(t.map((g) => g.id))); openBuilderFor(t); }
    else if (p === 'compat') { setSelected(new Set(first.map((g) => g.id))); setCompatPop({ anchor: centerAnchor(), targets: first }); }
    else if (p === 'presets') setTab('presets');
    else if (p === 'editor') { setTab('presets'); setBuilder({ mode: 'preset', preset: null, initialPills: [] }); }
    else if (p === 'backups') setTab('backups');
    else if (p === 'steam') { setSteamRunning(true); setSelected(new Set(first.map((g) => g.id))); }
    else if (p === 'empty') setEmpty(true);
    else if (p === 'cmdk') { setSelected(new Set(first.map((g) => g.id))); setCmdk(true); }
  }, []);

  /* ---------- keyboard ---------- */
  aE(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdk((v) => !v); }
      else if (e.key === 'Escape') {
        if (builder) setBuilder(null);
        else if (compatPop) setCompatPop(null);
        else if (selected.size) clearSel();
      }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && tab === 'library' && !builder) {
        if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') { e.preventDefault(); selectAll(); }
      }
    };
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  }, [builder, compatPop, selected, tab, filteredIds]);

  const showBanner = steamRunning && !bannerDismissed;
  const controlsSide = resolveControlsSide(settings.window_controls);

  const TABS: Array<[string, string, string]> = [['library', 'Library', 'layers'], ['presets', 'Presets', 'bookmark'], ['backups', 'Backups', 'history']];

  return (
    <div className="app">
      {/* titlebar (custom - native decorations are off; this is the drag region) */}
      <div className="titlebar" data-tauri-drag-region>
        {controlsSide === 'left' && <WindowControls side="left" />}
        <div className="tb-brand" data-tauri-drag-region>
          <img className="tb-mark" src="/manifold.svg" alt="Manifold" width={18} height={18} draggable={false} data-tauri-drag-region />
          <div className="tb-title" data-tauri-drag-region>Manifold <b>· steam launch &amp; compat manager</b></div>
        </div>
        <div className="tb-spacer" data-tauri-drag-region />
        <div className="tabs">
          {TABS.map(([id, label, icon]) => (
            <button key={id} className={'tab' + (tab === id ? ' active' : '')} onClick={() => setTab(id)}>
              <Icon name={icon} size={14} />{label}
              {id === 'library' && <span className="badge-count">{games.length}</span>}
              {id === 'presets' && <span className="badge-count">{presets.length}</span>}
            </button>
          ))}
        </div>
        <div className="tb-spacer" data-tauri-drag-region />
        <button className="tb-btn" onClick={() => setCmdk(true)}><Icon name="command" size={14} />Search<span className="kbd">⌘K</span></button>
        <button className="icon-btn" title="Settings" onClick={() => setSettingsOpen(true)}><Icon name="settings" size={15} /></button>
        {controlsSide === 'right' && <WindowControls side="right" />}
      </div>

      {showBanner && <SteamBanner onCloseSteam={closeSteam} busy={steamBusy} onDismiss={() => setBannerDismissed(true)} />}

      {tab === 'library' && (empty ? (
        <EmptyState onRetry={() => loadLibrary()} />
      ) : (
        <>
          <Toolbar search={search} setSearch={setSearch} filters={filters} toggleFilter={toggleFilter} counts={counts} onOpenCmdk={() => setCmdk(true)} />
          <GamesTable
            rows={rows} selected={selected} sort={sort} setSort={setSort}
            onToggle={toggle} onToggleAll={toggleAll} headState={headState}
            onCompatClick={(e, g) => { const r = e.currentTarget.getBoundingClientRect(); setCompatPop({ anchor: r, targets: [g] }); }}
            onRowMenu={(e, g) => { const r = e.currentTarget.getBoundingClientRect(); setRowMenu({ anchor: r, game: g }); }}
            onLaunchClick={(g) => openBuilderFor([g])}
          />
          {targets.length > 0 && (
            <BulkBar
              count={targets.length}
              installedCount={targets.filter((t) => t.status === 'installed').length}
              ownedCount={targets.filter((t) => t.status === 'owned').length}
              onSetLaunch={() => openBuilderFor(targets)}
              onSetCompat={() => setCompatPop({ anchor: centerAnchor(), targets })}
              onClearLaunch={() => clearLaunch(targets.map((t) => t.id))}
              onClear={clearSel}
              disabled={steamBusy}
            />
          )}
        </>
      ))}

      {tab === 'presets' && (
        <PresetsList
          presets={presets}
          onNew={() => setBuilder({ mode: 'preset', preset: null, initialPills: [] })}
          onEdit={(p) => setBuilder({ mode: 'preset', preset: p, initialPills: parseLine(p.value) })}
          onDuplicate={duplicatePreset}
          onDelete={deletePreset}
          onApply={applyPresetToSelection}
          hasSelection={selected.size > 0}
          selCount={selected.size}
        />
      )}
      {tab === 'backups' && <BackupsView onRestore={(b: Backup) => toast({ kind: 'ok', title: 'Backup restored', sub: `${b.when} · ${b.games} games` })} />}

      <Footer total={games.length} installed={counts.installed} shown={rows.length} selected={selected.size} steamRunning={steamRunning} steamBusy={steamBusy} onCloseSteam={closeSteam} onStartSteam={startSteam} />

      {/* overlays */}
      {builder && (
        <BuilderSurface
          context={builder}
          presets={presets}
          mixedLines={builder.mixedLines}
          onApply={(val) => applyLaunch((builder.targets || []).map((t) => t.id), val)}
          onSavePreset={savePreset}
          onStartFromPreset={startFromApply}
          onClose={() => setBuilder(null)}
        />
      )}
      {compatPop && (
        <CompatPicker anchor={compatPop.anchor} targets={compatPop.targets}
          onPick={(id) => applyCompat(compatPop.targets.map((t) => t.id), id)}
          onClose={() => setCompatPop(null)} />
      )}
      {rowMenu && <RowMenu anchor={rowMenu.anchor} game={rowMenu.game} onAction={rowAction} onClose={() => setRowMenu(null)} />}
      {cmdk && <CommandPalette commands={commands} onClose={() => setCmdk(false)} />}
      {steamPrompt && <SteamConfirm count={steamPrompt.count} onChoose={steamPrompt.run} />}
      {settingsOpen && (
        <SettingsSheet
          settings={settings}
          effectiveRoot={steamRoot}
          discovered={discoveredRoots}
          systemScale={systemScale}
          onPreviewScale={applyZoom}
          onSave={saveSettings}
          onClose={closeSettings}
        />
      )}

      <Toasts toasts={toasts} onDismiss={dismissToast} onUndo={onUndo} />
    </div>
  );
}

export default App;
