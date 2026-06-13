// builder.tsx - the shared structured builder (apply + preset contexts) and the unified presets list.
// The launch line is one ordered Pill[] with a fixed `command` divider; presets persist as launch
// STRINGS, parsed into pills on open and composed back on apply/save.
import { useState as bsS, useMemo as bsM, useCallback as bsC } from "react";
import { Icon } from "./icons";
import { PillLine, PreviewBlock } from "./pills";
import { Catalogue } from "./catalogue";
import {
  composeLine, validateLine, parseLine, makePill, makeCustomPill, makeCommandPill, makeArgPill,
  isEnvToken, nextUid,
} from "./catalogue-data";
import type {
  BuilderContext, Preset, PresetDraft, Pill, ToolPill, MixedLine, CatalogueItem,
} from "./types";

function miniClass(t: string): string {
  if (t === '%command%') return 'cmd';
  if (isEnvToken(t)) return 'env';
  if (/^[-+]/.test(t)) return 'arg';
  return '';
}

/* mono mini-highlighter for compact preset lines */
function MiniLine({ value }: Readonly<{ value: string }>) {
  const toks = (value || '').split(/(\s+)/);
  return <>{toks.map((t, i) => (/^\s+$/.test(t) ? t : <span key={`${i}-${t}`} className={miniClass(t)}>{t}</span>))}</>;
}

// A compact label for a block in the presets-list mini-pill row.
function blockLabel(b: Pill): string {
  if (b.kind === 'tool') return b.name;
  if (b.kind === 'choice' || b.kind === 'input') return `${b.key}=${b.value}`;
  return (b as { token?: string }).token ?? '';
}

function presetStatusHint(canSave: boolean, name: string, hasError: boolean): string {
  if (canSave) return 'Ready to save.';
  if (!name.trim()) return 'Name the preset to save.';
  if (hasError) return 'Fix errors before saving.';
  return 'Add building blocks to save.';
}

/* "Start from preset" dropdown list */
function StartFromPreset({ presets, onPick }: Readonly<{ presets: Preset[]; onPick: (p: Preset) => void }>) {
  return (
    <div className="mixed-list" style={{ marginTop: 0, marginBottom: 14, borderColor: 'var(--acc-line)' }}>
      {presets.length === 0 && <div className="mixed-row"><span className="mr-str" style={{ color: 'var(--tx-faint)' }}>No saved presets yet.</span></div>}
      {presets.map((p) => (
        <button type="button" key={p.id} className="mixed-row" style={{ cursor: 'pointer' }} onClick={() => onPick(p)}>
          <Icon name="bookmark" size={13} style={{ color: 'var(--acc)' }} />
          <span style={{ color: 'var(--tx-hi)', fontWeight: 500, fontSize: 12, minWidth: 130 }}>{p.name}</span>
          <span className="mr-str">{p.value}</span>
          <Icon name="cornerDownRight" size={13} style={{ color: 'var(--tx-faint)' }} />
        </button>
      ))}
    </div>
  );
}

/* mixed-selection detail (apply context, when selected games differ) */
function MixedLines({ mixedLines, targetCount }: Readonly<{ mixedLines: MixedLine[]; targetCount: number }>) {
  return (
    <div style={{ marginTop: 16 }}>
      <div className="canvas-block-label"><Icon name="alert" size={13} style={{ color: 'var(--warn)' }} />Current lines differ<span className="cbl-line" /></div>
      <div className="mixed-list">
        {mixedLines.slice(0, 5).map(([line, ct]) => (
          <div className="mixed-row" key={line || '(empty)'}>
            <span className="mr-ct">{ct}x</span>
            <span className="mr-str">{line || <span style={{ color: 'var(--tx-faint)' }}>empty</span>}</span>
          </div>
        ))}
        {mixedLines.length > 5 && <div className="mixed-row"><span className="mr-ct" /><span className="mr-str">+{mixedLines.length - 5} more…</span></div>}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--tx-faint)', marginTop: 8 }}>Applying overwrites all {targetCount} with the line above.</div>
    </div>
  );
}

// insert an env/tool pill just before the %command% divider
function insertPre(prev: Pill[], pill: Pill): Pill[] {
  const ci = prev.findIndex((p) => p.kind === 'command');
  if (ci === -1) return [...prev, pill, makeCommandPill()];
  return [...prev.slice(0, ci), pill, ...prev.slice(ci)];
}
// add a catalogue item: a tool/toggle already in the line toggles off, otherwise insert before %command%
function addItemToPills(prev: Pill[], item: CatalogueItem): Pill[] {
  if (item.kind === 'tool') {
    const ex = prev.find((p): p is ToolPill => p.kind === 'tool' && p.toolId === item.toolId);
    return ex ? prev.filter((p) => p.uid !== ex.uid) : insertPre(prev, makePill(item));
  }
  const ex = prev.find((p) => p.itemId === item.id);
  if (ex) return item.kind === 'toggle' ? prev.filter((p) => p.uid !== ex.uid) : prev;
  return insertPre(prev, makePill(item));
}
// append a game-arg chip after the %command% divider (adding the divider if missing)
function addArgToPills(prev: Pill[], text: string): Pill[] {
  const chip = makeArgPill(text);
  return prev.some((p) => p.kind === 'command') ? [...prev, chip] : [...prev, makeCommandPill(), chip];
}

/* header subtitle - apply vs preset context */
function BuilderHeaderSub({ isPreset, targetCount, mixedLines }: Readonly<{ isPreset: boolean; targetCount: number; mixedLines?: MixedLine[] }>) {
  if (isPreset) return <span>A preset is a saved launch line. Compose it below.</span>;
  return (
    <>
      <span>Applying to <b>{`${targetCount} game${targetCount === 1 ? '' : 's'}`}</b></span>
      {mixedLines && mixedLines.length > 1 && <span className="mix-badge"><Icon name="alert" size={11} />mixed selection</span>}
    </>
  );
}

/* footer actions - differ between the preset and apply contexts */
interface BuilderFooterProps {
  isPreset: boolean;
  context: BuilderContext;
  name: string;
  desc: string;
  finalStr: string;
  canSave: boolean;
  canApply: boolean;
  hasError: boolean;
  targetCount: number;
  pills: Pill[];
  onClose: () => void;
  onSavePreset: (p: PresetDraft) => void;
  onApply: (val: string) => void;
  onStartFromPreset?: (kind: string, pills: Pill[]) => void;
}
function BuilderFooter({ isPreset, context, name, desc, finalStr, canSave, canApply, hasError, targetCount, pills, onClose, onSavePreset, onApply, onStartFromPreset }: Readonly<BuilderFooterProps>) {
  if (isPreset) {
    return (
      <div className="builder-foot">
        <div style={{ fontSize: 11.5, color: 'var(--tx-faint)', whiteSpace: 'nowrap' }}>{presetStatusHint(canSave, name, hasError)}</div>
        <div className="bf-spacer" />
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!canSave} onClick={() => onSavePreset({ id: context.preset?.id, name: name.trim(), desc: desc.trim(), value: finalStr })}>
          <Icon name="save" size={14} />{context.preset?.id ? 'Save changes' : 'Save preset'}
        </button>
      </div>
    );
  }
  return (
    <div className="builder-foot">
      <button className="btn ghost" onClick={() => onStartFromPreset?.('save', pills)} title="Save this line as a reusable preset" disabled={!canApply}>
        <Icon name="bookmark" size={14} />Save as preset
      </button>
      <div className="bf-spacer" />
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!canApply} onClick={() => onApply(finalStr)}>
        <Icon name="check" size={14} />{`Apply to ${targetCount} game${targetCount === 1 ? '' : 's'}`}
      </button>
    </div>
  );
}

/* ============================================================
   BUILDER SURFACE - shared between contexts
   ============================================================ */
interface BuilderSurfaceProps {
  context: BuilderContext;
  presets: Preset[];
  onApply: (val: string) => void;
  onSavePreset: (p: PresetDraft) => void;
  onClose: () => void;
  onStartFromPreset?: (kind: string, pills: Pill[]) => void;
  mixedLines?: MixedLine[];
}
function BuilderSurface({ context, presets, onApply, onSavePreset, onClose, onStartFromPreset, mixedLines }: Readonly<BuilderSurfaceProps>) {
  const isPreset = context.mode === 'preset';

  const [pills, setPills] = bsS<Pill[]>(() =>
    context.initialPills?.length
      ? context.initialPills.map((p) => ({ ...p, uid: nextUid() }))
      : parseLine(''));
  const [rawMode, setRawMode] = bsS(false);
  const [rawText, setRawText] = bsS('');
  const [name, setName] = bsS(context.preset?.name || '');
  const [desc, setDesc] = bsS(context.preset?.desc || '');
  const [startOpen, setStartOpen] = bsS(false);

  const finalStr = bsM(() => (rawMode ? rawText : composeLine(pills)), [pills, rawMode, rawText]);
  const validation = bsM(() => validateLine(finalStr, pills), [finalStr, pills]);
  const setPillsAndExitRaw = (next: Pill[]) => { setPills(next); if (rawMode) setRawMode(false); };

  const addItem = bsC((item: CatalogueItem) => {
    setPills((prev) => addItemToPills(prev, item));
    if (rawMode) setRawMode(false);
  }, [rawMode]);
  const addCustom = bsC((tokenStr: string) => { setPills((prev) => insertPre(prev, makeCustomPill(tokenStr))); if (rawMode) setRawMode(false); }, [rawMode]);
  const addArg = bsC((text: string) => {
    setPills((prev) => addArgToPills(prev, text));
    if (rawMode) setRawMode(false);
  }, [rawMode]);

  const toggleRaw = () => {
    if (rawMode) { setPills(parseLine(rawText)); setRawMode(false); }
    else { setRawText(composeLine(pills)); setRawMode(true); }
  };

  const loadPreset = (preset: Preset) => {
    setPills(parseLine(preset.value));
    setRawMode(false); setStartOpen(false);
    if (isPreset && !name) { setName(preset.name); setDesc(preset.desc); }
  };

  const blocks = pills.filter((p) => p.kind !== 'command');
  const hasError = validation.level === 'error';
  // Track the active source of truth per mode (mirrors finalStr). Using a stale rawText here
  // would let Apply/Save fire on a bare %command% after a raw-edit session is cleared.
  const isEmpty = rawMode ? !rawText.trim() : blocks.length === 0;
  const canApply = !hasError && !isEmpty;
  const canSave = canApply && name.trim().length > 0;

  const targetCount = context.targets?.length || 0;
  let headerTitle = 'Set launch options';
  if (isPreset) headerTitle = context.preset?.id ? 'Edit preset' : 'New preset';

  return (
    <dialog className="modal-host" open aria-label={isPreset ? 'Preset editor' : 'Set launch options'}>
      <div className="builder-scrim">
        <button type="button" className="builder-backdrop" aria-label="Close" onClick={onClose} />
        <div className="builder">
          <div className="builder-head">
            <div className="bh-icon"><Icon name={isPreset ? 'bookmark' : 'terminal'} size={16} /></div>
            <div className="bh-titles">
              <div className="bh-title">{headerTitle}</div>
              <div className="bh-sub">
                <BuilderHeaderSub isPreset={isPreset} targetCount={targetCount} mixedLines={mixedLines} />
              </div>
            </div>
            <button className="icon-btn" onClick={onClose} style={{ marginLeft: 'auto' }}><Icon name="x" size={15} /></button>
          </div>

          <div className="builder-body">
            <div className="builder-canvas">
              <div className="canvas-scroll">
                {isPreset && (
                  <div className="preset-fields">
                    <div className="pf-row"><label htmlFor="preset-name">Name</label><input id="preset-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Native HDR" spellCheck={false} /></div>
                    <div className="pf-row"><label htmlFor="preset-desc">Description</label><input id="preset-desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What it does, when to use it" spellCheck={false} /></div>
                  </div>
                )}

                <div className="canvas-block-label">
                  <Icon name="layers" size={13} />Launch line<span className="cbl-ct">{blocks.length} block{blocks.length === 1 ? '' : 's'}</span>
                  <span className="cbl-line" />
                  <span className="cbl-act">
                    <button className="btn ghost" style={{ height: 24, padding: '0 8px', fontSize: 11 }} onClick={() => setStartOpen((v) => !v)}><Icon name="bookmark" size={12} />Start from preset</button>
                    {blocks.length > 0 && <button className="btn ghost" style={{ height: 24, padding: '0 8px', fontSize: 11 }} onClick={() => { setPills(parseLine('')); setRawMode(false); }}><Icon name="x" size={12} />Clear</button>}
                  </span>
                </div>

                {startOpen && <StartFromPreset presets={presets} onPick={loadPreset} />}

                <PillLine pills={pills} flagged={validation.flagged} onChange={setPillsAndExitRaw} />

                <PreviewBlock
                  finalStr={finalStr} validation={validation}
                  rawMode={rawMode} onToggleRaw={toggleRaw} rawText={rawText} onRawChange={setRawText}
                />

                {!isPreset && mixedLines && mixedLines.length > 1 && (
                  <MixedLines mixedLines={mixedLines} targetCount={targetCount} />
                )}
              </div>
            </div>

            <div className="builder-cat">
              <Catalogue pills={pills} onAdd={addItem} onAddCustom={addCustom} onAddArg={addArg} />
            </div>
          </div>

          <BuilderFooter
            isPreset={isPreset} context={context} name={name} desc={desc} finalStr={finalStr}
            canSave={canSave} canApply={canApply} hasError={hasError} targetCount={targetCount} pills={pills}
            onClose={onClose} onSavePreset={onSavePreset} onApply={onApply} onStartFromPreset={onStartFromPreset}
          />
        </div>
      </div>
    </dialog>
  );
}

/* ============================================================
   UNIFIED PRESETS LIST
   ============================================================ */
interface PresetsListProps {
  presets: Preset[];
  onNew: () => void;
  onEdit: (p: Preset) => void;
  onDuplicate: (p: Preset) => void;
  onDelete: (p: Preset) => void;
}
function PresetsList({ presets, onNew, onEdit, onDuplicate, onDelete }: Readonly<PresetsListProps>) {
  return (
    <div className="page">
      <div className="page-inner" style={{ maxWidth: 880 }}>
        <div className="page-head">
          <div>
            <h1>Presets</h1>
            <p>One unified list. A preset is a saved launch line, from a single block to a full stack.</p>
          </div>
          <div className="ph-actions">
            <button className="btn primary" onClick={() => onNew()}><Icon name="plus" size={14} />New preset</button>
          </div>
        </div>

        {presets.map((p) => {
          const parsed = parseLine(p.value);
          const blocks = parsed.filter((x) => x.kind !== 'command' && x.kind !== 'arg');
          const args = parsed.filter((x): x is Extract<Pill, { kind: 'arg' }> => x.kind === 'arg');
          const blockMeta = `${blocks.length} block${blocks.length === 1 ? '' : 's'}`;
          let argMeta = '';
          if (args.length) argMeta = ` · ${args.length} arg${args.length === 1 ? '' : 's'}`;
          return (
            <div className="preset-card" key={p.id}>
              <div className="pc-row">
                <div className="pc-ico"><Icon name="bookmark" size={15} /></div>
                <div className="pc-main">
                  <div className="pc-name">{p.name}<span className="pc-pillct">{blockMeta}{argMeta}</span></div>
                  <div className="pc-desc">{p.desc || <span style={{ color: 'var(--tx-faint)' }}>No description</span>}</div>
                  <div className="pc-mini">
                    {blocks.map((b) => (
                      <span className={'mini-pill' + (b.kind === 'tool' ? ' tool' : '')} key={b.uid}>{blockLabel(b)}</span>
                    ))}
                    <span className="mini-pill cmd">%command%</span>
                    {args.map((a) => <span className="mini-pill arg" key={a.uid}>{a.text}</span>)}
                  </div>
                  <div className="pc-line mono"><MiniLine value={p.value} /></div>
                </div>
                <div className="pc-acts">
                  <button className="icon-btn" title="Edit" onClick={() => onEdit(p)}><Icon name="edit" size={14} /></button>
                  <button className="icon-btn" title="Duplicate" onClick={() => onDuplicate(p)}><Icon name="copy" size={14} /></button>
                  <button className="icon-btn" title="Delete" onClick={() => onDelete(p)}><Icon name="trash" size={14} /></button>
                </div>
              </div>
            </div>
          );
        })}
        {presets.length === 0 && <div style={{ color: 'var(--tx-faint)', fontSize: 13, padding: '20px 0' }}>No presets yet. Create one to reuse a launch line across games.</div>}
      </div>
    </div>
  );
}

export { BuilderSurface, PresetsList, MiniLine };
