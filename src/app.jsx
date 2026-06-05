// app.jsx — Manifold main: state, routing, window chrome, keyboard
import React, { useState as aS, useEffect as aE, useMemo as aM, useCallback as aC } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "./icons.jsx";
import { GAMES, PRESETS, OPTIONS, compatName, setCompatTools } from "./data.jsx";
import { Toolbar, GamesTable, BulkBar, Footer } from "./table.jsx";
import { LaunchSheet, CompatPicker, RowMenu, SteamBanner, Toasts, EmptyState } from "./surfaces.jsx";
import { PresetsManager, ItemEditor, BackupsView, CommandPalette } from "./presets.jsx";

let _tid = 0;

function App() {
  const [games, setGames] = aS([]);
  const [presets, setPresets] = aS(() => PRESETS.map((p) => ({ ...p })));
  const [options, setOptions] = aS(() => OPTIONS.map((o) => ({ ...o })));
  const [loading, setLoading] = aS(true);
  const [scanError, setScanError] = aS(null);

  const [selected, setSelected] = aS(() => new Set());
  const [search, setSearch] = aS('');
  const [filters, setFilters] = aS({ installed: false, owned: false, custom: false, forced: false });
  const [sort, setSort] = aS({ col: 'name', dir: 'asc' });
  const [tab, setTab] = aS('library');

  const [steamRunning, setSteamRunning] = aS(false);
  const [bannerDismissed, setBannerDismissed] = aS(false);
  const [empty, setEmpty] = aS(false);

  const [launchTargets, setLaunchTargets] = aS(null); // array | null
  const [compatPop, setCompatPop] = aS(null);         // {anchor, targets}
  const [rowMenu, setRowMenu] = aS(null);             // {anchor, game}
  const [editor, setEditor] = aS(null);               // item | null
  const [cmdk, setCmdk] = aS(false);
  const [toasts, setToasts] = aS([]);

  /* ---------- toasts ---------- */
  const toast = aC((t) => {
    const id = ++_tid;
    setToasts((ts) => [...ts, { ...t, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), t.sticky ? 99999 : 4800);
  }, []);
  const dismissToast = (id) => setToasts((ts) => ts.filter((x) => x.id !== id));

  /* ---------- derived ---------- */
  const counts = aM(() => ({
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
    const cmp = {
      name: (a, b) => a.name.localeCompare(b.name),
      appid: (a, b) => Number(a.appid) - Number(b.appid),
      status: (a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'installed' ? -1 : 1),
      compat: (a, b) => compatName(a.compat).localeCompare(compatName(b.compat)),
    }[sort.col] || (() => 0);
    return [...r].sort((a, b) => cmp(a, b) * dir);
  }, [games, search, filters, sort]);

  const filteredIds = aM(() => rows.map((r) => r.id), [rows]);
  const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));
  const someSelected = filteredIds.some((id) => selected.has(id));
  const headState = allSelected ? true : someSelected ? 'dash' : false;

  const targets = aM(() => games.filter((g) => selected.has(g.id)), [games, selected]);
  const writesBlocked = steamRunning;

  /* ---------- selection ---------- */
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected((s) => {
    const n = new Set(s);
    if (allSelected) filteredIds.forEach((id) => n.delete(id));
    else filteredIds.forEach((id) => n.add(id));
    return n;
  });
  const clearSel = () => setSelected(new Set());
  const selectAll = () => setSelected(new Set(filteredIds));
  const toggleFilter = (id) => setFilters((f) => ({ ...f, [id]: !f[id] }));

  /* ---------- writes (guarded, via the Rust backend) ---------- */
  const guard = () => {
    if (writesBlocked) { toast({ kind: 'err', title: 'Steam is running', sub: 'Close Steam before writing — changes won’t stick.' }); return false; }
    return true;
  };
  const refreshFrom = (lib) => {
    setCompatTools(lib.compat_tools || []);
    setGames(Array.isArray(lib.games) ? lib.games : []);
    setSteamRunning(!!lib.steam_running);
  };
  const plural = (n) => `${n} game${n !== 1 ? 's' : ''}`;

  // changes: [[appid, value], ...]
  const writeLaunch = async (changes, { title, sub, undo } = {}) => {
    try {
      const lib = await invoke('set_launch_options', { changes });
      refreshFrom(lib);
      toast({ kind: 'ok', title, sub, undo });
    } catch (e) {
      toast({ kind: 'err', title: 'Write failed', sub: String(e) });
    }
  };
  const writeCompat = async (changes, { title, sub, undo } = {}) => {
    try {
      const lib = await invoke('set_compat_tool', { changes });
      refreshFrom(lib);
      toast({ kind: 'ok', title, sub, undo });
    } catch (e) {
      toast({ kind: 'err', title: 'Write failed', sub: String(e) });
    }
  };

  const applyLaunch = (ids, value) => {
    if (!guard()) return;
    const ts = games.filter((g) => ids.includes(g.id));
    if (ts.length === 0) return;
    const undo = { kind: 'launch', changes: ts.map((g) => [g.appid, g.launch || '']) };
    const changes = ts.map((g) => [g.appid, value]);
    setLaunchTargets(null);
    writeLaunch(changes, {
      title: value ? `Launch options set · ${plural(ts.length)}` : `Launch options cleared · ${plural(ts.length)}`,
      sub: value || undefined,
      undo,
    });
  };
  const applyCompat = (ids, compat) => {
    if (!guard()) return;
    const ts = games.filter((g) => ids.includes(g.id));
    if (ts.length === 0) return;
    const undo = { kind: 'compat', changes: ts.map((g) => [g.appid, g.compat || 'default']) };
    const changes = ts.map((g) => [g.appid, compat]);
    setCompatPop(null);
    writeCompat(changes, { title: `Compatibility set · ${plural(ts.length)}`, sub: compatName(compat), undo });
  };
  const clearLaunch = (ids) => applyLaunch(ids, '');
  const onUndo = (t) => {
    dismissToast(t.id);
    if (!t.undo) return;
    if (t.undo.kind === 'launch') writeLaunch(t.undo.changes, { title: 'Reverted launch options' });
    else if (t.undo.kind === 'compat') writeCompat(t.undo.changes, { title: 'Reverted compatibility' });
  };

  /* ---------- preset CRUD (persisted to ~/.config/manifold/presets.json) ---------- */
  const persistPresets = (nextPresets, nextOptions) => {
    setPresets(nextPresets);
    setOptions(nextOptions);
    invoke('save_presets', { store: { presets: nextPresets, options: nextOptions } })
      .catch((e) => toast({ kind: 'err', title: 'Could not save presets', sub: String(e) }));
  };
  const saveItem = (item) => {
    const id = item.id || (item.kind + '_' + Date.now());
    const norm = { ...item, id };
    let p = presets, o = options;
    if (item.kind === 'preset') {
      o = options.filter((x) => x.id !== id); // in case the kind was switched
      p = presets.some((x) => x.id === id) ? presets.map((x) => (x.id === id ? norm : x)) : [...presets, norm];
    } else {
      p = presets.filter((x) => x.id !== id);
      o = options.some((x) => x.id === id) ? options.map((x) => (x.id === id ? norm : x)) : [...options, norm];
    }
    persistPresets(p, o);
    setEditor(null);
    toast({ kind: 'ok', title: `${item.kind === 'preset' ? 'Preset' : 'Option'} saved`, sub: item.name });
  };
  const deleteItem = (item) => {
    persistPresets(presets.filter((x) => x.id !== item.id), options.filter((x) => x.id !== item.id));
    toast({ kind: 'ok', title: 'Deleted', sub: item.name });
  };
  const duplicateItem = (item) => {
    const copy = { ...item, id: item.kind + '_' + Date.now(), name: item.name + ' copy' };
    if (item.kind === 'preset') persistPresets([...presets, copy], options);
    else persistPresets(presets, [...options, copy]);
  };

  /* ---------- row menu actions ---------- */
  const rowAction = (action) => {
    const g = rowMenu.game; setRowMenu(null);
    if (action === 'launch') setLaunchTargets([g]);
    else if (action === 'compat') setCompatPop({ anchor: rowMenu.anchor, targets: [g] });
    else if (action === 'clear') clearLaunch([g.id]);
    else if (action === 'copyLaunch') { navigator.clipboard?.writeText(g.launch); toast({ kind: 'ok', title: 'Copied launch string' }); }
    else if (action === 'copyId') { navigator.clipboard?.writeText(g.appid); toast({ kind: 'ok', title: 'Copied AppID', sub: g.appid }); }
  };

  /* ---------- commands ---------- */
  const centerAnchor = () => ({ left: window.innerWidth / 2 - 129, top: 130, bottom: 150 });
  const commands = aM(() => {
    const sel = targets.length;
    const c = [];
    if (sel > 0) {
      c.push({ id: 'c_launch', group: 'Selection', icon: 'terminal', name: `Set launch options on ${sel} game${sel !== 1 ? 's' : ''}…`, hint: '', run: () => setLaunchTargets(targets) });
      c.push({ id: 'c_compat', group: 'Selection', icon: 'cpu', name: `Set compatibility on ${sel} game${sel !== 1 ? 's' : ''}…`, run: () => setCompatPop({ anchor: centerAnchor(), targets }) });
      c.push({ id: 'c_clear', group: 'Selection', icon: 'x', name: `Clear launch options on ${sel} game${sel !== 1 ? 's' : ''}`, run: () => clearLaunch(targets.map((t) => t.id)) });
      c.push({ id: 'c_desel', group: 'Selection', icon: 'x', name: 'Deselect all', run: clearSel });
    }
    c.push({ id: 'c_selall', group: 'Selection', icon: 'check', name: 'Select all (filtered)', run: selectAll });
    c.push({ id: 'g_lib', group: 'Go to', icon: 'layers', name: 'Library', run: () => setTab('library') });
    c.push({ id: 'g_pre', group: 'Go to', icon: 'sliders', name: 'Presets & options', run: () => setTab('presets') });
    c.push({ id: 'g_bak', group: 'Go to', icon: 'history', name: 'Backups', run: () => setTab('backups') });
    c.push({ id: 'n_pre', group: 'Create', icon: 'plus', name: 'New preset', run: () => { setTab('presets'); setEditor({ kind: 'preset' }); } });
    c.push({ id: 'n_opt', group: 'Create', icon: 'plus', name: 'New single option', run: () => { setTab('presets'); setEditor({ kind: 'option' }); } });
    c.push({ id: 's_steam', group: 'Simulate', icon: 'power', name: steamRunning ? 'Mark Steam as stopped' : 'Mark Steam as running', run: () => { setSteamRunning((v) => !v); setBannerDismissed(false); } });
    c.push({ id: 's_empty', group: 'Simulate', icon: 'folder', name: empty ? 'Restore library' : 'Show empty / first-run state', run: () => setEmpty((v) => !v) });
    c.push({ id: 'l_rescan', group: 'Library', icon: 'refresh', name: 'Re-scan library', run: () => loadLibrary() });
    return c;
  }, [targets, steamRunning, empty, games, counts]);

  /* ---------- load real library from the Rust backend ---------- */
  const loadLibrary = aC(async ({ quiet } = {}) => {
    setLoading(true);
    try {
      const lib = await invoke('scan_library');
      setCompatTools(lib.compat_tools || []);
      setGames(Array.isArray(lib.games) ? lib.games : []);
      setSteamRunning(!!lib.steam_running);
      setBannerDismissed(false);
      setEmpty((lib.games || []).length === 0);
      setScanError(null);
      if (!quiet) {
        const inst = (lib.games || []).filter((g) => g.status === 'installed').length;
        setToasts((ts) => [...ts, { id: ++_tid, kind: 'ok', title: 'Library scanned', sub: `${(lib.games || []).length} games · ${inst} installed` }]);
      }
      return lib;
    } catch (e) {
      // Not running under Tauri (e.g. `vite preview`) — fall back to mock data
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
        const store = await invoke('load_presets');
        if (cancelled || !store) return;
        setPresets(Array.isArray(store.presets) ? store.presets : []);
        setOptions(Array.isArray(store.options) ? store.options : []);
      } catch (e) {
        // not under Tauri (e.g. vite preview) — keep the in-memory seed defaults
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* ---------- dev: deep-link to a surface for screenshots ---------- */
  aE(() => {
    const p = new URLSearchParams(location.search).get('open');
    if (!p) return;
    const first = games.slice(0, 4);
    if (p === 'launch') { setSelected(new Set(first.map((g) => g.id))); setLaunchTargets(first); }
    else if (p === 'launchmixed') { const t = [games.find(g=>g.launch.includes('OPTISCALER')), games.find(g=>!g.launch), games.find(g=>g.launch.includes('HDR'))].filter(Boolean); setSelected(new Set(t.map(g=>g.id))); setLaunchTargets(t); }
    else if (p === 'compat') { setSelected(new Set(first.map((g) => g.id))); setCompatPop({ anchor: centerAnchor(), targets: first }); }
    else if (p === 'presets') setTab('presets');
    else if (p === 'editor') { setTab('presets'); setEditor({ kind: 'preset', name: 'Native HDR', desc: 'Wayland-native HDR pipeline (Proton + DXVK).', value: 'PROTON_ENABLE_WAYLAND=1 PROTON_ENABLE_HDR=1 DXVK_HDR=1 game %command%', id: 'p_hdr' }); }
    else if (p === 'backups') setTab('backups');
    else if (p === 'steam') { setSteamRunning(true); setSelected(new Set(first.map((g) => g.id))); }
    else if (p === 'empty') setEmpty(true);
    else if (p === 'cmdk') { setSelected(new Set(first.map((g) => g.id))); setCmdk(true); }
  }, []);

  /* ---------- keyboard ---------- */
  aE(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdk((v) => !v); }
      else if (e.key === 'Escape') {
        if (launchTargets) setLaunchTargets(null);
        else if (editor) setEditor(null);
        else if (compatPop) setCompatPop(null);
        else if (selected.size) clearSel();
      }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && tab === 'library' && !launchTargets && !editor) {
        if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') { e.preventDefault(); selectAll(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [launchTargets, editor, compatPop, selected, tab, filteredIds]);

  const showBanner = steamRunning && !bannerDismissed;

  return (
    <div className="app">
      {/* titlebar */}
      <div className="titlebar">
        <div className="tb-dots">
          <button className="tb-dot c" /><button className="tb-dot m" /><button className="tb-dot x" />
        </div>
        <div className="tb-brand">
          <div className="tb-mark"><i /></div>
          <div className="tb-title">Manifold <b>· steam launch &amp; compat manager</b></div>
        </div>
        <div className="tb-spacer" />
        <div className="tabs">
          {[['library', 'Library', 'layers'], ['presets', 'Presets', 'sliders'], ['backups', 'Backups', 'history']].map(([id, label, icon]) => (
            <button key={id} className={'tab' + (tab === id ? ' active' : '')} onClick={() => setTab(id)}>
              <Icon name={icon} size={14} />{label}
              {id === 'library' && <span className="badge-count">{games.length}</span>}
              {id === 'presets' && <span className="badge-count">{presets.length + options.length}</span>}
            </button>
          ))}
        </div>
        <div className="tb-spacer" />
        <button className="tb-btn" onClick={() => setCmdk(true)}><Icon name="command" size={14} />Search<span className="kbd">⌘K</span></button>
      </div>

      {showBanner && <SteamBanner onClose={() => setBannerDismissed(true)} />}

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
            onLaunchClick={(g) => setLaunchTargets([g])}
          />
          {targets.length > 0 && (
            <BulkBar
              count={targets.length}
              installedCount={targets.filter((t) => t.status === 'installed').length}
              ownedCount={targets.filter((t) => t.status === 'owned').length}
              onSetLaunch={() => setLaunchTargets(targets)}
              onSetCompat={() => setCompatPop({ anchor: centerAnchor(), targets })}
              onClearLaunch={() => clearLaunch(targets.map((t) => t.id))}
              onClear={clearSel}
              disabled={writesBlocked}
            />
          )}
        </>
      ))}

      {tab === 'presets' && (
        <PresetsManager presets={presets} options={options}
          onEdit={(it) => setEditor(it)} onNew={(kind) => setEditor({ kind })}
          onDuplicate={duplicateItem} onDelete={deleteItem} />
      )}
      {tab === 'backups' && <BackupsView onRestore={(b) => toast({ kind: 'ok', title: 'Backup restored', sub: `${b.when} · ${b.games} games` })} />}

      <Footer total={games.length} installed={counts.installed} shown={rows.length} selected={selected.size} steamRunning={steamRunning} onToggleSteam={() => { setSteamRunning((v) => !v); setBannerDismissed(false); }} />

      {/* overlays */}
      {launchTargets && (
        <LaunchSheet targets={launchTargets} presets={presets} options={options}
          onApply={(val) => applyLaunch(launchTargets.map((t) => t.id), val)}
          onClear={() => clearLaunch(launchTargets.map((t) => t.id))}
          onClose={() => setLaunchTargets(null)} />
      )}
      {compatPop && (
        <CompatPicker anchor={compatPop.anchor} targets={compatPop.targets}
          onPick={(id) => applyCompat(compatPop.targets.map((t) => t.id), id)}
          onClose={() => setCompatPop(null)} />
      )}
      {rowMenu && <RowMenu anchor={rowMenu.anchor} game={rowMenu.game} onAction={rowAction} onClose={() => setRowMenu(null)} />}
      {editor && <ItemEditor item={editor} onSave={saveItem} onClose={() => setEditor(null)} />}
      {cmdk && <CommandPalette commands={commands} onClose={() => setCmdk(false)} />}

      <Toasts toasts={toasts} onDismiss={dismissToast} onUndo={onUndo} />
    </div>
  );
}

export default App;
