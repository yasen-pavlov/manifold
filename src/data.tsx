// data.tsx - mock library + helpers (used when running outside Tauri, e.g. vite preview / tests).
import type { CompatTool, Game, GameStatus, Preset } from "./types";

export interface LaunchTok {
  t: 'sp' | 'cmd' | 'env' | 'plain';
  v: string;
}

const COMPAT_TOOLS: CompatTool[] = [
  { id: 'default',  name: 'Default',              note: 'No forced tool - Steam decides' },
  { id: 'exp',      name: 'Proton - Experimental', note: 'Bleeding-edge Valve build' },
  { id: 'p90',      name: 'Proton 9.0 (Beta)',     note: 'Stable 9.0 branch' },
  { id: 'cachyos',  name: 'proton-cachyos-slr',    note: 'CachyOS optimized + SLR runtime' },
  { id: 'luxt',     name: 'luxtorpeda',            note: 'Native engine replacements' },
];

// Example presets - mirror the repo seed (store.rs default_store). Used outside Tauri so the
// games table can demo preset-name tags; the real list comes from ~/.config/manifold/presets.json.
const NATIVE_HDR = 'PROTON_ENABLE_WAYLAND=1 PROTON_ENABLE_HDR=1 DXVK_HDR=1 %command%';
const MANGOHUD = 'mangohud %command%';
const GAMESCOPE_HDR = 'ENABLE_GAMESCOPE_WSI=1 DXVK_HDR=1 gamescope -W 3840 -H 2160 -r 240 -o 60 -f --adaptive-sync --hdr-enabled --mangoapp -- %command%';
const MOCK_PRESETS: Preset[] = [
  { id: 'ex_native', name: 'Native Wayland (HDR)', desc: 'Wayland-native HDR pipeline.', value: NATIVE_HDR },
  { id: 'ex_mangohud', name: 'MangoHud overlay', desc: 'Run under the MangoHud overlay.', value: MANGOHUD },
  { id: 'ex_gamescope', name: 'Gamescope 4K HDR', desc: '4K240 gamescope session, HDR + VRR.', value: GAMESCOPE_HDR },
];

// --- library ---------------------------------------------------------------
// status: 'installed' | 'owned'  ·  compat: COMPAT_TOOLS id
function g(name: string, appid: number, installed: boolean, compat: string, launch: string, sizeGB: number): Game {
  const status: GameStatus = installed ? 'installed' : 'owned';
  return { id: 'app' + appid, name, appid: String(appid), status, compat, launch, sizeGB };
}

const GAMES: Game[] = [
  g('Elden Ring',                  1245620, true,  'cachyos', 'PROTON_USE_OPTISCALER=1 %command%', 58.2),
  g('Cyberpunk 2077',              1091500, true,  'cachyos', NATIVE_HDR, 71.4),
  g("Baldur's Gate 3",            1086940, true,  'p90',     'mangohud %command% -skipmovies', 122.7),
  g('Helldivers 2',                553850,  true,  'exp',     GAMESCOPE_HDR, 38.9),
  g('The Witcher 3: Wild Hunt',    292030,  true,  'cachyos', NATIVE_HDR, 49.1),
  g('Hades II',                    1145350, true,  'exp',     '', 9.3),
  g('Red Dead Redemption 2',       1174180, true,  'cachyos', GAMESCOPE_HDR, 119),
  g('Hollow Knight: Silksong',     1030300, false, 'default', '', 0),
  g('Stardew Valley',              413150,  true,  'default', '', 0.9),
  g('Factorio',                    427520,  true,  'default', '', 2.1),
  g('DOOM Eternal',                782330,  true,  'p90',     'PROTON_USE_OPTISCALER=1 %command%', 79.6),
  g('Sekiro: Shadows Die Twice',   814380,  true,  'cachyos', 'PROTON_ENABLE_WAYLAND=1 %command%', 14.8),
  g('Dark Souls III',              374320,  false, 'default', '', 0),
  g('Death Stranding',             1190460, true,  'cachyos', NATIVE_HDR, 66.3),
  g('Control Ultimate Edition',    870780,  true,  'p90',     'PROTON_LOG=1 %command%', 42),
  g('Returnal',                    1649240, false, 'default', '', 0),
  g('God of War',                  1593500, true,  'cachyos', NATIVE_HDR, 70.8),
  g('Horizon Zero Dawn',           1151640, true,  'p90',     MANGOHUD, 67.5),
  g('Hades',                       1145360, true,  'default', '', 8.1),
  g('Celeste',                     504230,  true,  'default', '', 1.2),
  g('Disco Elysium',               632470,  false, 'default', '', 0),
  g('Cyberpunk: Phantom Liberty',  2138330, true,  'cachyos', 'PROTON_DLSS_UPGRADE=1 PROTON_USE_OPTISCALER=1 %command%', 33.2),
  g('Monster Hunter: World',       582010,  true,  'exp',     'DXVK_FRAME_RATE=60 mangohud %command%', 51.7),
  g('Cuphead',                     268910,  true,  'default', '', 4),
  g('Hollow Knight',               367520,  true,  'default', '', 1.4),
  g('Resident Evil 4',             2050650, true,  'cachyos', NATIVE_HDR, 67),
  g('Lies of P',                   1627720, false, 'default', '', 0),
  g('Deep Rock Galactic',          548430,  true,  'p90',     MANGOHUD, 7.8),
  g('Vampire Survivors',           1794680, true,  'default', '', 0.3),
  g('Armored Core VI',             1888160, true,  'cachyos', 'gamescope -W 2560 -H 1440 -r 165 -f --adaptive-sync -- %command% -dx12', 58),
  g('Persona 5 Royal',             1687950, true,  'exp',     '', 36.5),
  g('Balatro',                     2379780, true,  'default', '', 0.2),
  g('Nier: Automata',              524220,  true,  'p90',     'PROTON_LOG=1 mangohud %command%', 48.3),
  g('Outer Wilds',                 753640,  false, 'default', '', 0),
  g('Half-Life: Alyx',             546560,  true,  'exp',     NATIVE_HDR, 49),
  g('终末地 · Endfield',           2776660, true,  'cachyos', GAMESCOPE_HDR, 24.6),
];

// --- helpers ---------------------------------------------------------------
// The "pre-command" segment of a launch line, whitespace-normalised. Game arguments after
// %command% are ignored, so a preset line plus extra trailing args still matches the preset.
function preCommandKey(launch: string | null | undefined): string {
  const t = (launch || '').trim();
  if (!t) return '';
  const ci = t.indexOf('%command%');
  const pre = ci === -1 ? t : t.slice(0, ci);
  return pre.trim().split(/\s+/).filter(Boolean).join(' ');
}

// Match a game's launch line against the known presets by its pre-command segment.
function matchPresetForLaunch(launch: string | null | undefined, presets: Preset[]): Preset | null {
  const key = preCommandKey(launch);
  if (!key) return null;
  return presets.find((p) => preCommandKey(p.value) === key) ?? null;
}

// split a launch line into colored tokens (env=KEY=VAL, cmd=%command%, plain)
function tokenizeLaunch(launch: string): LaunchTok[] {
  if (!launch) return [];
  return launch.split(/(\s+)/).map((tok): LaunchTok => {
    if (/^\s+$/.test(tok)) return { t: 'sp', v: tok };
    if (tok === '%command%') return { t: 'cmd', v: tok };
    if (tok.includes('=')) return { t: 'env', v: tok };
    return { t: 'plain', v: tok };
  });
}

function HiLaunch({ value }: Readonly<{ value: string }>) {
  const toks = tokenizeLaunch(value);
  return (
    <>{toks.map((tk, i) => {
      if (tk.t === 'sp') return tk.v;
      const cls = tk.t === 'cmd' || tk.t === 'env' ? tk.t : '';
      return <span key={`${i}-${tk.v}`} className={cls}>{tk.v}</span>;
    })}</>
  );
}

const LIBRARY_PATH = '~/.steam/steam';

const compatName = (id: string): string => (COMPAT_TOOLS.find((c) => c.id === id) || COMPAT_TOOLS[0]).name;

// Replace the compat-tool catalog in place (preserves the live binding that
// compatName() and <CompatPicker> read from) once the backend reports real tools.
function setCompatTools(list: CompatTool[] | null | undefined): void {
  if (!Array.isArray(list) || list.length === 0) return;
  COMPAT_TOOLS.length = 0;
  list.forEach((t) => COMPAT_TOOLS.push(t));
}

export {
  COMPAT_TOOLS, GAMES, MOCK_PRESETS,
  matchPresetForLaunch, preCommandKey, tokenizeLaunch, HiLaunch, LIBRARY_PATH, compatName, setCompatTools,
};
