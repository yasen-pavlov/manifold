// pills.tsx - pill rendering, launch-line zone (drag-reorder + inline editors), preview, validation
import { useState as plS, useRef as plR, useEffect as plE } from "react";
import type {
  HTMLAttributes, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent,
  DragEvent as ReactDragEvent,
} from "react";
import { Icon } from "./icons";
import { Popover } from "./surfaces";
import { GAMESCOPE_SCHEMA, CATALOGUE, makePill, isEnvToken, STALE_TOKENS } from "./catalogue-data";
import type {
  Pill, ChoicePill, InputPill, ComplexPill, WrapperPill,
  GamescopeCfg, Issue, Validation, AnchorRect, CatalogueItem,
} from "./types";

type ClickHandler = (e: ReactMouseEvent | ReactKeyboardEvent) => void;

// Enter/Space activate a click handler, for elements given role="button".
const keyActivate = (fn: (e: ReactKeyboardEvent) => void) => (e: ReactKeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(e); }
};

function tokenClass(t: string): string {
  if (t === '%command%') return 'cmd';
  if (t === '--') return 'dash';
  if (STALE_TOKENS[t] || STALE_TOKENS[t.replace(/=.*/, '')]) return 'stale';
  if (isEnvToken(t)) return 'env';
  if (t.startsWith('-')) return 'flag';
  return '';
}

/* ---------- final-string highlighter ---------- */
function HiString({ value }: Readonly<{ value: string }>) {
  if (!value) return <span className="empty-hint">empty, add a wrapper to begin</span>;
  const toks = value.split(/(\s+)/);
  return (
    <>{toks.map((t, i) => {
      if (/^\s+$/.test(t)) return t;
      return <span key={`${i}-${t}`} className={tokenClass(t)}>{t}</span>;
    })}</>
  );
}

/* ---------- gamescope summary for the wrapper pill ---------- */
function gsSummary(cfg: GamescopeCfg): string {
  const bits: string[] = [];
  if (cfg.W && cfg.H) bits.push(`${cfg.W}x${cfg.H}`);
  if (cfg.r) bits.push(`${cfg.r}Hz`);
  if (cfg['hdr-enabled']) bits.push('HDR');
  if (cfg['adaptive-sync']) bits.push('VRR');
  return bits.join(' · ') || 'configure';
}

/* ---------- a pill's inner body (varies by kind) ---------- */
interface PillBodyProps {
  pill: Pill;
  editable: boolean;
  onClick: ClickHandler;
}
function PillBody({ pill, editable, onClick }: Readonly<PillBodyProps>) {
  const clickProps: HTMLAttributes<HTMLSpanElement> = editable
    ? { className: 'pbody clickable', role: 'button', tabIndex: 0, onClick, onKeyDown: keyActivate(onClick) }
    : { className: 'pbody' };

  if (pill.kind === 'wrapper' || pill.kind === 'complex') {
    return (
      <span {...clickProps}>
        <span className="pw-ico"><Icon name={pill.kind === 'complex' ? 'gamepad' : 'monitor'} size={13} /></span>
        <span className="pkey">{pill.name || 'Raw'}</span>
        {pill.kind === 'complex' && <span className="pw-summary">{gsSummary(pill.cfg)}</span>}
        <span className="pcmd">%command%</span>
        <span className="pchev"><Icon name="chevronDown" size={12} /></span>
      </span>
    );
  }
  if (pill.kind === 'choice') {
    return (
      <span {...clickProps}>
        <span className="pkey">{pill.key}</span><span className="peq">=</span><span className="pval">{pill.value}</span>
        <span className="pchev"><Icon name="chevronDown" size={12} /></span>
      </span>
    );
  }
  if (pill.kind === 'input') {
    return (
      <span {...clickProps}>
        <span className="pkey">{pill.key}</span><span className="peq">=</span>
        <span className="pval">{pill.value === '' ? <span style={{ color: 'var(--tx-faint)' }}>(empty)</span> : pill.value}</span>
        <span className="pchev"><Icon name="edit" size={11} /></span>
      </span>
    );
  }
  if (pill.kind === 'toggle') {
    const [k, v] = pill.token.split('=');
    return <span className="pbody"><span className="pkey">{k}</span><span className="peq">={v}</span></span>;
  }
  if (pill.kind === 'tool') {
    return <span className="pbody"><span className="pkey">{pill.token}</span></span>;
  }
  return <span className="pbody"><span className="pkey">{pill.token}</span><span className="ptag">custom</span></span>;
}

/* a human label for the pill, used for the reorder handle's accessible name */
function pillLabel(pill: Pill): string {
  if (pill.kind === 'wrapper' || pill.kind === 'complex') return pill.name || 'wrapper';
  if (pill.kind === 'choice' || pill.kind === 'input') return `${pill.key}=${pill.value}`;
  return pill.token || pill.name || 'option';
}

/* ---------- single pill ---------- */
interface DndProps {
  dragging: boolean;
  over: boolean;
  onDragStart: (e: ReactDragEvent) => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
}
interface PillProps {
  pill: Pill;
  flag?: Issue;
  onClick: ClickHandler;
  onRemove: () => void;
  onMove?: (delta: number) => void;
  dnd?: DndProps;
}
function PillView({ pill, flag, onClick, onRemove, onMove, dnd }: Readonly<PillProps>) {
  const isWrapper = pill.kind === 'wrapper' || pill.kind === 'complex';
  const editable = pill.kind === 'choice' || pill.kind === 'input' || isWrapper;
  const cls = 'pill cat-' + pill.cat + (isWrapper ? ' is-wrapper' : '') + (flag ? ' invalid' : '') +
    (dnd?.dragging ? ' dragging' : '') + (dnd?.over ? ' drop-target' : '');

  // The grip is a real <button> drag handle that also supports keyboard reorder
  // (arrow keys) and removal (Delete) - this is what makes the pill accessible.
  const onGripKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); onMove?.(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); onMove?.(1); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); onRemove(); }
  };

  return (
    <li
      className={cls}
      onDragEnter={dnd?.onDragEnter}
      onDragOver={dnd ? (e) => e.preventDefault() : undefined}
      title={flag?.msg || ''}
    >
      {!isWrapper && (
        <button
          type="button"
          className="pgrip"
          draggable
          aria-label={`${pillLabel(pill)} - drag, or arrow keys to reorder, Delete to remove`}
          onDragStart={dnd?.onDragStart}
          onDragEnd={dnd?.onDragEnd}
          onKeyDown={onGripKey}
        >
          <Icon name="grip" size={13} />
        </button>
      )}
      {isWrapper && <span className="pw-lock"><Icon name="lock" size={11} /></span>}
      <PillBody pill={pill} editable={editable} onClick={onClick} />
      {flag && <span className="pwarn" title={flag.msg}><Icon name="alert" size={12} /></span>}
      <button type="button" className="px" onClick={onRemove} title="Remove" aria-label={`Remove ${pillLabel(pill)}`}><Icon name="x" size={12} /></button>
    </li>
  );
}

/* ---------- choice editor popover ---------- */
interface ChoiceEditorProps {
  anchor: AnchorRect;
  pill: ChoicePill;
  onChange: (v: string) => void;
  onClose: () => void;
}
function ChoiceEditor({ anchor, pill, onChange, onClose }: Readonly<ChoiceEditorProps>) {
  return (
    <Popover anchor={anchor} onClose={onClose} width={220}>
      <div className="editor-pop">
        <div className="ep-head"><div className="ep-title">{pill.key}</div></div>
        <div className="ep-body">
          {pill.choices.map((c) => {
            const pick = () => { onChange(c); onClose(); };
            return (
              <button type="button" key={c} className={'ep-choice' + (pill.value === c ? ' on' : '')} onClick={pick}>
                <span className="epc-check">{pill.value === c ? <Icon name="check" size={13} /> : null}</span>
                {pill.key}={c}
              </button>
            );
          })}
        </div>
      </div>
    </Popover>
  );
}

/* ---------- input editor popover ---------- */
interface InputEditorProps {
  anchor: AnchorRect;
  pill: InputPill;
  onChange: (v: string) => void;
  onClose: () => void;
}
function InputEditor({ anchor, pill, onChange, onClose }: Readonly<InputEditorProps>) {
  const [v, setV] = plS(pill.value);
  const ref = plR<HTMLInputElement>(null);
  plE(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const commit = () => { onChange(v); onClose(); };
  const descMap: Record<string, string> = { number: 'Numeric value', path: 'Path, or empty to clear' };
  const desc = descMap[pill.inputType] || 'Value';
  const onInputKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') onClose();
  };
  return (
    <Popover anchor={anchor} onClose={onClose} width={250}>
      <div className="editor-pop">
        <div className="ep-head"><div className="ep-title">{pill.key}=</div><div className="ep-desc">{desc}</div></div>
        <div className="ep-input-row">
          <input ref={ref} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={onInputKey} placeholder={pill.placeholder} spellCheck={false} inputMode={pill.inputType === 'number' ? 'numeric' : 'text'} />
          <div className="ep-hint">Preview: <span style={{ fontFamily: 'var(--mono)', color: 'var(--acc-text)' }}>{pill.key}={v}</span></div>
        </div>
        <div className="ep-foot">
          <button className="btn ghost" style={{ height: 28 }} onClick={onClose}>Cancel</button>
          <div style={{ flex: 1 }} />
          <button className="btn primary" style={{ height: 28 }} onClick={commit}><Icon name="check" size={13} />Set</button>
        </div>
      </div>
    </Popover>
  );
}

/* ---------- gamescope complex editor ---------- */
interface GamescopeEditorProps {
  anchor: AnchorRect;
  pill: ComplexPill;
  onChange: (cfg: GamescopeCfg) => void;
  onClose: () => void;
}
function GamescopeEditor({ anchor, pill, onChange, onClose }: Readonly<GamescopeEditorProps>) {
  const [cfg, setCfg] = plS<GamescopeCfg>({ ...pill.cfg });
  const set = (k: string, v: string | boolean) => setCfg((c) => ({ ...c, [k]: v }));
  const groups = [
    { id: 'output', label: 'Output' },
    { id: 'display', label: 'Display' },
    { id: 'hdr', label: 'HDR' },
    { id: 'input', label: 'Input' },
  ];
  return (
    <Popover anchor={anchor} onClose={onClose} width={330}>
      <div className="editor-pop gs-pop">
        <div className="ep-head" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="gamepad" size={15} style={{ color: 'var(--acc)' }} />
          <div><div className="ep-title" style={{ fontFamily: 'var(--sans)', fontWeight: 600 }}>Gamescope</div><div className="ep-desc">gamescope [flags] -- %command%</div></div>
        </div>
        <div className="gs-body">
          <div className="gs-group">
            <div className="gs-group-l">Resolution &amp; refresh</div>
            <div className="gs-flags">
              {GAMESCOPE_SCHEMA.flags.map((f) => (
                <div className="gs-flag" key={f.key}>
                  <label>{f.flag} {f.label}</label>
                  <input value={String(cfg[f.key] ?? '')} placeholder={f.placeholder} inputMode="numeric" onChange={(e) => set(f.key, e.target.value)} />
                </div>
              ))}
            </div>
          </div>
          {groups.filter((g) => g.id !== 'output').map((g) => {
            const togs = GAMESCOPE_SCHEMA.toggles.filter((t) => t.group === g.id);
            if (!togs.length) return null;
            return (
              <div className="gs-group" key={g.id}>
                <div className="gs-group-l">{g.label}</div>
                {togs.map((t) => {
                  const toggle = () => set(t.key, !cfg[t.key]);
                  return (
                    <div key={t.key} className={'gs-toggle' + (cfg[t.key] ? ' on' : '')} role="switch" aria-checked={!!cfg[t.key]} tabIndex={0} onClick={toggle} onKeyDown={keyActivate(toggle)}>
                      <span className="gst-box" /><span className="gst-label">{t.flag}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
          <div className="gs-group">
            <div className="gs-group-l">Nested environment</div>
            {GAMESCOPE_SCHEMA.envs.map((e) => {
              const toggle = () => set(e.key, !cfg[e.key]);
              return (
                <div key={e.key} className={'gs-toggle' + (cfg[e.key] ? ' on' : '')} role="switch" aria-checked={!!cfg[e.key]} tabIndex={0} onClick={toggle} onKeyDown={keyActivate(toggle)}>
                  <span className="gst-box" /><span className="gst-label">{e.label}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="ep-foot">
          <button className="btn ghost" style={{ height: 28 }} onClick={onClose}>Cancel</button>
          <div style={{ flex: 1 }} />
          <button className="btn primary" style={{ height: 28 }} onClick={() => { onChange(cfg); onClose(); }}><Icon name="check" size={13} />Apply</button>
        </div>
      </div>
    </Popover>
  );
}

/* ---------- the launch line ---------- */
interface PillLineProps {
  pills: Pill[];
  flagged: Record<string, Issue>;
  onChange: (pills: Pill[]) => void;
}
function PillLine({ pills, flagged, onChange }: Readonly<PillLineProps>) {
  const [editing, setEditing] = plS<{ uid: string; anchor: AnchorRect } | null>(null);
  const [drag, setDrag] = plS<{ from: string | null; over: string | null }>({ from: null, over: null });

  const reorderable = pills.filter((p) => p.kind !== 'wrapper' && p.kind !== 'complex');
  const wrapper = pills.find((p) => p.kind === 'wrapper' || p.kind === 'complex');

  const openEditor = (uid: string, e: ReactMouseEvent | ReactKeyboardEvent) => {
    const el = e.currentTarget.closest('.pill');
    if (!el) return;
    setEditing({ uid, anchor: el.getBoundingClientRect() });
  };
  const removePill = (uid: string) => onChange(pills.filter((p) => p.uid !== uid));
  const updatePill = (uid: string, patch: Record<string, unknown>) =>
    onChange(pills.map((p) => (p.uid === uid ? { ...p, ...patch } : p)));

  // keyboard reorder: move a reorderable pill left/right among its peers
  const movePill = (uid: string, delta: number) => {
    const arr = [...reorderable];
    const idx = arr.findIndex((p) => p.uid === uid);
    const next = idx + delta;
    if (idx === -1 || next < 0 || next >= arr.length) return;
    [arr[idx], arr[next]] = [arr[next], arr[idx]];
    onChange(wrapper ? [...arr, wrapper] : arr);
  };

  // drag among reorderable pills
  const onDragStart = (uid: string) => (e: ReactDragEvent) => { setDrag({ from: uid, over: null }); e.dataTransfer.effectAllowed = 'move'; };
  const onDragEnter = (uid: string) => () => setDrag((d) => (d.from && d.from !== uid ? { ...d, over: uid } : d));
  const onDragEnd = () => {
    setDrag((d) => {
      if (d.from && d.over && d.from !== d.over) {
        const arr = [...reorderable];
        const fi = arr.findIndex((p) => p.uid === d.from);
        const ti = arr.findIndex((p) => p.uid === d.over);
        const [m] = arr.splice(fi, 1);
        arr.splice(ti, 0, m);
        onChange(wrapper ? [...arr, wrapper] : arr);
      }
      return { from: null, over: null };
    });
  };

  const editPill = editing ? pills.find((p) => p.uid === editing.uid) : null;

  return (
    <ul className={'pill-line' + (drag.from ? ' drag-active' : '')} aria-label="Launch line">
      {pills.length === 0 ? (
        <div className="line-empty">
          <div className="le-ico"><Icon name="terminal" size={15} /></div>
          <div className="le-t">No building blocks yet</div>
          <div className="le-s">Pick a wrapper and options from the catalogue to compose a launch line.</div>
        </div>
      ) : (
        <>
          {reorderable.map((p) => (
            <PillView
              key={p.uid} pill={p} flag={flagged[p.uid]}
              onClick={(e) => openEditor(p.uid, e)}
              onRemove={() => removePill(p.uid)}
              onMove={(delta) => movePill(p.uid, delta)}
              dnd={{
                dragging: drag.from === p.uid, over: drag.over === p.uid,
                onDragStart: onDragStart(p.uid), onDragEnter: onDragEnter(p.uid), onDragEnd,
              }}
            />
          ))}
          {wrapper && (
            <>
              {reorderable.length > 0 && <span className="pill-join"><Icon name="chevronRight" size={13} /></span>}
              <PillView key={wrapper.uid} pill={wrapper} flag={flagged[wrapper.uid]} onClick={(e) => openEditor(wrapper.uid, e)} onRemove={() => removePill(wrapper.uid)} />
            </>
          )}
        </>
      )}

      {editing && editPill?.kind === 'choice' && (
        <ChoiceEditor anchor={editing.anchor} pill={editPill} onClose={() => setEditing(null)} onChange={(v) => updatePill(editPill.uid, { value: v })} />
      )}
      {editing && editPill?.kind === 'input' && (
        <InputEditor anchor={editing.anchor} pill={editPill} onClose={() => setEditing(null)} onChange={(v) => updatePill(editPill.uid, { value: v })} />
      )}
      {editing && editPill?.kind === 'complex' && (
        <GamescopeEditor anchor={editing.anchor} pill={editPill} onClose={() => setEditing(null)} onChange={(cfg) => updatePill(editPill.uid, { cfg })} />
      )}
      {editing && editPill?.kind === 'wrapper' && (
        <WrapperEditor anchor={editing.anchor} pill={editPill} onClose={() => setEditing(null)} onChange={(item) => {
          const np = makePill(item);
          onChange(pills.map((p) => (p.uid === editPill.uid ? { ...np, uid: editPill.uid } : p)));
        }} />
      )}
    </ul>
  );
}

/* ---------- wrapper swap popover (click a non-complex wrapper pill) ---------- */
interface WrapperEditorProps {
  anchor: AnchorRect;
  pill: WrapperPill;
  onChange: (item: CatalogueItem) => void;
  onClose: () => void;
}
function WrapperEditor({ anchor, pill, onChange, onClose }: Readonly<WrapperEditorProps>) {
  const wrappers = CATALOGUE.filter((c) => c.cat === 'wrapper');
  return (
    <Popover anchor={anchor} onClose={onClose} width={260}>
      <div className="editor-pop">
        <div className="ep-head"><div className="ep-title" style={{ fontFamily: 'var(--sans)', fontWeight: 600 }}>Wrapper</div><div className="ep-desc">Owns %command% · only one</div></div>
        <div className="ep-body">
          {wrappers.map((w) => {
            const pick = () => { onChange(w); onClose(); };
            const head = 'head' in w ? w.head : '';
            return (
              <button type="button" key={w.id} className={'ep-choice' + (pill.itemId === w.id ? ' on' : '')} onClick={pick} style={{ fontFamily: 'var(--sans)' }}>
                <span className="epc-check">{pill.itemId === w.id ? <Icon name="check" size={13} /> : null}</span>
                <span style={{ flex: 1 }}>{w.name}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--tx-faint)' }}>{head || 'raw'}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Popover>
  );
}

/* ---------- preview + validation block ---------- */
interface PreviewBlockProps {
  finalStr: string;
  validation: Validation;
  rawMode: boolean;
  onToggleRaw: () => void;
  rawText: string;
  onRawChange: (v: string) => void;
}
function PreviewBlock({ finalStr, validation, rawMode, onToggleRaw, rawText, onRawChange }: Readonly<PreviewBlockProps>) {
  const [copied, setCopied] = plS(false);
  const copy = () => { navigator.clipboard?.writeText(finalStr); setCopied(true); setTimeout(() => setCopied(false), 1400); };
  const lvl = validation.level;
  return (
    <div className="preview-block">
      <div className="prev-bar">
        <span className="pb-label">Final launch line</span>
        <span className="pb-spacer" />
        <button className={'raw-toggle' + (rawMode ? ' on' : '')} onClick={onToggleRaw}>
          <Icon name="terminal" size={12} />Edit raw
        </button>
      </div>
      <div className={'prev-well lvl-' + lvl}>
        {rawMode ? (
          <textarea className="prev-raw" value={rawText} onChange={(e) => onRawChange(e.target.value)} spellCheck={false} placeholder="game %command%" />
        ) : (
          <div className="prev-str"><HiString value={finalStr} /></div>
        )}
        <div className="prev-foot">
          {lvl === 'ok' && <span className="vstat ok"><Icon name="checkCircle" size={12} />valid · one %command%</span>}
          {lvl === 'warn' && <span className="vstat warn"><Icon name="alert" size={12} />{validation.issues.filter((i) => i.level === 'warn').length} warning{validation.issues.filter((i) => i.level === 'warn').length === 1 ? '' : 's'}</span>}
          {lvl === 'error' && <span className="vstat error"><Icon name="xCircle" size={12} />{validation.issues.find((i) => i.level === 'error')?.msg.split('.')[0]}</span>}
          <button className="copy-btn" onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={12} />{copied ? 'copied' : 'copy'}</button>
        </div>
      </div>
      {validation.issues.length > 0 && (
        <div className="issues">
          {validation.issues.map((iss) => (
            <div key={iss.level + ':' + iss.msg} className={'issue ' + iss.level}>
              <span className="i-ico"><Icon name={iss.level === 'error' ? 'xCircle' : 'alert'} size={13} /></span>
              <span>{iss.msg}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { PillView as Pill, PillLine, PreviewBlock, HiString, gsSummary };
