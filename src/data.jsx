// data.jsx - mock library + presets + helpers (uses real data from the brief)

const COMPAT_TOOLS = [
  { id: 'default',  name: 'Default',              note: 'No forced tool - Steam decides' },
  { id: 'exp',      name: 'Proton - Experimental', note: 'Bleeding-edge Valve build' },
  { id: 'p90',      name: 'Proton 9.0 (Beta)',     note: 'Stable 9.0 branch' },
  { id: 'cachyos',  name: 'proton-cachyos-slr',    note: 'CachyOS optimized + SLR runtime' },
  { id: 'luxt',     name: 'luxtorpeda',            note: 'Native engine replacements' },
];

// --- library ---------------------------------------------------------------
// status: 'installed' | 'owned'  ·  compat: COMPAT_TOOLS id
function g(name, appid, installed, compat, launch, sizeGB) {
  return { id: 'app' + appid, name, appid: String(appid), status: installed ? 'installed' : 'owned', compat, launch, sizeGB };
}

const GAMES = [
  g('Elden Ring',                  1245620, true,  'cachyos', 'PROTON_USE_OPTISCALER=1 game %command%', 58.2),
  g('Cyberpunk 2077',              1091500, true,  'cachyos', 'PROTON_DLSS_UPGRADE=1 PROTON_USE_OPTISCALER=1 game %command%', 71.4),
  g("Baldur's Gate 3",            1086940, true,  'p90',     'game %command%', 122.7),
  g('Helldivers 2',                553850,  true,  'exp',     'gamescope_proton %command%', 38.9),
  g('The Witcher 3: Wild Hunt',    292030,  true,  'cachyos', 'PROTON_ENABLE_WAYLAND=1 PROTON_ENABLE_HDR=1 DXVK_HDR=1 game %command%', 49.1),
  g('Hades II',                    1145350, true,  'exp',     'game %command%', 9.3),
  g('Red Dead Redemption 2',       1174180, true,  'cachyos', 'gamescope_native %command%', 119),
  g('Hollow Knight: Silksong',     1030300, false, 'default', '', 0),
  g('Stardew Valley',              413150,  true,  'default', '', 0.9),
  g('Factorio',                    427520,  true,  'default', 'game %command%', 2.1),
  g('DOOM Eternal',                782330,  true,  'p90',     'PROTON_USE_OPTISCALER=1 game %command%', 79.6),
  g('Sekiro: Shadows Die Twice',   814380,  true,  'cachyos', 'game_xwayland %command%', 14.8),
  g('Dark Souls III',              374320,  false, 'default', '', 0),
  g('Death Stranding',             1190460, true,  'cachyos', 'PROTON_ENABLE_WAYLAND=1 PROTON_ENABLE_HDR=1 DXVK_HDR=1 game %command%', 66.3),
  g('Control Ultimate Edition',    870780,  true,  'p90',     'PROTON_LOG=1 game %command%', 42),
  g('Returnal',                    1649240, false, 'default', '', 0),
  g('God of War',                  1593500, true,  'cachyos', 'PROTON_USE_OPTISCALER=1 game %command%', 70.8),
  g('Horizon Zero Dawn',           1151640, true,  'p90',     'mangohud game %command%', 67.5),
  g('Hades',                       1145360, true,  'default', 'game %command%', 8.1),
  g('Celeste',                     504230,  true,  'default', '', 1.2),
  g('Disco Elysium',               632470,  false, 'default', '', 0),
  g('Cyberpunk: Phantom Liberty',  2138330, true,  'cachyos', 'PROTON_DLSS_UPGRADE=1 PROTON_USE_OPTISCALER=1 game %command%', 33.2),
  g('Monster Hunter: World',       582010,  true,  'exp',     'gamescope_proton %command%', 51.7),
  g('Cuphead',                     268910,  true,  'default', '', 4),
  g('Hollow Knight',               367520,  true,  'default', 'game %command%', 1.4),
  g('Resident Evil 4',             2050650, true,  'cachyos', 'PROTON_ENABLE_WAYLAND=1 PROTON_ENABLE_HDR=1 DXVK_HDR=1 game %command%', 67),
  g('Lies of P',                   1627720, false, 'default', '', 0),
  g('Deep Rock Galactic',          548430,  true,  'p90',     'mangohud game %command%', 7.8),
  g('Vampire Survivors',           1794680, true,  'default', '', 0.3),
  g('Armored Core VI',             1888160, true,  'cachyos', 'game_xwayland %command%', 58),
  g('Persona 5 Royal',             1687950, true,  'exp',     'game %command%', 36.5),
  g('Balatro',                     2379780, true,  'default', '', 0.2),
  g('Nier: Automata',              524220,  true,  'p90',     'PROTON_LOG=1 game_xwayland %command%', 48.3),
  g('Outer Wilds',                 753640,  false, 'default', '', 0),
  g('Half-Life: Alyx',             546560,  true,  'exp',     'game %command%', 49),
  g('终末地 · Endfield',           2776660, true,  'cachyos', 'gamescope_native %command%', 24.6),
];

// --- helpers ---------------------------------------------------------------
function parseWrapper(launch) {
  if (!launch?.trim()) return 'none';
  const l = launch.toLowerCase();
  if (l.includes('gamescope')) return 'gamescope';
  if (l.includes('xwayland')) return 'xwayland';
  if (l.includes('proton_enable_wayland')) return 'native';
  if (/=|mangohud|gamemoderun/.test(l)) return 'other';
  return 'none';
}

// split a launch line into colored tokens (env=KEY=VAL, cmd=%command%, plain)
function tokenizeLaunch(launch) {
  if (!launch) return [];
  return launch.split(/(\s+)/).map((tok) => {
    if (/^\s+$/.test(tok)) return { t: 'sp', v: tok };
    if (tok === '%command%') return { t: 'cmd', v: tok };
    if (tok.includes('=')) return { t: 'env', v: tok };
    return { t: 'plain', v: tok };
  });
}

function HiLaunch({ value }) {
  const toks = tokenizeLaunch(value);
  return (
    <>{toks.map((tk, i) => {
      if (tk.t === 'sp') return tk.v;
      const cls = { cmd: 'cmd', env: 'env' }[tk.t] || '';
      return <span key={`${i}-${tk.v}`} className={cls}>{tk.v}</span>;
    })}</>
  );
}

const LIBRARY_PATH = '~/.steam/steam';

const compatName = (id) => (COMPAT_TOOLS.find((c) => c.id === id) || COMPAT_TOOLS[0]).name;

// Replace the compat-tool catalog in place (preserves the live binding that
// compatName() and <CompatPicker> read from) once the backend reports real tools.
function setCompatTools(list) {
  if (!Array.isArray(list) || list.length === 0) return;
  COMPAT_TOOLS.length = 0;
  list.forEach((t) => COMPAT_TOOLS.push(t));
}

export {
  COMPAT_TOOLS, GAMES,
  parseWrapper, tokenizeLaunch, HiLaunch, LIBRARY_PATH, compatName, setCompatTools,
};
