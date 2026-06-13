// catalogue-data.ts - the building-block catalogue, the tool registry, compose/parse/validate.
// The launch line is ONE ordered Pill[]: env + tool pills, a fixed `command` divider pill, then
// `arg` pills (post-command game arguments). The "wrapper" concept is gone - %command% is owned by
// nothing. The persisted preset is a launch STRING (see store.rs); pills are a derived editing view
// bridged by parseLine (string -> pills) and composeLine (pills -> string).
import type {
  Category, CatalogueItem, ChoiceItem, InputItem, ToggleItem, ToolItem,
  ToolDef, ToolCfg, GameArgGroup,
  Pill, ChoicePill, InputPill, TokenPill, ToolPill, CommandPill, ArgPill,
  Issue, Validation, ValidationLevel,
} from "./types";

/* ============================================================
   CATEGORIES - namespace browse + intent search (the catalogue search box covers
   cross-cutting discovery like "hdr"). The "Wrapper" category is gone.
   ============================================================ */
const CATEGORIES: Category[] = [
  { id: 'proton', name: 'Proton', icon: 'cpu' },
  { id: 'dxvk',   name: 'DXVK',   icon: 'zap' },
  { id: 'vkd3d',  name: 'VKD3D',  icon: 'box' },
  { id: 'nvidia', name: 'NVIDIA', icon: 'monitor' },
  { id: 'tools',  name: 'Tools',  icon: 'gauge' },
  { id: 'system', name: 'System & GPU', icon: 'sliders' },
  { id: 'args',   name: 'Game arguments', icon: 'terminal', post: true },
  { id: 'custom', name: 'Custom', icon: 'wand' },
];

/* ============================================================
   TOOLS registry (each tool pill opens the schema-driven popover)
   ============================================================ */
const GS_FILTER = [{ value: 'none', label: 'default' }, { value: 'linear', label: 'linear' }, { value: 'nearest', label: 'nearest' }, { value: 'fsr', label: 'FSR' }, { value: 'nis', label: 'NIS' }, { value: 'pixel', label: 'pixel' }];
const GS_SCALER = [{ value: 'none', label: 'default' }, { value: 'auto', label: 'auto' }, { value: 'integer', label: 'integer' }, { value: 'fit', label: 'fit' }, { value: 'fill', label: 'fill' }, { value: 'stretch', label: 'stretch' }];
const GS_BACKEND = [{ value: 'auto', label: 'auto' }, { value: 'drm', label: 'drm' }, { value: 'sdl', label: 'sdl' }, { value: 'wayland', label: 'wayland' }, { value: 'openvr', label: 'openvr' }];
const MH_POSITION = [{ value: 'default', label: 'top-left' }, { value: 'top-right', label: 'top-right' }, { value: 'bottom-left', label: 'bottom-left' }, { value: 'bottom-right', label: 'bottom-right' }, { value: 'top-center', label: 'top-center' }];
const MH_PRESET = [{ value: '', label: 'none' }, { value: '0', label: '0 - FPS' }, { value: '1', label: '1 - +frametime' }, { value: '2', label: '2 - +CPU/GPU' }, { value: '3', label: '3 - detailed' }, { value: '4', label: '4 - full' }];

const TOOLS: ToolDef[] = [
  {
    id: 'gamescope', name: 'gamescope', icon: 'gamepad', compile: 'flags', prefix: 'gamescope', pinnedLast: true,
    desc: 'Micro-compositor. HDR, VRR, upscaling and the Steam overlay together.',
    invocation: 'gamescope [flags] -- %command%',
    configNote: 'Any flag the controls do not cover. Inserted before the -- terminator.',
    sections: [
      { id: 'output', label: 'Output', controls: [
        { key: 'W', flag: '-W', label: 'Output width', type: 'number', placeholder: '3840' },
        { key: 'H', flag: '-H', label: 'Output height', type: 'number', placeholder: '2160' },
        { key: 'w', flag: '-w', label: 'Game width', type: 'number', placeholder: 'auto' },
        { key: 'h', flag: '-h', label: 'Game height', type: 'number', placeholder: 'auto' },
        { key: 'r', flag: '-r', label: 'Refresh Hz', type: 'number', placeholder: '240' },
        { key: 'o', flag: '-o', label: 'Unfocused FPS', type: 'number', placeholder: '60' },
      ] },
      { id: 'display', label: 'Display', controls: [
        { key: 'f', flag: '-f', label: 'Fullscreen', type: 'toggle' },
        { key: 'b', flag: '-b', label: 'Borderless', type: 'toggle' },
        { key: 'adaptive-sync', flag: '--adaptive-sync', label: 'Adaptive sync (VRR)', type: 'toggle' },
      ] },
      { id: 'upscaling', label: 'Upscaling', controls: [
        { key: 'F', flag: '-F', label: 'Filter', type: 'choice', choices: GS_FILTER, noneValue: 'none' },
        { key: 'S', flag: '-S', label: 'Scaler', type: 'choice', choices: GS_SCALER, noneValue: 'none' },
        { key: 'sharpness', flag: '--sharpness', label: 'Sharpness', type: 'number', placeholder: '0-20' },
      ] },
      { id: 'hdr', label: 'HDR', controls: [
        { key: 'hdr-enabled', flag: '--hdr-enabled', label: 'HDR enabled', type: 'toggle' },
        { key: 'hdr-itm-enabled', flag: '--hdr-itm-enabled', label: 'Tone-map SDR to HDR', type: 'toggle' },
        { key: 'hdr-debug-force-output', flag: '--hdr-debug-force-output', label: 'Force HDR output', type: 'toggle' },
        { key: 'force-grab-cursor', flag: '--force-grab-cursor', label: 'Force grab cursor', type: 'toggle' },
      ] },
      { id: 'integration', label: 'Integration', controls: [
        { key: 'mangoapp', flag: '--mangoapp', label: 'MangoHud overlay', type: 'toggle', hint: 'Preferred over a mangohud prefix' },
        { key: 'e', flag: '-e', label: 'Steam integration', type: 'toggle' },
        { key: 'rt', flag: '--rt', label: 'Realtime priority', type: 'toggle' },
        { key: 'backend', flag: '--backend', label: 'Backend', type: 'choice', choices: GS_BACKEND, noneValue: 'auto' },
      ] },
    ],
  },
  {
    id: 'mangohud', name: 'MangoHud', icon: 'gauge', compile: 'env-config', prefix: 'mangohud',
    desc: 'Performance overlay, configured through the MANGOHUD_CONFIG environment variable.',
    invocation: 'MANGOHUD_CONFIG=... mangohud %command%',
    configNote: 'Raw MANGOHUD_CONFIG entries, comma-separated. Appended to the config above.',
    sections: [
      { id: 'overlay', label: 'Overlay', controls: [
        { key: 'preset', cfgKey: 'preset', label: 'Preset', type: 'choice', choices: MH_PRESET, noneValue: '' },
        { key: 'fps_limit', cfgKey: 'fps_limit', label: 'FPS limit', type: 'number', placeholder: 'off' },
        { key: 'position', cfgKey: 'position', label: 'Position', type: 'choice', choices: MH_POSITION, noneValue: 'default' },
      ] },
      { id: 'metrics', label: 'Metrics', controls: [
        { key: 'cpu_temp', cfgKey: 'cpu_temp', label: 'CPU temp', type: 'toggle' },
        { key: 'gpu_temp', cfgKey: 'gpu_temp', label: 'GPU temp', type: 'toggle' },
        { key: 'frame_timing', cfgKey: 'frame_timing', label: 'Frame timing graph', type: 'toggle' },
      ] },
    ],
  },
  {
    id: 'vkbasalt', name: 'vkBasalt', icon: 'eye', compile: 'env-toggle',
    desc: 'Vulkan post-processing layer (CAS sharpen, FXAA, SMAA, LUTs).',
    invocation: 'ENABLE_VKBASALT=1 %command%',
    configNote: 'Extra ENABLE_* or VKBASALT_* env entries.',
    sections: [
      { id: 'config', label: 'Configuration', controls: [
        { key: 'config', label: 'Config file path', type: 'text', placeholder: 'default config', hint: 'Optional override path.' },
      ] },
    ],
  },
  {
    id: 'gamemoderun', name: 'gamemoderun', icon: 'cpu', compile: 'none', prefix: 'gamemoderun',
    desc: 'Feral GameMode: CPU governor + GPU performance tweaks for the session.',
    invocation: 'gamemoderun %command%',
    configNote: 'GameMode has no per-launch flags. Anything here is appended verbatim.',
    sections: [],
  },
  {
    id: 'game-performance', name: 'game-performance', icon: 'zap', compile: 'none', prefix: 'game-performance',
    desc: 'CachyOS performance power profile for the duration of the game.',
    invocation: 'game-performance %command%',
    configNote: 'No per-launch flags. Anything here is appended verbatim.',
    sections: [],
  },
];
const TOOL_BY_ID: Record<string, ToolDef> = Object.fromEntries(TOOLS.map((t) => [t.id, t]));

function toolDefaults(tool: ToolDef): ToolCfg {
  const cfg: ToolCfg = {};
  tool.sections.forEach((s) => s.controls.forEach((c) => { cfg[c.key] = c.type === 'toggle' ? false : (c.noneValue ?? ''); }));
  return cfg;
}
const GS_NICE: ToolCfg = { W: '3840', H: '2160', r: '240', f: true, 'adaptive-sync': true, 'hdr-enabled': true };

/* ============================================================
   CATALOGUE - env building blocks + tool blocks (args are picked from GAME_ARGS)
   ============================================================ */
const ENV_ITEMS: (ToggleItem | ChoiceItem | InputItem)[] = [
  /* ---- PROTON ---- */
  { id: 'p_wayland', cat: 'proton', kind: 'toggle', token: 'PROTON_ENABLE_WAYLAND=1', name: 'PROTON_ENABLE_WAYLAND', desc: 'Native winewayland backend instead of XWayland.' },
  { id: 'p_hdr', cat: 'proton', kind: 'toggle', token: 'PROTON_ENABLE_HDR=1', name: 'PROTON_ENABLE_HDR', desc: 'Emit a real HDR surface.' },
  { id: 'p_ntsync', cat: 'proton', kind: 'toggle', token: 'PROTON_USE_NTSYNC=1', name: 'PROTON_USE_NTSYNC', desc: 'Lower-overhead NTSync sync primitives.' },
  { id: 'p_log', cat: 'proton', kind: 'toggle', token: 'PROTON_LOG=1', name: 'PROTON_LOG', desc: 'Write a Proton debug log to $HOME.' },
  { id: 'p_fsr4', cat: 'proton', kind: 'toggle', token: 'PROTON_FSR4_UPGRADE=1', name: 'PROTON_FSR4_UPGRADE', desc: 'Upgrade games from FSR 3.1 to FSR 4 (RDNA4).' },
  { id: 'p_fsr4_rdna3', cat: 'proton', kind: 'toggle', token: 'PROTON_FSR4_RDNA3_UPGRADE=1', name: 'PROTON_FSR4_RDNA3_UPGRADE', desc: 'FSR 4 upgrade path for RDNA3 (RX 7000).' },
  { id: 'p_fsr4_ind', cat: 'proton', kind: 'toggle', token: 'PROTON_FSR4_INDICATOR=1', name: 'PROTON_FSR4_INDICATOR', desc: 'Top-left watermark confirming the FSR 4 upgrade is active.' },
  { id: 'p_opti', cat: 'proton', kind: 'toggle', token: 'PROTON_USE_OPTISCALER=1', name: 'PROTON_USE_OPTISCALER', desc: 'OptiScaler: feed FSR4 into DLSS/XeSS-only games.' },
  { id: 'p_opti_name', cat: 'proton', kind: 'choice', key: 'PROTON_OPTISCALER_NAME', name: 'PROTON_OPTISCALER_NAME', desc: 'Proxy DLL OptiScaler injects through.', choices: ['dxgi.dll', 'd3d12.dll', 'dbghelp.dll'], default: 'dxgi.dll' },
  { id: 'p_dlss', cat: 'proton', kind: 'toggle', token: 'PROTON_DLSS_UPGRADE=1', name: 'PROTON_DLSS_UPGRADE', desc: 'Upgrade a game’s bundled DLSS DLLs (NVIDIA).' },
  { id: 'p_dlss_ind', cat: 'proton', kind: 'toggle', token: 'PROTON_DLSS_INDICATOR=1', name: 'PROTON_DLSS_INDICATOR', desc: 'Bottom-left DLSS overlay (NVIDIA).' },
  { id: 'p_xess', cat: 'proton', kind: 'toggle', token: 'PROTON_XESS_UPGRADE=1', name: 'PROTON_XESS_UPGRADE', desc: 'Upgrade a game’s bundled Intel XeSS DLLs.' },
  { id: 'p_nofsync', cat: 'proton', kind: 'toggle', token: 'PROTON_NO_FSYNC=1', name: 'PROTON_NO_FSYNC', desc: 'Disable fsync (troubleshooting).' },
  { id: 'p_wined3d', cat: 'proton', kind: 'toggle', token: 'PROTON_USE_WINED3D=1', name: 'PROTON_USE_WINED3D', desc: 'OpenGL wined3d instead of DXVK.' },
  { id: 'p_precomp', cat: 'proton', kind: 'toggle', token: 'PROTON_PRECOMPILE_SHADERS=1', name: 'PROTON_PRECOMPILE_SHADERS', desc: 'Pre-compile shaders at launch.' },
  { id: 'p_laa', cat: 'proton', kind: 'toggle', token: 'PROTON_FORCE_LARGE_ADDRESS_AWARE=0', name: 'PROTON_FORCE_LARGE_ADDRESS_AWARE', desc: 'Turn OFF the default large-address-aware patch.' },
  { id: 'p_nonvapi', cat: 'proton', kind: 'toggle', token: 'PROTON_DISABLE_NVAPI=1', name: 'PROTON_DISABLE_NVAPI', desc: 'Disable NVAPI/DLSS support library.' },
  { id: 'p_hidenv', cat: 'proton', kind: 'toggle', token: 'PROTON_HIDE_NVIDIA_GPU=1', name: 'PROTON_HIDE_NVIDIA_GPU', desc: 'Report NVIDIA GPUs as AMD (fix NVIDIA-only paths).' },
  { id: 'p_winefsr', cat: 'proton', kind: 'toggle', token: 'WINE_FULLSCREEN_FSR=1', name: 'WINE_FULLSCREEN_FSR', desc: 'Older spatial FSR1 fullscreen upscaler (not FSR4).' },
  { id: 'p_winefsr_str', cat: 'proton', kind: 'input', key: 'WINE_FULLSCREEN_FSR_STRENGTH', name: 'WINE_FULLSCREEN_FSR_STRENGTH', desc: 'FSR1 sharpening strength (0 sharpest, 5 softest).', inputType: 'number', placeholder: '2', default: '2' },

  /* ---- DXVK ---- */
  { id: 'd_hdr', cat: 'dxvk', kind: 'toggle', token: 'DXVK_HDR=1', name: 'DXVK_HDR', desc: 'HDR for DX / vkd3d. Required for DX12 HDR.' },
  { id: 'd_fps', cat: 'dxvk', kind: 'input', key: 'DXVK_FRAME_RATE', name: 'DXVK_FRAME_RATE', desc: 'Frame-rate cap.', inputType: 'number', placeholder: '60', default: '60' },
  { id: 'd_hud', cat: 'dxvk', kind: 'choice', key: 'DXVK_HUD', name: 'DXVK_HUD', desc: 'DXVK on-screen HUD.', choices: ['fps', 'full', 'devinfo', 'off'], default: 'fps' },
  { id: 'd_log', cat: 'dxvk', kind: 'choice', key: 'DXVK_LOG_LEVEL', name: 'DXVK_LOG_LEVEL', desc: 'DXVK log verbosity.', choices: ['none', 'error', 'warn', 'info', 'debug'], default: 'warn' },
  { id: 'd_async', cat: 'dxvk', kind: 'toggle', token: 'DXVK_ASYNC=1', name: 'DXVK_ASYNC', desc: 'Async pipeline compilation (legacy forks).' },
  { id: 'd_configfile', cat: 'dxvk', kind: 'input', key: 'DXVK_CONFIG_FILE', name: 'DXVK_CONFIG_FILE', desc: 'Path to a dxvk.conf.', inputType: 'path', placeholder: '~/dxvk.conf', default: '' },

  /* ---- VKD3D ---- */
  { id: 'v_debug', cat: 'vkd3d', kind: 'choice', key: 'VKD3D_DEBUG', name: 'VKD3D_DEBUG', desc: 'vkd3d-proton debug level.', choices: ['none', 'err', 'warn', 'info', 'trace'], default: 'none' },
  { id: 'v_cache', cat: 'vkd3d', kind: 'input', key: 'VKD3D_SHADER_CACHE_PATH', name: 'VKD3D_SHADER_CACHE_PATH', desc: 'Shader cache path, or 0 to disable.', inputType: 'path', placeholder: '~/.cache/vkd3d', default: '' },
  { id: 'v_config', cat: 'vkd3d', kind: 'input', key: 'VKD3D_CONFIG', name: 'VKD3D_CONFIG', desc: 'Comma-separated feature flags (e.g. dxr11,no_upload_hvv).', inputType: 'text', placeholder: 'dxr11', default: '' },
  { id: 'v_present', cat: 'vkd3d', kind: 'input', key: 'VKD3D_SWAPCHAIN_PRESENT_MODE', name: 'VKD3D_SWAPCHAIN_PRESENT_MODE', desc: 'Override the swapchain present mode.', inputType: 'text', placeholder: '', default: '' },

  /* ---- NVIDIA (the __GL_* ones are OpenGL-only - no effect on Vulkan/DXVK) ---- */
  { id: 'n_offload', cat: 'nvidia', kind: 'toggle', token: '__NV_PRIME_RENDER_OFFLOAD=1', name: '__NV_PRIME_RENDER_OFFLOAD', desc: 'Run on the discrete NVIDIA GPU (hybrid laptops).' },
  { id: 'n_glx', cat: 'nvidia', kind: 'choice', key: '__GLX_VENDOR_LIBRARY_NAME', name: '__GLX_VENDOR_LIBRARY_NAME', desc: 'GLX vendor; pair with PRIME offload.', choices: ['nvidia', 'mesa'], default: 'nvidia' },
  { id: 'n_optimus', cat: 'nvidia', kind: 'choice', key: '__VK_LAYER_NV_optimus', name: '__VK_LAYER_NV_optimus', desc: 'Pin Vulkan enumeration to one GPU on hybrid systems.', choices: ['NVIDIA_only', 'non_NVIDIA_only'], default: 'NVIDIA_only' },
  { id: 'n_threaded', cat: 'nvidia', kind: 'toggle', token: '__GL_THREADED_OPTIMIZATIONS=1', name: '__GL_THREADED_OPTIMIZATIONS', desc: 'OpenGL-only: offload GL driver work to a thread.' },
  { id: 'n_vblank', cat: 'nvidia', kind: 'toggle', token: '__GL_SYNC_TO_VBLANK=0', name: '__GL_SYNC_TO_VBLANK', desc: 'OpenGL-only: disable GL vsync.' },
  { id: 'n_shadercache', cat: 'nvidia', kind: 'toggle', token: '__GL_SHADER_DISK_CACHE=0', name: '__GL_SHADER_DISK_CACHE', desc: 'OpenGL-only: disable the GL shader disk cache.' },
  { id: 'n_maxframes', cat: 'nvidia', kind: 'choice', key: '__GL_MaxFramesAllowed', name: '__GL_MaxFramesAllowed', desc: 'OpenGL-only: frames the GL driver may queue (1 = low latency).', choices: ['1', '2', '3'], default: '2' },
  { id: 'n_ngxdebug', cat: 'nvidia', kind: 'input', key: 'DXVK_NVAPI_SET_NGX_DEBUG_OPTIONS', name: 'DXVK_NVAPI_SET_NGX_DEBUG_OPTIONS', desc: 'Force the DLSS / frame-gen on-screen indicators.', inputType: 'text', placeholder: 'DLSSIndicator=1024,DLSSGIndicator=2', default: '' },
  { id: 'n_ngxupdater', cat: 'nvidia', kind: 'toggle', token: 'PROTON_ENABLE_NGX_UPDATER=1', name: 'PROTON_ENABLE_NGX_UPDATER', desc: 'Let NGX auto-download updated DLSS models.' },

  /* ---- SYSTEM & GPU ---- */
  { id: 's_preload', cat: 'system', kind: 'input', key: 'LD_PRELOAD', name: 'LD_PRELOAD', desc: 'Preload path, or empty to clear an inherited value.', inputType: 'path', placeholder: '(empty)', default: '' },
  { id: 's_antilag', cat: 'system', kind: 'toggle', token: 'ENABLE_LAYER_MESA_ANTI_LAG=1', name: 'ENABLE_LAYER_MESA_ANTI_LAG', desc: 'Mesa AMD anti-lag layer.' },
  { id: 's_gswsi', cat: 'system', kind: 'toggle', token: 'ENABLE_GAMESCOPE_WSI=1', name: 'ENABLE_GAMESCOPE_WSI', desc: 'Gamescope WSI layer.' },
  { id: 's_nohdrwsi', cat: 'system', kind: 'toggle', token: 'DISABLE_HDR_WSI=1', name: 'DISABLE_HDR_WSI', desc: 'Disable HDR WSI (gamescope troubleshooting).' },
  { id: 's_hdrwsi', cat: 'system', kind: 'toggle', token: 'ENABLE_HDR_WSI=1', name: 'ENABLE_HDR_WSI', desc: 'Enable the HDR WSI layer.' },
  { id: 's_driprime', cat: 'system', kind: 'toggle', token: 'DRI_PRIME=1', name: 'DRI_PRIME', desc: 'Render on the secondary GPU (hybrid, Mesa).' },
  { id: 's_mesadev', cat: 'system', kind: 'input', key: 'MESA_VK_DEVICE_SELECT', name: 'MESA_VK_DEVICE_SELECT', desc: 'Pick a Vulkan device (vid:did, append ! to force).', inputType: 'text', placeholder: '1002:744c', default: '' },
  { id: 's_radvperf', cat: 'system', kind: 'input', key: 'RADV_PERFTEST', name: 'RADV_PERFTEST', desc: 'RADV experimental performance flags.', inputType: 'text', placeholder: '', default: '' },
  { id: 's_radvdebug', cat: 'system', kind: 'input', key: 'RADV_DEBUG', name: 'RADV_DEBUG', desc: 'RADV debug flags.', inputType: 'text', placeholder: '', default: '' },
  { id: 's_pulse', cat: 'system', kind: 'input', key: 'PULSE_LATENCY_MSEC', name: 'PULSE_LATENCY_MSEC', desc: 'PulseAudio latency in ms (audio crackle fix).', inputType: 'number', placeholder: '60', default: '' },
];

const CATALOGUE: CatalogueItem[] = [
  ...ENV_ITEMS,
  ...TOOLS.map((t): ToolItem => ({ id: 'tool_' + t.id, cat: 'tools', kind: 'tool', toolId: t.id, name: t.name, desc: t.desc })),
];
const CAT_BY_ID: Record<string, CatalogueItem> = Object.fromEntries(CATALOGUE.map((c) => [c.id, c]));

/* ============================================================
   GAME-ARGUMENT suggestions (post-command), grouped by engine
   ============================================================ */
const GAME_ARGS: GameArgGroup[] = [
  { group: 'Universal', args: [
    { text: '-novid', desc: 'Skip intro videos' }, { text: '-fullscreen', desc: 'Force fullscreen' },
    { text: '-windowed', desc: 'Force windowed' }, { text: '-w', desc: 'Width', value: true },
    { text: '-h', desc: 'Height', value: true }, { text: '-language', desc: 'Force UI language', value: true },
  ] },
  { group: 'Source / Source 2', args: [
    { text: '-novid', desc: 'Skip intro' }, { text: '-high', desc: 'High CPU priority' },
    { text: '-nojoy', desc: 'Disable joystick init' }, { text: '+fps_max', desc: 'FPS cap', value: true },
    { text: '+exec autoexec', desc: 'Run an autoexec.cfg' }, { text: '-console', desc: 'Enable the console' },
  ] },
  { group: 'Unreal', args: [
    { text: '-dx11', desc: 'Force DirectX 11' }, { text: '-dx12', desc: 'Force DirectX 12' },
    { text: '-ResX=', desc: 'Horizontal resolution', value: true }, { text: '-ResY=', desc: 'Vertical resolution', value: true },
    { text: '-nosplash', desc: 'Skip splash screen' },
  ] },
  { group: 'Unity', args: [
    { text: '-screen-fullscreen', desc: '0 or 1', value: true }, { text: '-screen-width', desc: 'Width', value: true },
    { text: '-screen-height', desc: 'Height', value: true }, { text: '-force-vulkan', desc: 'Force the Vulkan backend' },
  ] },
  { group: 'id Tech', args: [
    { text: '+set r_fullscreen 1', desc: 'Fullscreen' }, { text: '+com_skipIntroVideo 1', desc: 'Skip intro' },
    { text: '+r_swapInterval 0', desc: 'Disable vsync' },
  ] },
];

/* ============================================================
   Factories
   ============================================================ */
let _uid = 0;
const nextUid = (): string => 'pill' + (++_uid);

function makeTogglePill(item: ToggleItem): TokenPill {
  return { uid: nextUid(), itemId: item.id, cat: item.cat, name: item.name, kind: 'toggle', token: item.token };
}
function makeChoicePill(item: ChoiceItem, value: string = item.default): ChoicePill {
  return { uid: nextUid(), itemId: item.id, cat: item.cat, name: item.name, kind: 'choice', key: item.key, value, choices: item.choices };
}
function makeInputPill(item: InputItem, value: string = item.default): InputPill {
  return { uid: nextUid(), itemId: item.id, cat: item.cat, name: item.name, kind: 'input', key: item.key, value, inputType: item.inputType, placeholder: item.placeholder };
}
function makeToolPill(toolId: string, cfg?: ToolCfg, extra = ''): ToolPill {
  const tool = TOOL_BY_ID[toolId];
  const base = { ...toolDefaults(tool), ...(toolId === 'gamescope' ? GS_NICE : {}) };
  return { uid: nextUid(), itemId: 'tool_' + toolId, cat: 'tools', name: tool.name, kind: 'tool', toolId, cfg: cfg ?? base, extra };
}
function makeCustomPill(token: string): TokenPill {
  return { uid: nextUid(), itemId: 'custom', cat: 'custom', name: 'Custom', kind: 'custom', token };
}
function makeCommandPill(): CommandPill {
  return { uid: nextUid(), itemId: 'command', cat: 'command', name: '%command%', kind: 'command' };
}
function makeArgPill(text: string): ArgPill {
  return { uid: nextUid(), itemId: 'arg', cat: 'args', name: text, kind: 'arg', text };
}
function makePill(item: CatalogueItem): Pill {
  switch (item.kind) {
    case 'toggle': return makeTogglePill(item);
    case 'choice': return makeChoicePill(item);
    case 'input': return makeInputPill(item);
    case 'tool': return makeToolPill(item.toolId);
  }
}

const isEnvToken = (t: string): boolean => /^[A-Z_][A-Z0-9_]*=/.test(t);
const looksLikeArg = (t: string): boolean => /^[-+]/.test(t) && t !== '--';

// Split a free arg string into chips, keeping `+cvar value` and `-Flag= value` pairs together.
function tokenizeArgs(str: string): string[] {
  const toks = (str || '').trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const next = toks[i + 1];
    if (t.startsWith('+') && next && !/^[-+]/.test(next)) { out.push(t + ' ' + next); i++; }
    else if (t.endsWith('=') && next && !/^[-+]/.test(next)) { out.push(t + next); i++; }
    else out.push(t);
  }
  return out;
}

/* ============================================================
   Tool compile: pill -> { envs, prefixes }
   ============================================================ */
function compileTool(p: ToolPill): { envs: string[]; prefixes: string[] } {
  const tool = TOOL_BY_ID[p.toolId];
  const cfg = p.cfg || {};
  const extra = (p.extra || '').trim();
  const extraToks = extra ? extra.split(/\s+/).filter(Boolean) : [];

  if (tool.compile === 'flags') {
    const flags: string[] = [];
    tool.sections.forEach((s) => s.controls.forEach((c) => {
      const v = cfg[c.key];
      if (c.type === 'toggle') { if (v) flags.push(c.flag as string); }
      else if (c.type === 'choice') { if (v && v !== c.noneValue) flags.push(c.flag as string, String(v)); }
      else if (v !== '' && v != null) flags.push(c.flag as string, String(v));
    }));
    return { envs: [], prefixes: [tool.prefix as string, ...flags, ...extraToks, '--'] };
  }
  if (tool.compile === 'env-config') {
    const parts: string[] = [];
    tool.sections.forEach((s) => s.controls.forEach((c) => {
      const v = cfg[c.key];
      if (c.type === 'toggle') { if (v) parts.push(c.cfgKey as string); }
      else if (c.type === 'choice') { if (v && v !== c.noneValue) parts.push(`${c.cfgKey}=${v}`); }
      else if (v !== '' && v != null) parts.push(`${c.cfgKey}=${v}`);
    }));
    if (extra) parts.push(extra.replace(/^MANGOHUD_CONFIG=/, ''));
    const cfgStr = parts.join(',');
    return { envs: cfgStr ? [`MANGOHUD_CONFIG=${cfgStr}`] : [], prefixes: [tool.prefix as string] };
  }
  if (tool.compile === 'env-toggle') {
    const envs = ['ENABLE_VKBASALT=1'];
    if (cfg.config) envs.push(`VKBASALT_CONFIG_FILE=${cfg.config}`);
    extraToks.forEach((t) => { if (isEnvToken(t)) envs.push(t); });
    return { envs, prefixes: [] };
  }
  return { envs: [], prefixes: [tool.prefix as string, ...extraToks] };
}

function gamescopeSummary(cfg: ToolCfg): string[] {
  const bits: string[] = [];
  if (cfg.W && cfg.H) bits.push(`${cfg.W}x${cfg.H}`);
  if (cfg.r) bits.push(`${cfg.r}Hz`);
  if (cfg.F && cfg.F !== 'none') bits.push(String(cfg.F).toUpperCase());
  if (cfg['hdr-enabled']) bits.push('HDR');
  if (cfg['adaptive-sync']) bits.push('VRR');
  if (cfg.mangoapp) bits.push('mangoapp');
  return bits;
}
function mangohudSummary(cfg: ToolCfg): string[] {
  const bits: string[] = [];
  if (cfg.preset) bits.push('preset ' + cfg.preset);
  if (cfg.fps_limit) bits.push(cfg.fps_limit + ' fps');
  if (cfg.position && cfg.position !== 'default') bits.push(String(cfg.position));
  return bits;
}
function toolSummary(p: ToolPill): string {
  const cfg = p.cfg || {};
  if (p.toolId === 'gamescope') return gamescopeSummary(cfg).join(' · ');
  if (p.toolId === 'mangohud') return mangohudSummary(cfg).join(' · ');
  if (p.toolId === 'vkbasalt') return cfg.config ? 'custom config' : 'default';
  return '';
}

/* ============================================================
   COMPOSE - Pill[] (with the command divider) -> string
   ============================================================ */
function splitAtCommand(pills: Pill[]): { pre: Pill[]; post: Pill[] } {
  const ci = pills.findIndex((p) => p.kind === 'command');
  if (ci === -1) return { pre: pills.filter((p) => p.kind !== 'arg'), post: pills.filter((p) => p.kind === 'arg') };
  return { pre: pills.slice(0, ci), post: pills.slice(ci + 1) };
}
function orderedTools(pre: Pill[]): ToolPill[] {
  const tools = pre.filter((p): p is ToolPill => p.kind === 'tool');
  return tools.slice().sort((a, b) => (TOOL_BY_ID[a.toolId].pinnedLast ? 1 : 0) - (TOOL_BY_ID[b.toolId].pinnedLast ? 1 : 0));
}
function envToken(p: Pill): string {
  if (p.kind === 'toggle' || p.kind === 'custom') return p.token;
  if (p.kind === 'choice' || p.kind === 'input') return `${p.key}=${p.value ?? ''}`;
  return '';
}
function composeLine(pills: Pill[]): string {
  const { pre, post } = splitAtCommand(pills);
  const envs: string[] = [];
  const prefixes: string[] = [];
  pre.filter((p) => p.kind !== 'tool').forEach((p) => { const t = envToken(p); if (t) (isEnvToken(t) ? envs : prefixes).push(t); });
  orderedTools(pre).forEach((p) => { const { envs: e, prefixes: pf } = compileTool(p); e.forEach((x) => envs.push(x)); pf.forEach((x) => prefixes.push(x)); });
  const postToks = post.filter((p): p is ArgPill => p.kind === 'arg').map((p) => p.text);
  return [...envs, ...prefixes, '%command%', ...postToks].filter(Boolean).join(' ');
}

/* ============================================================
   VALIDATE - non-blocking issues + per-pill flags
   ============================================================ */
const STALE_TOKENS: Record<string, string> = {
  game: 'The "game" wrapper script is gone. %command% is now a fixed divider; build the line from blocks.',
  game_xwayland: 'The XWayland wrapper is gone. Drop PROTON_ENABLE_WAYLAND for the XWayland backend.',
  game_gamescope: 'The gamescope wrapper script is gone. Add the gamescope tool block instead.',
  gamescope_proton: 'Legacy wrapper script. Add the gamescope tool block instead.',
  gamescope_native: 'Legacy wrapper script. Add the gamescope tool block instead.',
  hdr_run: 'Deprecated HDR shim. Use PROTON_ENABLE_HDR + DXVK_HDR.',
};

function validateLine(finalStr: string, pills: Pill[]): Validation {
  const issues: Issue[] = [];
  const flagged: Record<string, Issue> = {};
  const tokens = finalStr.trim().split(/\s+/).filter(Boolean);
  const cmdCount = tokens.filter((t) => t === '%command%').length;

  if (cmdCount === 0) issues.push({ level: 'error', msg: 'No %command% token. The game has nowhere to run, restore the divider.' });
  else if (cmdCount > 1) issues.push({ level: 'error', msg: `${cmdCount}x %command%: it must appear exactly once.` });

  const toolIds = new Set(pills.filter((p): p is ToolPill => p.kind === 'tool').map((p) => p.toolId));
  if (toolIds.has('mangohud') && toolIds.has('gamescope')) {
    const mh = pills.find((p): p is ToolPill => p.kind === 'tool' && p.toolId === 'mangohud');
    if (mh) flagged[mh.uid] = { level: 'warn', msg: 'Stacked before gamescope. Use gamescope --mangoapp instead.' };
    issues.push({ level: 'warn', msg: 'mangohud runs outside gamescope here. Prefer gamescope --mangoapp for a correct overlay.' });
  }

  let hasMisplaced = false;
  pills.forEach((p) => {
    if (p.kind !== 'custom') return;
    if (looksLikeArg(p.token)) { flagged[p.uid] = { level: 'warn', msg: 'Looks like a game argument. It belongs after %command%.' }; hasMisplaced = true; }
    const k = p.token.replace(/=.*/, '');
    if (STALE_TOKENS[p.token] || STALE_TOKENS[k]) flagged[p.uid] = { level: 'warn', msg: STALE_TOKENS[p.token] || STALE_TOKENS[k] };
  });
  if (hasMisplaced) issues.push({ level: 'warn', msg: 'A pre-command token looks like a game argument. Move it after the %command% divider.' });

  const staleHits: string[] = [];
  tokens.forEach((t) => { const k = t.replace(/=.*/, ''); if (STALE_TOKENS[t]) staleHits.push(t); else if (STALE_TOKENS[k]) staleHits.push(k); });
  [...new Set(staleHits)].forEach((s) => { if (!issues.some((i) => i.msg.startsWith(s))) issues.push({ level: 'warn', msg: `${s}: ${STALE_TOKENS[s]}` }); });

  let level: ValidationLevel = 'ok';
  if (issues.some((i) => i.level === 'error')) level = 'error';
  else if (issues.some((i) => i.level === 'warn')) level = 'warn';
  return { issues, flagged, level, cmdCount };
}

/* ============================================================
   PARSE - raw string -> Pill[] (env + tool pills, command divider, arg pills)
   ============================================================ */
function parseGamescope(work: string[]): { pill: ToolPill; rest: string[] } | null {
  const gi = work.indexOf('gamescope');
  if (gi === -1) return null;
  const di = work.indexOf('--', gi);
  const flagToks = work.slice(gi + 1, di === -1 ? work.length : di);
  const tool = TOOL_BY_ID.gamescope;
  const cfg = toolDefaults(tool);
  const extras: string[] = [];
  for (let i = 0; i < flagToks.length; i++) {
    const f = flagToks[i];
    let matched = false;
    tool.sections.forEach((s) => s.controls.forEach((c) => {
      if (c.flag !== f) return;
      matched = true;
      if (c.type === 'toggle') cfg[c.key] = true;
      else { cfg[c.key] = flagToks[i + 1] ?? ''; i++; }
    }));
    if (!matched) extras.push(f);
  }
  const pill = makeToolPill('gamescope', cfg, extras.join(' '));
  const rest = work.slice(0, gi).concat(di === -1 ? [] : work.slice(di + 1));
  return { pill, rest };
}

function envTokenToPill(tok: string): Pill {
  const match = ENV_ITEMS.find((c) => {
    if (c.kind === 'toggle') return c.token === tok;
    if (c.kind === 'choice' || c.kind === 'input') return tok.startsWith(c.key + '=');
    return false;
  });
  if (!match) return makeCustomPill(tok);
  if (match.kind === 'choice') return makeChoicePill(match, tok.slice(match.key.length + 1));
  if (match.kind === 'input') return makeInputPill(match, tok.slice(match.key.length + 1));
  return makeTogglePill(match);
}

function parseLine(str: string | null | undefined): Pill[] {
  const tokens = (str || '').trim().split(/\s+/).filter(Boolean);
  const ci = tokens.indexOf('%command%');
  const before = ci === -1 ? tokens : tokens.slice(0, ci);
  const after = ci === -1 ? [] : tokens.slice(ci + 1);

  // pull a standalone MANGOHUD_CONFIG out first so it folds into the mangohud pill
  let mangoCfg: string | null = null;
  const work: string[] = [];
  before.forEach((t) => { if (t.startsWith('MANGOHUD_CONFIG=')) mangoCfg = t.slice('MANGOHUD_CONFIG='.length); else work.push(t); });

  const gs = parseGamescope(work);
  const rest = gs ? gs.rest : work;

  const envPills: Pill[] = [];
  const toolPills: ToolPill[] = [];
  rest.forEach((tok) => {
    const toolDef = TOOLS.find((t) => t.prefix === tok && t.id !== 'gamescope');
    if (toolDef) {
      if (toolDef.id === 'mangohud') {
        const cfg = toolDefaults(toolDef);
        let extra = '';
        if (mangoCfg !== null) {
          const leftover: string[] = [];
          mangoCfg.split(',').filter(Boolean).forEach((pair) => {
            const [k, v] = pair.split('=');
            const ctrl = toolDef.sections.flatMap((s) => s.controls).find((c) => c.cfgKey === k);
            if (ctrl) cfg[ctrl.key] = v ?? true; else leftover.push(pair);
          });
          extra = leftover.join(',');
          mangoCfg = null;
        }
        toolPills.push(makeToolPill('mangohud', cfg, extra));
      } else {
        toolPills.push(makeToolPill(toolDef.id));
      }
      return;
    }
    if (tok === 'ENABLE_VKBASALT=1') { if (!toolPills.some((p) => p.toolId === 'vkbasalt')) { toolPills.push(makeToolPill('vkbasalt')); } return; }
    if (tok.startsWith('VKBASALT_CONFIG_FILE=')) {
      const path = tok.slice('VKBASALT_CONFIG_FILE='.length);
      const vb = toolPills.find((p) => p.toolId === 'vkbasalt');
      if (vb) vb.cfg.config = path;
      else toolPills.push(makeToolPill('vkbasalt', { ...toolDefaults(TOOL_BY_ID.vkbasalt), config: path }));
      return;
    }
    envPills.push(envTokenToPill(tok));
  });
  if (mangoCfg !== null) envPills.push(makeCustomPill('MANGOHUD_CONFIG=' + mangoCfg));

  const argPills = tokenizeArgs(after.join(' ')).map((t) => makeArgPill(t));
  return [...envPills, ...toolPills, ...(gs ? [gs.pill] : []), makeCommandPill(), ...argPills];
}

export {
  CATEGORIES, CATALOGUE, CAT_BY_ID, ENV_ITEMS, TOOLS, TOOL_BY_ID, GAME_ARGS, GS_NICE,
  toolDefaults, nextUid,
  makePill, makeToolPill, makeCustomPill, makeCommandPill, makeArgPill,
  isEnvToken, looksLikeArg, tokenizeArgs, compileTool, toolSummary,
  splitAtCommand, orderedTools, composeLine, validateLine, parseLine, STALE_TOKENS,
};
