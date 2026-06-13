// types.ts - the Manifold frontend domain model.
// One unified concept: the catalogue holds building blocks; a launch line is an ordered
// list of pills with a fixed `command` divider pill (env + tool pills before it, game-arg
// pills after it). A preset is a saved line (stored as a string, see store.rs). Pills are a
// derived editing view bridged by parseLine (string -> pills) and composeLine (pills -> string).

/* ============================================================
   CATALOGUE
   ============================================================ */
export interface Category {
  id: string;
  name: string;
  icon: string;
  post?: boolean; // true for the post-command "Game arguments" category
}

export type CatalogueKind = 'toggle' | 'choice' | 'input' | 'tool';

interface CatalogueBase {
  id: string;
  cat: string;
  name: string;
  desc: string;
}
export interface ToggleItem extends CatalogueBase { kind: 'toggle'; token: string; }
export interface ChoiceItem extends CatalogueBase { kind: 'choice'; key: string; choices: string[]; default: string; }
export interface InputItem extends CatalogueBase { kind: 'input'; key: string; inputType: string; placeholder: string; default: string; }
export interface ToolItem extends CatalogueBase { kind: 'tool'; toolId: string; }

export type CatalogueItem = ToggleItem | ChoiceItem | InputItem | ToolItem;

/* ============================================================
   TOOL schema - a tool (mangohud/gamescope/...) is a command/env block with sub-controls
   ============================================================ */
export type CtrlType = 'number' | 'text' | 'toggle' | 'choice';
export interface CtrlChoice { value: string; label: string; }
export interface Ctrl {
  key: string;
  label: string;
  type: CtrlType;
  flag?: string;        // compile:'flags' tools - the CLI flag (e.g. -W, --hdr-enabled)
  cfgKey?: string;      // compile:'env-config' tools - the MANGOHUD_CONFIG key
  hint?: string;
  choices?: CtrlChoice[];
  noneValue?: string;   // the value that means "omit this control"
  placeholder?: string;
}
export interface ToolSection { id: string; label: string; controls: Ctrl[]; }
// how a tool's controls turn into launch tokens:
//   flags      -> CLI flags after the prefix, terminated by `--` (gamescope)
//   env-config -> serialised into one MANGOHUD_CONFIG=... env token + the prefix (mangohud)
//   env-toggle -> an ENABLE_*=1 env token, no prefix (vkBasalt)
//   none       -> just the prefix, no controls (gamemoderun, game-performance)
export type ToolCompile = 'flags' | 'env-config' | 'env-toggle' | 'none';
export interface ToolDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  invocation: string;
  prefix?: string;
  compile: ToolCompile;
  pinnedLast?: boolean; // gamescope owns the trailing `--`, so it must be the last prefix
  sections: ToolSection[];
  configNote: string;
}

// A tool pill's config: schema-keyed values (number/text strings, toggle/env booleans).
export type ToolCfg = Record<string, string | boolean>;

/* ============================================================
   PILLS - the derived editing view (discriminated on `kind`)
   ============================================================ */
export type PillKind = 'toggle' | 'choice' | 'input' | 'tool' | 'custom' | 'command' | 'arg';

interface PillBase {
  uid: string;
  itemId: string;
  cat: string;
  name: string;
}
export interface TokenPill extends PillBase { kind: 'toggle' | 'custom'; token: string; }
export interface ChoicePill extends PillBase { kind: 'choice'; key: string; value: string; choices: string[]; }
export interface InputPill extends PillBase { kind: 'input'; key: string; value: string; inputType: string; placeholder?: string; }
export interface ToolPill extends PillBase { kind: 'tool'; toolId: string; cfg: ToolCfg; extra: string; }
export interface CommandPill extends PillBase { kind: 'command'; }
export interface ArgPill extends PillBase { kind: 'arg'; text: string; }

export type Pill = TokenPill | ChoicePill | InputPill | ToolPill | CommandPill | ArgPill;

/* ============================================================
   VALIDATION
   ============================================================ */
export type IssueLevel = 'error' | 'warn';
export type ValidationLevel = 'ok' | 'warn' | 'error';

export interface Issue {
  level: IssueLevel;
  msg: string;
}
export interface Validation {
  issues: Issue[];
  flagged: Record<string, Issue>;
  level: ValidationLevel;
  cmdCount: number;
}

/* ============================================================
   GAME-ARGUMENT suggestions (post-command picker)
   ============================================================ */
export interface GameArg { text: string; desc: string; value?: boolean; }
export interface GameArgGroup { group: string; args: GameArg[]; }

/* ============================================================
   LIBRARY (mirrors the Rust backend DTOs)
   ============================================================ */
export type GameStatus = 'installed' | 'owned';

export interface Game {
  id: string;
  name: string;
  appid: string;
  status: GameStatus;
  compat: string;
  launch: string;
  sizeGB?: number;
}

export interface CompatTool {
  id: string;
  name: string;
  note: string;
}

export interface DiscoveredRoot {
  path: string;
  valid: boolean;
}

export interface LibraryDto {
  games?: Game[];
  compat_tools?: CompatTool[];
  steam_running?: boolean;
  steam_root?: string;
}

/* ============================================================
   PRESETS + SETTINGS (persisted by the backend)
   ============================================================ */
export interface Preset {
  id: string;
  name: string;
  desc: string;
  value: string;
}

export interface PresetStore {
  presets: Preset[];
}

// A preset being saved from the builder - id is absent until it is first persisted.
export interface PresetDraft {
  id?: string;
  name: string;
  desc: string;
  value: string;
}

export type WindowControlsPref = 'auto' | 'left' | 'right' | 'hidden';

export interface Settings {
  steam_root: string;
  silent_start: boolean;
  window_controls: WindowControlsPref;
  ui_scale: number;
  close_to_tray: boolean;
  start_minimized: boolean;
}

/* ============================================================
   BUILDER + UI surfaces
   ============================================================ */
export type BuilderMode = 'apply' | 'preset';

// mixed-selection summary: [launch line, occurrence count]
export type MixedLine = [string, number];

export interface BuilderContext {
  mode: BuilderMode;
  targets?: Game[];
  preset?: Preset | null;
  initialPills: Pill[];
  mixedLines?: MixedLine[];
}

// Minimal anchor rect for popovers - satisfied by a DOMRect or a hand-built {left,top,bottom}.
export interface AnchorRect {
  left: number;
  top: number;
  bottom: number;
}

export interface Backup {
  id: string;
  when: string;
  games: number;
  note: string;
}

export interface Command {
  id: string;
  group?: string;
  icon: string;
  name: string;
  hint?: string;
  run: () => void;
}

export type UndoKind = 'launch' | 'compat';
export interface UndoAction {
  kind: UndoKind;
  changes: Array<[string, string]>;
}

export type ToastKind = 'ok' | 'err';
export interface Toast {
  id: number;
  kind?: ToastKind;
  title: string;
  sub?: string;
  undo?: UndoAction;
  sticky?: boolean;
}

// A launch-line change: [appid, value]
export type Change = [string, string];

/* ============================================================
   TABLE: filtering + sorting
   ============================================================ */
export type FilterKey = 'installed' | 'owned' | 'custom' | 'forced';
export type Filters = Record<FilterKey, boolean>;
export type Counts = Record<FilterKey, number>;

export type SortDir = 'asc' | 'desc';
export interface SortState {
  col: string;
  dir: SortDir;
}

// Header tri-state checkbox: unchecked / checked / indeterminate.
export type CheckState = boolean | 'dash';
