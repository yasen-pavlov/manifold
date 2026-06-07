// types.ts - the Manifold frontend domain model.
// One unified concept: the catalogue holds building blocks; a launch line is an ordered
// list of pills; a preset is a saved line (stored as a string, see store.rs). Pills are a
// derived editing view bridged by parseLine (string -> pills) and composeLine (pills -> string).

/* ============================================================
   CATALOGUE
   ============================================================ */
export interface Category {
  id: string;
  name: string;
  icon: string;
  accent?: boolean;
}

export type CatalogueKind = 'wrapper' | 'complex' | 'toggle' | 'tool' | 'choice' | 'input';

interface CatalogueBase {
  id: string;
  cat: string;
  name: string;
  desc: string;
}
export interface WrapperItem extends CatalogueBase { kind: 'wrapper'; head: string; }
export interface ComplexItem extends CatalogueBase { kind: 'complex'; head: string; }
export interface ToggleItem extends CatalogueBase { kind: 'toggle'; token: string; }
export interface ToolItem extends CatalogueBase { kind: 'tool'; token: string; }
export interface ChoiceItem extends CatalogueBase { kind: 'choice'; key: string; choices: string[]; default: string; }
export interface InputItem extends CatalogueBase { kind: 'input'; key: string; inputType: string; placeholder: string; default: string; }

export type CatalogueItem =
  | WrapperItem | ComplexItem | ToggleItem | ToolItem | ChoiceItem | InputItem;

/* ============================================================
   GAMESCOPE complex schema
   ============================================================ */
export interface GamescopeFlag {
  key: string;
  label: string;
  flag: string;
  type: string;
  placeholder: string;
  group: string;
}
export interface GamescopeToggle {
  key: string;
  label: string;
  flag: string;
  group: string;
}
export interface GamescopeEnv {
  key: string;
  label: string;
}
export interface GamescopeSchema {
  flags: GamescopeFlag[];
  toggles: GamescopeToggle[];
  envs: GamescopeEnv[];
}
// cfg keys are schema-driven (W/H/r/o strings; toggle + env keys booleans), so it is accessed
// dynamically by key - a Record keeps that ergonomic.
export type GamescopeCfg = Record<string, string | boolean>;

/* ============================================================
   PILLS - the derived editing view (discriminated on `kind`)
   ============================================================ */
export type PillKind = 'toggle' | 'tool' | 'custom' | 'choice' | 'input' | 'wrapper' | 'complex';

interface PillBase {
  uid: string;
  itemId: string;
  cat: string;
  name: string;
}
export interface TokenPill extends PillBase { kind: 'toggle' | 'tool' | 'custom'; token: string; }
export interface ChoicePill extends PillBase { kind: 'choice'; key: string; value: string; choices: string[]; }
export interface InputPill extends PillBase { kind: 'input'; key: string; value: string; inputType: string; placeholder?: string; }
export interface WrapperPill extends PillBase { kind: 'wrapper'; head: string; }
export interface ComplexPill extends PillBase { kind: 'complex'; cfg: GamescopeCfg; }

export type Pill = TokenPill | ChoicePill | InputPill | WrapperPill | ComplexPill;

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
