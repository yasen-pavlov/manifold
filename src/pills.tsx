// pills.tsx - Surface A (the two-zone launch line) + Surface B (the configurable-tool popover).
// The line is ONE ordered Pill[]: env + tool pills, a fixed `command` divider, then `arg` pills.
// Exports the repo contract: PillLine({ pills, flagged, onChange }) + PreviewBlock.
import { useState as plS, useRef as plR, useEffect as plE } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, DragEvent as ReactDragEvent,
} from "react";
import { Icon } from "./icons";
import { Popover } from "./surfaces";
import {
  TOOL_BY_ID, toolSummary, compileTool, isEnvToken, STALE_TOKENS,
  splitAtCommand, orderedTools, makeCommandPill, makeArgPill, tokenizeArgs, GAME_ARGS,
} from "./catalogue-data";
import type {
  Pill, ToolPill, ChoicePill, InputPill, Ctrl, ToolCfg, ToolDef,
  Issue, Validation, AnchorRect, GameArg,
} from "./types";

type ClickHandler = (e: ReactMouseEvent | ReactKeyboardEvent) => void;

// Enter/Space activate a click handler, for elements given role="button"/"switch".
const keyActivate = (fn: (e: ReactKeyboardEvent) => void) => (e: ReactKeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(e); }
};

/* ---------- final-string highlighter (two zones) ---------- */
function HiString({ value }: Readonly<{ value: string }>) {
  if (!value) return <span className="empty-hint">empty line</span>;
  const toks = value.split(/(\s+)/);
  let post = false;
  return (
    <>{toks.map((t, i) => {
      if (/^\s+$/.test(t)) return t;
      let cls = '';
      if (t === '%command%') { post = true; cls = 'cmd'; }
      else if (t === '--') cls = 'dash';
      else if (STALE_TOKENS[t] || STALE_TOKENS[t.replace(/=.*/, '')]) cls = 'stale';
      else if (post) cls = 'arg';
      else if (isEnvToken(t)) cls = 'env';
      else if (t.startsWith('-')) cls = 'flag';
      else cls = 'tool';
      return <span key={`${i}-${t}`} className={cls}>{t}</span>;
    })}</>
  );
}

/* ---------- env-pill inline editors ---------- */
function ChoiceEditor({ anchor, pill, onChange, onClose }: Readonly<{ anchor: AnchorRect; pill: ChoicePill; onChange: (v: string) => void; onClose: () => void }>) {
  return (
    <Popover anchor={anchor} onClose={onClose} width={220}>
      <div className="editor-pop">
        <div className="ep-head"><div className="ep-title">{pill.key}</div></div>
        <div className="ep-body">
          {pill.choices.map((c) => {
            const pick = () => { onChange(c); onClose(); };
            return (
              <button type="button" key={c} className={'ep-choice' + (pill.value === c ? ' on' : '')} onClick={pick}>
                <span className="epc-check">{pill.value === c ? <Icon name="check" size={13} /> : null}</span>{pill.key}={c}
              </button>
            );
          })}
        </div>
      </div>
    </Popover>
  );
}
function InputEditor({ anchor, pill, onChange, onClose }: Readonly<{ anchor: AnchorRect; pill: InputPill; onChange: (v: string) => void; onClose: () => void }>) {
  const [v, setV] = plS(pill.value);
  const ref = plR<HTMLInputElement>(null);
  plE(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const commit = () => { onChange(v); onClose(); };
  const descMap: Record<string, string> = { number: 'Numeric value', path: 'Path, or empty to clear' };
  const onInputKey = (e: ReactKeyboardEvent) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') onClose(); };
  return (
    <Popover anchor={anchor} onClose={onClose} width={250}>
      <div className="editor-pop">
        <div className="ep-head"><div className="ep-title">{pill.key}=</div><div className="ep-desc">{descMap[pill.inputType] || 'Value'}</div></div>
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

/* ============================================================
   Surface B - the configurable-tool popover (schema-driven)
   ============================================================ */
function GSNumber({ ctrl, value, onChange }: Readonly<{ ctrl: Ctrl; value: string; onChange: (v: string) => void }>) {
  return (
    <div className="gs-flag">
      <label>{ctrl.flag ? ctrl.flag + ' ' : ''}{ctrl.label}</label>
      <input value={value ?? ''} placeholder={ctrl.placeholder} inputMode={ctrl.type === 'number' ? 'numeric' : 'text'} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
    </div>
  );
}
function GSToggle({ ctrl, on, onChange }: Readonly<{ ctrl: Ctrl; on: boolean; onChange: (v: boolean) => void }>) {
  const toggle = () => onChange(!on);
  return (
    <div className={'gs-toggle' + (on ? ' on' : '')} role="switch" aria-checked={on} tabIndex={0} title={ctrl.hint || ''} onClick={toggle} onKeyDown={keyActivate(toggle)}>
      <span className="gst-box" />
      <span className="gst-label">{ctrl.flag || ctrl.cfgKey}</span>
      <span className="gst-cap">{ctrl.label}</span>
    </div>
  );
}
function GSChoice({ ctrl, value, onChange }: Readonly<{ ctrl: Ctrl; value: string; onChange: (v: string) => void }>) {
  return (
    <div className="gs-choice">
      <label>{ctrl.flag ? ctrl.flag + ' ' : ''}{ctrl.label}</label>
      <div className="gs-seg">
        {(ctrl.choices ?? []).map((c) => (
          <button type="button" key={c.value} className={'gs-seg-b' + (value === c.value ? ' on' : '')} onClick={() => onChange(c.value)}>{c.label}</button>
        ))}
      </div>
    </div>
  );
}
function SchemaSection({ section, cfg, set }: Readonly<{ section: ToolDef['sections'][number]; cfg: ToolCfg; set: (k: string, v: string | boolean) => void }>) {
  const numbers = section.controls.filter((c) => c.type === 'number' || c.type === 'text');
  const toggles = section.controls.filter((c) => c.type === 'toggle');
  const choices = section.controls.filter((c) => c.type === 'choice');
  return (
    <div className="gs-group">
      <div className="gs-group-l">{section.label}</div>
      {numbers.length > 0 && (
        <div className="gs-flags">
          {numbers.map((c) => <GSNumber key={c.key} ctrl={c} value={String(cfg[c.key] ?? '')} onChange={(v) => set(c.key, v)} />)}
        </div>
      )}
      {choices.map((c) => <GSChoice key={c.key} ctrl={c} value={String(cfg[c.key] ?? '')} onChange={(v) => set(c.key, v)} />)}
      {toggles.length > 0 && (
        <div className="gs-toggles">
          {toggles.map((c) => <GSToggle key={c.key} ctrl={c} on={!!cfg[c.key]} onChange={(v) => set(c.key, v)} />)}
        </div>
      )}
    </div>
  );
}
function ToolTokenPreview({ pill }: Readonly<{ pill: ToolPill }>) {
  const { envs, prefixes } = compileTool(pill);
  const toks = [...envs, ...prefixes];
  if (toks.length === 0) return <span className="ttp-empty">no tokens (runs %command% directly)</span>;
  return (
    <>{toks.map((t, i) => {
      let cls = '';
      if (t === '--') cls = 'dash';
      else if (isEnvToken(t)) cls = 'env';
      else if (t.startsWith('-')) cls = 'flag';
      else if (i > 0) cls = 'tool';
      return <span key={`${i}-${t}`}>{i > 0 ? ' ' : ''}<span className={cls}>{t}</span></span>;
    })} <span className="cmd">%command%</span></>
  );
}
function ToolPopover({ anchor, pill, onChange, onClose }: Readonly<{ anchor: AnchorRect; pill: ToolPill; onChange: (patch: { cfg: ToolCfg; extra: string }) => void; onClose: () => void }>) {
  const tool = TOOL_BY_ID[pill.toolId];
  const [cfg, setCfg] = plS<ToolCfg>({ ...pill.cfg });
  const [extra, setExtra] = plS(pill.extra || '');
  const set = (k: string, v: string | boolean) => setCfg((c) => ({ ...c, [k]: v }));
  const draft: ToolPill = { ...pill, cfg, extra };
  const empty = tool.sections.length === 0;
  const wide = tool.id === 'gamescope';
  return (
    <Popover anchor={anchor} onClose={onClose} width={wide ? 384 : 320}>
      <div className={'editor-pop tool-pop' + (wide ? ' tool-pop-wide' : '')}>
        <div className="tp-head">
          <div className="tp-ico"><Icon name={tool.icon} size={16} /></div>
          <div className="tp-head-main">
            <div className="tp-title">{tool.name}</div>
            <div className="tp-desc">{tool.desc}</div>
            <div className="tp-invoke mono">{tool.invocation}</div>
          </div>
        </div>
        <div className="tp-body">
          {empty ? (
            <div className="tp-empty">
              <div className="tp-empty-ico"><Icon name={tool.icon} size={18} /></div>
              <div className="tp-empty-t">No per-launch options</div>
              <div className="tp-empty-s">{tool.name} is a command prefix with nothing to configure. Use Extra args below for anything bespoke.</div>
            </div>
          ) : tool.sections.map((s) => <SchemaSection key={s.id} section={s} cfg={cfg} set={set} />)}
          <div className="gs-group tp-extra">
            <div className="gs-group-l">Extra args<span className="tp-extra-tag">escape hatch</span></div>
            <input className="tp-extra-in mono" value={extra} placeholder={tool.compile === 'env-config' ? 'cpu_power,gpu_power' : '--some-flag value'} onChange={(e) => setExtra(e.target.value)} spellCheck={false} />
            <div className="tp-extra-note">{tool.configNote}</div>
          </div>
        </div>
        <div className="tp-preview">
          <div className="tp-preview-l">Emits</div>
          <div className="tp-preview-str mono"><ToolTokenPreview pill={draft} /></div>
        </div>
        <div className="ep-foot">
          <button className="btn ghost" style={{ height: 28 }} onClick={onClose}>Cancel</button>
          <div style={{ flex: 1 }} />
          <button className="btn primary" style={{ height: 28 }} onClick={() => { onChange({ cfg, extra }); onClose(); }}><Icon name="check" size={13} />Apply</button>
        </div>
      </div>
    </Popover>
  );
}

/* ============================================================
   Surface A pills
   ============================================================ */
function EnvPill({ pill, flag, onClick, onRemove }: Readonly<{ pill: Pill; flag?: Issue; onClick: ClickHandler; onRemove: () => void }>) {
  let body;
  if (pill.kind === 'choice') {
    body = (<button type="button" className="pbody clickable" onClick={onClick}><span className="pkey">{pill.key}</span><span className="peq">=</span><span className="pval">{pill.value}</span><span className="pchev"><Icon name="chevronDown" size={12} /></span></button>);
  } else if (pill.kind === 'input') {
    body = (<button type="button" className="pbody clickable" onClick={onClick}><span className="pkey">{pill.key}</span><span className="peq">=</span><span className="pval">{pill.value === '' ? <span style={{ color: 'var(--tx-faint)' }}>(empty)</span> : pill.value}</span><span className="pchev"><Icon name="edit" size={11} /></span></button>);
  } else if (pill.kind === 'toggle') {
    const [k, v] = pill.token.split('=');
    body = <span className="pbody"><span className="pkey">{k}</span><span className="peq">={v}</span></span>;
  } else {
    body = <span className="pbody"><span className="pkey">{(pill as { token?: string }).token}</span><span className="ptag">custom</span></span>;
  }
  return (
    <li className={'pill cat-' + pill.cat + (flag ? ' invalid' : '')} title={flag?.msg || ''}>
      {body}
      {flag && <span className="pwarn" title={flag.msg}><Icon name="alert" size={12} /></span>}
      <button type="button" className="px" onClick={onRemove} title="Remove" aria-label={`Remove ${pill.name}`}><Icon name="x" size={12} /></button>
    </li>
  );
}

interface ToolPillDnd {
  dragging: boolean; over: boolean;
  onDragStart: (e: ReactDragEvent) => void; onDragEnter: () => void; onDragEnd: () => void;
}
function ToolPillView({ pill, flag, pinned, onSettings, onRemove, onMove, dnd }: Readonly<{ pill: ToolPill; flag?: Issue; pinned: boolean; onSettings: ClickHandler; onRemove: () => void; onMove: (delta: number) => void; dnd: ToolPillDnd }>) {
  const tool = TOOL_BY_ID[pill.toolId];
  const summary = toolSummary(pill);
  const onGripKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); onMove(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); onMove(1); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); onRemove(); }
  };
  return (
    <li
      className={'pill pill-tool cat-tools' + (flag ? ' invalid' : '') + (pinned ? ' pinned-last' : '') + (dnd.dragging ? ' dragging' : '') + (dnd.over ? ' drop-target' : '')}
      onDragEnter={dnd.onDragEnter} onDragOver={(e) => e.preventDefault()} title={flag?.msg || ''}
    >
      {pinned
        ? <span className="pw-lock" title="Pinned last: gamescope owns the trailing -- terminator"><Icon name="lock" size={11} /></span>
        : <button type="button" className="pgrip" draggable aria-label={`${tool.name} - drag, arrow keys to reorder, Delete to remove`} onDragStart={dnd.onDragStart} onDragEnd={dnd.onDragEnd} onKeyDown={onGripKey}><Icon name="grip" size={13} /></button>}
      <button type="button" className="pbody clickable" onClick={onSettings}>
        <span className="pt-ico"><Icon name={tool.icon} size={13} /></span>
        <span className="pkey">{tool.name}</span>
        {summary && <span className="pt-summary">{summary}</span>}
        <span className="pt-gear"><Icon name="settings" size={12} /></span>
      </button>
      {flag && <span className="pwarn" title={flag.msg}><Icon name="alert" size={12} /></span>}
      <button type="button" className="px" onClick={onRemove} title="Remove" aria-label={`Remove ${tool.name}`}><Icon name="x" size={12} /></button>
    </li>
  );
}

function CommandDivider() {
  return (
    <span className="cmd-divider" title="The game executable runs here. This divider is fixed: it cannot be moved or removed.">
      <span className="cd-ico"><Icon name="gamepad" size={12} /></span>
      <span className="cd-tok mono">%command%</span>
      <span className="cd-cap">game runs here</span>
      <span className="cd-rule" />
    </span>
  );
}

/* ---------- post-command args zone ---------- */
function ArgsInserter({ onPick, onClose }: Readonly<{ onPick: (a: GameArg) => void; onClose: () => void }>) {
  const [open, setOpen] = plS('Universal');
  const grp = GAME_ARGS.find((g) => g.group === open) ?? GAME_ARGS[0];
  return (
    <div className="args-inserter">
      <div className="ai-head">
        <Icon name="terminal" size={12} /><span className="ai-title">Common game arguments</span>
        <span className="ai-note">these depend on the game, may or may not work</span>
        <button type="button" className="ai-x" onClick={onClose} aria-label="Close"><Icon name="x" size={13} /></button>
      </div>
      <div className="ai-tabs">
        {GAME_ARGS.map((g) => <button type="button" key={g.group} className={'ai-tab' + (open === g.group ? ' on' : '')} onClick={() => setOpen(g.group)}>{g.group}</button>)}
      </div>
      <div className="ai-list">
        {grp.args.map((a) => (
          <button type="button" key={a.text} className="ai-item" onClick={() => onPick(a)}>
            <span className="ai-arg mono">{a.text}{a.value ? <span className="ai-ph"> …</span> : null}</span>
            <span className="ai-desc">{a.desc}</span>
            <span className="ai-add"><Icon name="plus" size={12} /></span>
          </button>
        ))}
      </div>
    </div>
  );
}
function PostZone({ args, onAdd, onRemove }: Readonly<{ args: Pill[]; onAdd: (texts: string[]) => void; onRemove: (uid: string) => void }>) {
  const [text, setText] = plS('');
  const [showInserter, setShowInserter] = plS(false);
  const commit = (raw: string) => { const toks = tokenizeArgs(raw); if (toks.length) { onAdd(toks); } setText(''); };
  const onKey = (e: ReactKeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && text.trim()) { e.preventDefault(); commit(text); }
    else if (e.key === 'Backspace' && !text && args.length) onRemove(args[args.length - 1].uid);
  };
  const empty = args.length === 0;
  return (
    <div className="post-zone">
      <div className={'post-line' + (empty && !text ? ' is-empty' : '')}>
        {args.map((c) => (
          <span className="arg-chip" key={c.uid}>
            <span className="ac-text mono">{(c as { text: string }).text}</span>
            <button type="button" className="px" onClick={() => onRemove(c.uid)} title="Remove" aria-label="Remove argument"><Icon name="x" size={11} /></button>
          </span>
        ))}
        <input className="post-input mono" value={text} placeholder={empty ? '+ game arguments  (-novid -dx11 +exec autoexec)' : 'add…'}
          onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onBlur={() => text.trim() && commit(text)} spellCheck={false} aria-label="Game arguments" />
        <button type="button" className={'post-pick' + (showInserter ? ' on' : '')} onClick={() => setShowInserter((v) => !v)} title="Common game arguments" aria-label="Common game arguments"><Icon name="list" size={13} /></button>
      </div>
      {showInserter && <ArgsInserter onClose={() => setShowInserter(false)} onPick={(a) => onAdd([a.text])} />}
    </div>
  );
}

/* ============================================================
   PillLine - Surface A (repo contract: pills, flagged, onChange)
   ============================================================ */
function PillLine({ pills, flagged, onChange }: Readonly<{ pills: Pill[]; flagged: Record<string, Issue>; onChange: (pills: Pill[]) => void }>) {
  const [editing, setEditing] = plS<{ uid: string; anchor: AnchorRect } | null>(null);
  const [drag, setDrag] = plS<{ from: string | null; over: string | null }>({ from: null, over: null });

  const { pre, post } = splitAtCommand(pills);
  const cmd = pills.find((p) => p.kind === 'command') ?? makeCommandPill();
  const envPills = pre.filter((p) => p.kind !== 'tool');
  const tools = pre.filter((p): p is ToolPill => p.kind === 'tool');
  const orderedToolsList = orderedTools(pre);
  const pinned = orderedToolsList.filter((t) => TOOL_BY_ID[t.toolId].pinnedLast);
  const pinnedUid = pinned.length ? pinned[pinned.length - 1].uid : null;

  const rebuild = (nextPre: Pill[], nextPost: Pill[]) => onChange([...nextPre, cmd, ...nextPost]);
  const removePre = (uid: string) => rebuild(pre.filter((p) => p.uid !== uid), post);
  const removeArg = (uid: string) => rebuild(pre, post.filter((p) => p.uid !== uid));
  const updatePill = (uid: string, patch: Record<string, unknown>) => onChange(pills.map((p) => (p.uid === uid ? { ...p, ...patch } : p)));
  const addArgs = (texts: string[]) => rebuild(pre, [...post, ...texts.map((t) => makeArgPill(t))]);

  const openEditor = (uid: string, e: ReactMouseEvent | ReactKeyboardEvent) => {
    const el = e.currentTarget.closest('.pill');
    if (el) setEditing({ uid, anchor: el.getBoundingClientRect() });
  };

  // tool reorder (drag + keyboard) among the tool pills only
  const moveTool = (uid: string, delta: number) => {
    const arr = [...tools];
    const idx = arr.findIndex((p) => p.uid === uid);
    const next = idx + delta;
    if (idx === -1 || next < 0 || next >= arr.length) return;
    [arr[idx], arr[next]] = [arr[next], arr[idx]];
    rebuild([...envPills, ...arr], post);
  };
  const onDragStart = (uid: string) => (e: ReactDragEvent) => { setDrag({ from: uid, over: null }); e.dataTransfer.effectAllowed = 'move'; };
  const onDragEnter = (uid: string) => () => setDrag((d) => (d.from && d.from !== uid ? { ...d, over: uid } : d));
  const onDragEnd = () => setDrag((d) => {
    if (d.from && d.over && d.from !== d.over) {
      const arr = [...tools];
      const fi = arr.findIndex((p) => p.uid === d.from);
      const ti = arr.findIndex((p) => p.uid === d.over);
      if (fi !== -1 && ti !== -1) { const [m] = arr.splice(fi, 1); arr.splice(ti, 0, m); rebuild([...envPills, ...arr], post); }
    }
    return { from: null, over: null };
  });

  const editPill = editing ? pills.find((p) => p.uid === editing.uid) : null;
  const isEmpty = pre.length === 0;

  return (
    <div className="zone-wrap">
      <div className={'pill-line two-zone' + (drag.from ? ' drag-active' : '')} aria-label="Launch line">
        <ul className="zone zone-pre">
          {isEmpty ? (
            <li className="zone-empty"><Icon name="plus" size={13} /> add env vars &amp; tools from the catalogue</li>
          ) : (
            <>
              {envPills.map((p) => (
                <EnvPill key={p.uid} pill={p} flag={flagged[p.uid]} onClick={(e) => openEditor(p.uid, e)} onRemove={() => removePre(p.uid)} />
              ))}
              {orderedToolsList.map((p) => (
                <ToolPillView key={p.uid} pill={p} flag={flagged[p.uid]} pinned={p.uid === pinnedUid}
                  onSettings={(e) => openEditor(p.uid, e)} onRemove={() => removePre(p.uid)} onMove={(delta) => moveTool(p.uid, delta)}
                  dnd={{ dragging: drag.from === p.uid, over: drag.over === p.uid, onDragStart: onDragStart(p.uid), onDragEnter: onDragEnter(p.uid), onDragEnd }} />
              ))}
            </>
          )}
        </ul>

        <CommandDivider />

        <PostZone args={post} onAdd={addArgs} onRemove={removeArg} />
      </div>

      {editing && editPill?.kind === 'choice' && (
        <ChoiceEditor anchor={editing.anchor} pill={editPill} onClose={() => setEditing(null)} onChange={(v) => updatePill(editPill.uid, { value: v })} />
      )}
      {editing && editPill?.kind === 'input' && (
        <InputEditor anchor={editing.anchor} pill={editPill} onClose={() => setEditing(null)} onChange={(v) => updatePill(editPill.uid, { value: v })} />
      )}
      {editing && editPill?.kind === 'tool' && (
        <ToolPopover anchor={editing.anchor} pill={editPill} onClose={() => setEditing(null)} onChange={(patch) => updatePill(editPill.uid, patch)} />
      )}
    </div>
  );
}

/* ============================================================
   PreviewBlock - two-zone final-string preview + validation + raw edit
   ============================================================ */
function PreviewBlock({ finalStr, validation, rawMode, onToggleRaw, rawText, onRawChange }: Readonly<{ finalStr: string; validation: Validation; rawMode: boolean; onToggleRaw: () => void; rawText: string; onRawChange: (v: string) => void }>) {
  const [copied, setCopied] = plS(false);
  const copy = () => { navigator.clipboard?.writeText(finalStr); setCopied(true); setTimeout(() => setCopied(false), 1400); };
  const lvl = validation.level;
  const warnCt = validation.issues.filter((i) => i.level === 'warn').length;
  return (
    <div className="preview-block">
      <div className="prev-bar">
        <span className="pb-label">Final launch line</span>
        <span className="pb-zones">
          <span className="pb-zone">pre-command</span><span className="pb-zone pb-zone-cmd">%command%</span><span className="pb-zone">post</span>
        </span>
        <span className="pb-spacer" />
        <button className={'raw-toggle' + (rawMode ? ' on' : '')} onClick={onToggleRaw}><Icon name="terminal" size={12} />{rawMode ? 'Done editing' : 'Edit raw'}</button>
      </div>
      <div className={'prev-well lvl-' + lvl}>
        {rawMode
          ? <textarea className="prev-raw" value={rawText} onChange={(e) => onRawChange(e.target.value)} spellCheck={false} placeholder="%command%" />
          : <div className="prev-str"><HiString value={finalStr} /></div>}
        <div className="prev-foot">
          {lvl === 'ok' && <span className="vstat ok"><Icon name="checkCircle" size={12} />valid · one %command%</span>}
          {lvl === 'warn' && <span className="vstat warn"><Icon name="alert" size={12} />{warnCt} warning{warnCt === 1 ? '' : 's'}</span>}
          {lvl === 'error' && <span className="vstat error"><Icon name="xCircle" size={12} />{validation.issues.find((i) => i.level === 'error')?.msg.split('.')[0]}</span>}
          <button className="copy-btn" onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={12} />{copied ? 'copied' : 'copy'}</button>
        </div>
      </div>
      {validation.issues.length > 0 && (
        <div className="issues">
          {validation.issues.map((iss) => (
            <div key={iss.level + ':' + iss.msg} className={'issue ' + iss.level}>
              <span className="i-ico"><Icon name={iss.level === 'error' ? 'xCircle' : 'alert'} size={13} /></span><span>{iss.msg}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { PillLine, PreviewBlock, HiString };
