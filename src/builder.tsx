// builder.tsx - the shared structured builder (apply + preset contexts) and the unified presets list.
// Presets are stored as launch STRINGS; this surface parses a string into editable pills on open
// (via context.initialPills) and composes pills back to a string on apply/save.
import { useState as bsS, useMemo as bsM, useCallback as bsC } from "react";
import { Icon } from "./icons";
import { PillLine, PreviewBlock } from "./pills";
import { Catalogue } from "./catalogue";
import { composeLine, validateLine, parseLine, makePill, makeCustomPill, isEnvToken } from "./catalogue-data";
import type {
  BuilderContext, Preset, PresetDraft, Pill, MixedLine, CatalogueItem,
} from "./types";

const newUid = (): string => 'pill' + Math.random().toString(36).slice(2);

function miniClass(t: string): string {
  if (t === '%command%') return 'cmd';
  if (isEnvToken(t)) return 'env';
  return '';
}

/* mono mini-highlighter for compact preset lines */
function MiniLine({ value }: { value: string }) {
  const toks = (value || '').split(/(\s+)/);
  return <>{toks.map((t, i) => (/^\s+$/.test(t) ? t : <span key={`${i}-${t}`} className={miniClass(t)}>{t}</span>))}</>;
}

function presetStatusHint(canSave: boolean, name: string, hasError: boolean): string {
  if (canSave) return 'Ready to save.';
  if (!name.trim()) return 'Name the preset to save.';
  if (hasError) return 'Fix errors before saving.';
  return 'Add a wrapper to save.';
}

/* "Start from preset" dropdown list */
function StartFromPreset({ presets, onPick }: { presets: Preset[]; onPick: (p: Preset) => void }) {
  return (
    <div className="mixed-list" style={{ marginTop: 0, marginBottom: 14, borderColor: 'var(--acc-line)' }}>
      {presets.length === 0 && <div className="mixed-row"><span className="mr-str" style={{ color: 'var(--tx-faint)' }}>No saved presets yet.</span></div>}
      {presets.map((p) => (
        <button type="button" key={p.id} className="mixed-row" style={{ cursor: 'pointer' }} onClick={() => onPick(p)}>
          <Icon name="bookmark" size={13} style={{ color: 'var(--acc)' }} />
          <span style={{ color: 'var(--tx-hi)', fontWeight: 500, fontSize: 12, minWidth: 120 }}>{p.name}</span>
          <span className="mr-str">{p.value}</span>
          <Icon name="cornerDownRight" size={13} style={{ color: 'var(--tx-faint)' }} />
        </button>
      ))}
    </div>
  );
}

/* mixed-selection detail (apply context, when selected games differ) */
function MixedLines({ mixedLines, targetCount }: { mixedLines: MixedLine[]; targetCount: number }) {
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

/* footer actions - differ between preset and apply contexts */
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
function BuilderFooter({ isPreset, context, name, desc, finalStr, canSave, canApply, hasError, targetCount, pills, onClose, onSavePreset, onApply, onStartFromPreset }: BuilderFooterProps) {
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
function BuilderSurface({ context, presets, onApply, onSavePreset, onClose, onStartFromPreset, mixedLines }: BuilderSurfaceProps) {
  const isPreset = context.mode === 'preset';

  // initial pills
  const [pills, setPills] = bsS<Pill[]>(() => {
    if (context.initialPills) return context.initialPills.map((p) => ({ ...p, uid: p.uid || newUid() }));
    return [];
  });
  const [rawMode, setRawMode] = bsS(false);
  const [rawText, setRawText] = bsS('');
  const [name, setName] = bsS(context.preset?.name || '');
  const [desc, setDesc] = bsS(context.preset?.desc || '');
  const [startOpen, setStartOpen] = bsS(false);

  const finalStr = bsM(() => (rawMode ? rawText : composeLine(pills)), [pills, rawMode, rawText]);
  const validation = bsM(() => validateLine(finalStr, pills), [finalStr, pills]);

  const setPillsAndExitRaw = (next: Pill[]) => { setPills(next); if (rawMode) { setRawMode(false); } };

  // add a catalogue item
  const addItem = bsC((item: CatalogueItem) => {
    setPills((prev) => {
      // wrapper: replace existing wrapper
      if (item.kind === 'wrapper' || item.kind === 'complex') {
        const without = prev.filter((p) => p.kind !== 'wrapper' && p.kind !== 'complex');
        return [...without, makePill(item)];
      }
      // toggle/choice/input/tool: unique by itemId - toggle off if present
      const existing = prev.find((p) => p.itemId === item.id);
      if (existing) {
        if (item.kind === 'toggle' || item.kind === 'tool') return prev.filter((p) => p.uid !== existing.uid);
        return prev; // choice/input already there - keep (edit via pill)
      }
      const wrapper = prev.find((p) => p.kind === 'wrapper' || p.kind === 'complex');
      const rest = prev.filter((p) => p !== wrapper);
      const np = makePill(item);
      return wrapper ? [...rest, np, wrapper] : [...rest, np];
    });
    if (rawMode) setRawMode(false);
  }, [rawMode]);

  const addCustom = bsC((tokenStr: string) => {
    setPills((prev) => {
      const wrapper = prev.find((p) => p.kind === 'wrapper' || p.kind === 'complex');
      const rest = prev.filter((p) => p !== wrapper);
      const np = makeCustomPill(tokenStr);
      return wrapper ? [...rest, np, wrapper] : [...rest, np];
    });
    if (rawMode) setRawMode(false);
  }, [rawMode]);

  const toggleRaw = () => {
    if (rawMode) { setPills(parseLine(rawText)); setRawMode(false); }
    else { setRawText(composeLine(pills)); setRawMode(true); }
  };
  const onRawChange = (v: string) => { setRawText(v); };

  const loadPreset = (preset: Preset) => {
    setPills(parseLine(preset.value).map((p) => ({ ...p, uid: newUid() })));
    setRawMode(false); setStartOpen(false);
    if (isPreset && !name) { setName(preset.name); setDesc(preset.desc); }
  };

  const hasError = validation.level === 'error';
  const isEmpty = pills.length === 0 && !rawText.trim();
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
        {/* header */}
        <div className="builder-head">
          <div className="bh-icon"><Icon name={isPreset ? 'bookmark' : 'terminal'} size={16} /></div>
          <div className="bh-titles">
            <div className="bh-title">{headerTitle}</div>
            <div className="bh-sub">
              {isPreset ? (
                <span>A preset is a saved launch line. Compose it below.</span>
              ) : (
                <>
                  <span>Applying to <b>{`${targetCount} game${targetCount === 1 ? '' : 's'}`}</b></span>
                  {mixedLines && mixedLines.length > 1 && <span className="mix-badge"><Icon name="alert" size={11} />mixed selection</span>}
                </>
              )}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} style={{ marginLeft: 'auto' }}><Icon name="x" size={15} /></button>
        </div>

        {/* body */}
        <div className="builder-body">
          {/* left: canvas */}
          <div className="builder-canvas">
            <div className="canvas-scroll">
              {isPreset && (
                <div className="preset-fields">
                  <div className="pf-row"><label htmlFor="preset-name">Name</label><input id="preset-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Native HDR" spellCheck={false} /></div>
                  <div className="pf-row"><label htmlFor="preset-desc">Description</label><input id="preset-desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What it does, when to use it" spellCheck={false} /></div>
                </div>
              )}

              <div className="canvas-block-label">
                <Icon name="layers" size={13} />Launch line<span className="cbl-ct">{pills.length} block{pills.length === 1 ? '' : 's'}</span>
                <span className="cbl-line" />
                <span className="cbl-act">
                  <button className="btn ghost" style={{ height: 24, padding: '0 8px', fontSize: 11 }} onClick={() => setStartOpen((v) => !v)}><Icon name="bookmark" size={12} />Start from preset</button>
                  {pills.length > 0 && <button className="btn ghost" style={{ height: 24, padding: '0 8px', fontSize: 11 }} onClick={() => { setPills([]); setRawMode(false); }}><Icon name="x" size={12} />Clear</button>}
                </span>
              </div>

              {startOpen && <StartFromPreset presets={presets} onPick={loadPreset} />}

              <PillLine pills={pills} flagged={validation.flagged} onChange={setPillsAndExitRaw} />

              <PreviewBlock
                finalStr={finalStr} validation={validation}
                rawMode={rawMode} onToggleRaw={toggleRaw} rawText={rawText} onRawChange={onRawChange}
              />

              {!isPreset && mixedLines && mixedLines.length > 1 && (
                <MixedLines mixedLines={mixedLines} targetCount={targetCount} />
              )}
            </div>
          </div>

          {/* right: catalogue */}
          <div className="builder-cat">
            <Catalogue pills={pills} onAdd={addItem} onAddCustom={addCustom} />
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
   UNIFIED PRESETS LIST (replaces the two-column manager)
   ============================================================ */
interface PresetsListProps {
  presets: Preset[];
  onNew: () => void;
  onEdit: (p: Preset) => void;
  onDuplicate: (p: Preset) => void;
  onDelete: (p: Preset) => void;
  onApply: (p: Preset) => void;
  hasSelection: boolean;
  selCount: number;
}
function PresetsList({ presets, onNew, onEdit, onDuplicate, onDelete, onApply, hasSelection, selCount }: PresetsListProps) {
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
          const pills = parseLine(p.value);
          const wrapper = pills.find((x) => x.kind === 'wrapper' || x.kind === 'complex');
          const blocks = pills.filter((x) => x.kind !== 'wrapper' && x.kind !== 'complex');
          return (
            <div className="preset-card" key={p.id}>
              <div className="pc-row">
                <div className="pc-ico"><Icon name="bookmark" size={15} /></div>
                <div className="pc-main">
                  <div className="pc-name">{p.name}<span className="pc-pillct">{pills.length} block{pills.length === 1 ? '' : 's'}</span></div>
                  <div className="pc-desc">{p.desc || <span style={{ color: 'var(--tx-faint)' }}>No description</span>}</div>
                  <div className="pc-mini">
                    {blocks.map((b) => (
                      <span className="mini-pill" key={b.uid}>{b.kind === 'choice' || b.kind === 'input' ? `${b.key}=${b.value}` : b.token}</span>
                    ))}
                    {wrapper && <span className="mini-pill wrap">{wrapper.name} ›</span>}
                  </div>
                  <div className="pc-line mono"><MiniLine value={p.value} /></div>
                </div>
                <div className="pc-acts">
                  {hasSelection && <button className="btn" style={{ height: 28 }} onClick={() => onApply(p)} title={`Apply to ${selCount} selected`}><Icon name="arrowRight" size={13} />Apply to {selCount}</button>}
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
