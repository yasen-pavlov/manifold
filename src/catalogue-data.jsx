// catalogue-data.jsx - the building-block catalogue, compose/parse/validate, seed presets.
// One unified model: catalogue = building blocks; line = ordered pills; preset = saved line.
// The persisted preset is a launch STRING (see store.rs); pills are a derived editing view
// bridged by parseLine (string -> pills) and composeLine (pills -> string).

/* ============================================================
   CATEGORIES
   ============================================================ */
const CATEGORIES = [
  { id: 'wrapper', name: 'Wrapper',        icon: 'monitor', accent: true },
  { id: 'proton',  name: 'Proton',         icon: 'cpu' },
  { id: 'dxvk',    name: 'DXVK',           icon: 'zap' },
  { id: 'vkd3d',   name: 'VKD3D',          icon: 'box' },
  { id: 'tools',   name: 'Overlay & tools', icon: 'gauge' },
  { id: 'misc',    name: 'Misc',           icon: 'sliders' },
  { id: 'custom',  name: 'Custom',         icon: 'wand' },
];

/* ============================================================
   CATALOGUE - building blocks
   kinds: wrapper | complex | toggle | choice | input | tool | custom
   ============================================================ */
const CATALOGUE = [
  /* ---- WRAPPERS (own %command%, mutually exclusive) ---- */
  { id: 'w_native',   cat: 'wrapper', kind: 'wrapper', name: 'Native (Wayland)', head: 'game',
    desc: 'winewayland backend. HDR, native VRR, best alt-tab. No Steam overlay or Input.' },
  { id: 'w_xwayland', cat: 'wrapper', kind: 'wrapper', name: 'XWayland', head: 'game_xwayland',
    desc: 'For the Steam overlay, Steam Input and F12 screenshots. No HDR.' },
  { id: 'w_gamescope', cat: 'wrapper', kind: 'complex', name: 'Gamescope', head: 'gamescope',
    desc: 'Micro-compositor: HDR and the Steam overlay together. Configurable.' },
  { id: 'w_mangohud', cat: 'wrapper', kind: 'wrapper', name: 'MangoHud only', head: 'mangohud',
    desc: 'Run under the MangoHud overlay with no game wrapper.' },
  { id: 'w_gamemode', cat: 'wrapper', kind: 'wrapper', name: 'GameMode', head: 'gamemoderun',
    desc: 'Feral GameMode CPU/GPU governor, no game wrapper.' },
  { id: 'w_raw',      cat: 'wrapper', kind: 'wrapper', name: 'Raw (no wrapper)', head: '',
    desc: 'Just %command%, no wrapper. Steam launches the game directly.' },

  /* ---- PROTON (toggles, =1) ---- */
  { id: 'p_wayland',   cat: 'proton', kind: 'toggle', token: 'PROTON_ENABLE_WAYLAND=1', name: 'PROTON_ENABLE_WAYLAND', desc: 'Use native winewayland instead of XWayland.' },
  { id: 'p_hdr',       cat: 'proton', kind: 'toggle', token: 'PROTON_ENABLE_HDR=1',     name: 'PROTON_ENABLE_HDR',     desc: 'Emit a real HDR surface.' },
  { id: 'p_ntsync',    cat: 'proton', kind: 'toggle', token: 'PROTON_USE_NTSYNC=1',     name: 'PROTON_USE_NTSYNC',     desc: 'Lower-overhead NTSync primitives.' },
  { id: 'p_fsr4',      cat: 'proton', kind: 'toggle', token: 'PROTON_FSR4_UPGRADE=1',   name: 'PROTON_FSR4_UPGRADE',   desc: 'Upgrade FSR 3.1 to FSR 4.' },
  { id: 'p_opti',      cat: 'proton', kind: 'toggle', token: 'PROTON_USE_OPTISCALER=1', name: 'PROTON_USE_OPTISCALER', desc: 'OptiScaler: use FSR4 in DLSS/XeSS-only games.' },
  { id: 'p_dlss',      cat: 'proton', kind: 'toggle', token: 'PROTON_DLSS_UPGRADE=1',   name: 'PROTON_DLSS_UPGRADE',   desc: 'Deploy DLSS DLLs so OptiScaler can hook DLSS.' },
  { id: 'p_log',       cat: 'proton', kind: 'toggle', token: 'PROTON_LOG=1',            name: 'PROTON_LOG',            desc: 'Write a Proton debug log to $HOME.' },
  { id: 'p_wined3d',   cat: 'proton', kind: 'toggle', token: 'PROTON_USE_WINED3D=1',    name: 'PROTON_USE_WINED3D',    desc: 'OpenGL wined3d instead of DXVK.' },
  { id: 'p_precomp',   cat: 'proton', kind: 'toggle', token: 'PROTON_PRECOMPILE_SHADERS=1', name: 'PROTON_PRECOMPILE_SHADERS', desc: 'Pre-compile shaders at launch.' },

  /* ---- DXVK ---- */
  { id: 'd_hdr',    cat: 'dxvk', kind: 'toggle', token: 'DXVK_HDR=1', name: 'DXVK_HDR', desc: 'HDR for DX / vkd3d. Required for DX12 HDR.' },
  { id: 'd_hud',    cat: 'dxvk', kind: 'choice', key: 'DXVK_HUD', name: 'DXVK_HUD', desc: 'DXVK on-screen HUD.', choices: ['fps', 'full', 'devinfo', 'off'], default: 'fps' },
  { id: 'd_fps',    cat: 'dxvk', kind: 'input', key: 'DXVK_FRAME_RATE', name: 'DXVK_FRAME_RATE', desc: 'Frame-rate cap.', inputType: 'number', placeholder: '60', default: '60' },
  { id: 'd_async',  cat: 'dxvk', kind: 'toggle', token: 'DXVK_ASYNC=1', name: 'DXVK_ASYNC', desc: 'Async pipeline compilation (legacy DXVK).' },
  { id: 'd_log',    cat: 'dxvk', kind: 'choice', key: 'DXVK_LOG_LEVEL', name: 'DXVK_LOG_LEVEL', desc: 'DXVK log verbosity.', choices: ['none', 'error', 'warn', 'info', 'debug'], default: 'warn' },

  /* ---- VKD3D ---- */
  { id: 'v_debug',  cat: 'vkd3d', kind: 'choice', key: 'VKD3D_DEBUG', name: 'VKD3D_DEBUG', desc: 'vkd3d-proton debug level.', choices: ['none', 'err', 'warn', 'info', 'trace'], default: 'none' },
  { id: 'v_cache',  cat: 'vkd3d', kind: 'input', key: 'VKD3D_SHADER_CACHE_PATH', name: 'VKD3D_SHADER_CACHE_PATH', desc: 'Shader cache path, or 0 to disable.', inputType: 'path', placeholder: '~/.cache/vkd3d', default: '' },

  /* ---- OVERLAY & TOOLS (command prefixes, stack before the wrapper) ---- */
  { id: 't_mangohud', cat: 'tools', kind: 'tool', token: 'mangohud',        name: 'mangohud',        desc: 'MangoHud performance overlay.' },
  { id: 't_perf',     cat: 'tools', kind: 'tool', token: 'game-performance', name: 'game-performance', desc: 'CachyOS performance power profile.' },
  { id: 't_gamemode', cat: 'tools', kind: 'tool', token: 'gamemoderun',     name: 'gamemoderun',     desc: 'Feral GameMode governor.' },

  /* ---- MISC ---- */
  { id: 'm_antilag', cat: 'misc', kind: 'toggle', token: 'ENABLE_LAYER_MESA_ANTI_LAG=1', name: 'ENABLE_LAYER_MESA_ANTI_LAG', desc: 'Mesa anti-lag layer.' },
  { id: 'm_preload', cat: 'misc', kind: 'input', key: 'LD_PRELOAD', name: 'LD_PRELOAD', desc: 'Preload path. Often set empty to clear an inherited value.', inputType: 'path', placeholder: '(empty)', default: '' },
  { id: 'm_gswsi',   cat: 'misc', kind: 'toggle', token: 'ENABLE_GAMESCOPE_WSI=1', name: 'ENABLE_GAMESCOPE_WSI', desc: 'Gamescope WSI layer.' },
  { id: 'm_nohdrwsi', cat: 'misc', kind: 'toggle', token: 'DISABLE_HDR_WSI=1', name: 'DISABLE_HDR_WSI', desc: 'Disable HDR WSI (gamescope troubleshooting).' },
];

const CAT_BY_ID = Object.fromEntries(CATALOGUE.map((c) => [c.id, c]));

/* ============================================================
   GAMESCOPE complex schema (sub-controls)
   ============================================================ */
const GAMESCOPE_SCHEMA = {
  flags: [
    { key: 'W', label: 'Width',  flag: '-W', type: 'number', placeholder: '3840', group: 'output' },
    { key: 'H', label: 'Height', flag: '-H', type: 'number', placeholder: '2160', group: 'output' },
    { key: 'r', label: 'Refresh (Hz)', flag: '-r', type: 'number', placeholder: '240', group: 'output' },
    { key: 'o', label: 'Unfocused FPS cap', flag: '-o', type: 'number', placeholder: '60', group: 'output' },
  ],
  toggles: [
    { key: 'f', label: 'Fullscreen', flag: '-f', group: 'display' },
    { key: 'adaptive-sync', label: 'Adaptive sync (VRR)', flag: '--adaptive-sync', group: 'display' },
    { key: 'hdr-enabled', label: 'HDR enabled', flag: '--hdr-enabled', group: 'hdr' },
    { key: 'hdr-debug-force-output', label: 'Force HDR output', flag: '--hdr-debug-force-output', group: 'hdr' },
    { key: 'force-grab-cursor', label: 'Force grab cursor', flag: '--force-grab-cursor', group: 'input' },
  ],
  envs: [
    { key: 'ENABLE_GAMESCOPE_WSI', label: 'ENABLE_GAMESCOPE_WSI=1' },
    { key: 'DXVK_HDR', label: 'DXVK_HDR=1' },
    { key: 'DISABLE_HDR_WSI', label: 'DISABLE_HDR_WSI=1' },
  ],
};
const GAMESCOPE_DEFAULT = { W: '3840', H: '2160', r: '240', o: '60', f: true, 'adaptive-sync': true, 'hdr-enabled': true, 'hdr-debug-force-output': false, 'force-grab-cursor': false, ENABLE_GAMESCOPE_WSI: true, DXVK_HDR: true, DISABLE_HDR_WSI: false };

/* ============================================================
   PILL FACTORY - build a pill instance from a catalogue item
   ============================================================ */
let _uid = 0;
const nextUid = () => 'pill' + (++_uid);

function makePill(item, overrides = {}) {
  if (item && item.id && CAT_BY_ID[item.id]) item = { ...CAT_BY_ID[item.id], ...item };
  const base = { uid: nextUid(), itemId: item.id, kind: item.kind, cat: item.cat, name: item.name };
  if (item.kind === 'toggle' || item.kind === 'tool') return { ...base, token: item.token, ...overrides };
  if (item.kind === 'choice') return { ...base, key: item.key, value: item.default, choices: item.choices, ...overrides };
  if (item.kind === 'input') return { ...base, key: item.key, value: item.default ?? '', inputType: item.inputType, placeholder: item.placeholder, ...overrides };
  if (item.kind === 'wrapper') return { ...base, head: item.head, ...overrides };
  if (item.kind === 'complex') return { ...base, cfg: { ...GAMESCOPE_DEFAULT }, ...overrides };
  return { ...base, ...overrides };
}
function makeCustomPill(token) {
  return { uid: nextUid(), itemId: 'custom', kind: 'custom', cat: 'custom', name: 'Custom', token };
}

/* ============================================================
   TOKENISE one pill -> its string fragment (no %command%)
   ============================================================ */
function pillTokens(p) {
  switch (p.kind) {
    case 'toggle':
    case 'tool':
    case 'custom':
      return p.token ? [p.token] : [];
    case 'choice':
      return [`${p.key}=${p.value}`];
    case 'input':
      return [`${p.key}=${p.value ?? ''}`];
    case 'wrapper':
      return p.head ? [p.head] : [];
    case 'complex':
      return gamescopeTokens(p.cfg);
    default:
      return [];
  }
}
function gamescopeTokens(cfg) {
  const envs = GAMESCOPE_SCHEMA.envs.filter((e) => cfg[e.key]).map((e) => `${e.key}=1`);
  const flags = [];
  GAMESCOPE_SCHEMA.flags.forEach((f) => { if (cfg[f.key] !== '' && cfg[f.key] != null) flags.push(f.flag, String(cfg[f.key])); });
  GAMESCOPE_SCHEMA.toggles.forEach((t) => { if (cfg[t.key]) flags.push(t.flag); });
  return [...envs, 'gamescope', ...flags, '--'];
}

const isEnvToken = (tok) => /^[A-Z0-9_]+=/.test(tok);

/* ============================================================
   COMPOSE - pills -> final string (always valid ordering)
   env vars first, then command-prefix tools, then wrapper head, then %command%
   ============================================================ */
function composeLine(pills) {
  const wrapper = pills.find((p) => p.kind === 'wrapper' || p.kind === 'complex');
  const rest = pills.filter((p) => p !== wrapper);
  const envParts = [];
  const toolParts = [];
  rest.forEach((p) => {
    const toks = pillTokens(p);
    toks.forEach((t) => (isEnvToken(t) ? envParts : toolParts).push(t));
  });
  const headToks = wrapper ? pillTokens(wrapper) : [];
  // gamescope contributes its own nested envs at the front of its head; keep them adjacent to gamescope
  const all = [...envParts, ...toolParts, ...headToks, '%command%'];
  return all.filter(Boolean).join(' ');
}

/* ============================================================
   VALIDATE - non-blocking issues + per-pill flags
   ============================================================ */
const KNOWN_PATH = new Set(['game', 'game_xwayland', 'game_gamescope', 'gamescope', 'mangohud', 'gamemoderun', 'game-performance']);
const STALE_TOKENS = {
  gamescope_proton: 'Legacy wrapper script. Use the Gamescope wrapper instead.',
  gamescope_native: 'Legacy wrapper script. Use Native or Gamescope.',
  game_native: 'Renamed. Use the Native (Wayland) wrapper.',
  hdr_run: 'Deprecated HDR shim. Use PROTON_ENABLE_HDR + DXVK_HDR.',
};

function validateLine(finalStr, pills) {
  const issues = [];
  const flagged = {}; // uid -> {level, msg}
  const tokens = finalStr.trim().split(/\s+/).filter(Boolean);
  const cmdCount = tokens.filter((t) => t === '%command%').length;

  if (cmdCount === 0) issues.push({ level: 'error', msg: 'No %command% token. Add a wrapper so Steam knows where the game runs.' });
  else if (cmdCount > 1) issues.push({ level: 'error', msg: `${cmdCount}x %command%: it must appear exactly once.` });

  // stale / typo'd tokens anywhere
  const staleHits = [];
  tokens.forEach((t) => { const k = t.replace(/=.*/, ''); if (STALE_TOKENS[t]) staleHits.push(t); else if (STALE_TOKENS[k]) staleHits.push(k); });
  [...new Set(staleHits)].forEach((s) => issues.push({ level: 'warn', msg: `${s}: ${STALE_TOKENS[s]}` }));

  // unknown wrapper command (the bare word right before %command%, if any)
  const ci = tokens.indexOf('%command%');
  if (ci > 0) {
    const prev = tokens[ci - 1];
    if (prev !== '--' && !isEnvToken(prev) && !KNOWN_PATH.has(prev) && !STALE_TOKENS[prev]) {
      issues.push({ level: 'warn', msg: `Wrapper "${prev}" was not found on PATH. Double-check the command name.` });
    }
  }

  // per-pill: flag custom pills that are stale, and complex pill if its head missing
  pills.forEach((p) => {
    const toks = pillTokens(p);
    toks.forEach((t) => {
      const k = t.replace(/=.*/, '');
      if (STALE_TOKENS[t] || STALE_TOKENS[k]) flagged[p.uid] = { level: 'warn', msg: STALE_TOKENS[t] || STALE_TOKENS[k] };
    });
    if ((p.kind === 'wrapper' || p.kind === 'complex') && p.head && !KNOWN_PATH.has(p.head) && !p.head.includes('gamescope')) {
      flagged[p.uid] = { level: 'warn', msg: `"${p.head}" not on PATH` };
    }
  });

  const level = issues.some((i) => i.level === 'error') ? 'error' : issues.some((i) => i.level === 'warn') ? 'warn' : 'ok';
  return { issues, flagged, level, cmdCount };
}

/* ============================================================
   PARSE - best-effort raw string -> pills (escape hatch)
   ============================================================ */
function parseLine(str) {
  const tokens = (str || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const ci = tokens.indexOf('%command%');
  const before = ci === -1 ? tokens : tokens.slice(0, ci);

  // detect gamescope span
  const gi = before.findIndex((t) => t === 'gamescope');
  let wrapperPill = null;
  let head = before.slice(); // tokens that form the env+tool+wrapper region

  if (gi !== -1) {
    // gamescope ... -- ; nested envs are env tokens immediately preceding gamescope
    const dashIdx = before.indexOf('--', gi);
    const flagToks = before.slice(gi + 1, dashIdx === -1 ? before.length : dashIdx);
    const cfg = { ...GAMESCOPE_DEFAULT };
    Object.keys(cfg).forEach((k) => { if (typeof cfg[k] === 'boolean') cfg[k] = false; });
    for (let i = 0; i < flagToks.length; i++) {
      const f = flagToks[i];
      const flagDef = GAMESCOPE_SCHEMA.flags.find((x) => x.flag === f);
      const togDef = GAMESCOPE_SCHEMA.toggles.find((x) => x.flag === f);
      if (flagDef) { cfg[flagDef.key] = flagToks[i + 1] || ''; i++; }
      else if (togDef) cfg[togDef.key] = true;
    }
    // nested envs (preceding gamescope) that belong to the gamescope schema
    GAMESCOPE_SCHEMA.envs.forEach((e) => { if (before.includes(`${e.key}=1`)) cfg[e.key] = true; });
    wrapperPill = makePill(CAT_BY_ID.w_gamescope, { cfg });
    head = before.slice(0, gi).filter((t) => !GAMESCOPE_SCHEMA.envs.some((e) => `${e.key}=1` === t));
  } else {
    // wrapper is the last bare (non-env) token in `before`
    let wIdx = -1;
    for (let i = before.length - 1; i >= 0; i--) { if (!isEnvToken(before[i])) { wIdx = i; break; } }
    if (wIdx !== -1) {
      const w = before[wIdx];
      const item = CATALOGUE.find((c) => c.kind === 'wrapper' && c.head === w);
      if (item) { wrapperPill = makePill(item); head = before.slice(0, wIdx).concat(before.slice(wIdx + 1)); }
      else {
        // unknown/stale wrapper -> raw wrapper pill carrying the literal head, flagged later
        wrapperPill = makePill({ id: 'w_raw', kind: 'wrapper', cat: 'wrapper' }, { head: w, name: w });
        head = before.slice(0, wIdx).concat(before.slice(wIdx + 1));
      }
    }
  }

  // remaining head tokens -> env/tool/custom pills
  const pills = [];
  head.forEach((tok) => {
    const c = CATALOGUE.find((x) => {
      if (x.kind === 'toggle' || x.kind === 'tool') return x.token === tok;
      if (x.kind === 'choice' || x.kind === 'input') return tok.startsWith(x.key + '=');
      return false;
    });
    if (!c) { pills.push(makeCustomPill(tok)); return; }
    if (c.kind === 'choice') pills.push(makePill(c, { value: tok.slice(c.key.length + 1) }));
    else if (c.kind === 'input') pills.push(makePill(c, { value: tok.slice(c.key.length + 1) }));
    else pills.push(makePill(c));
  });
  if (wrapperPill) pills.push(wrapperPill);
  else if (ci !== -1) pills.push(makePill({ id: 'w_raw', kind: 'wrapper', cat: 'wrapper', head: '' }));
  return pills;
}

export {
  CATEGORIES, CATALOGUE, CAT_BY_ID, GAMESCOPE_SCHEMA, GAMESCOPE_DEFAULT,
  makePill, makeCustomPill, pillTokens, gamescopeTokens, composeLine, validateLine, parseLine,
  isEnvToken, KNOWN_PATH, STALE_TOKENS,
};
