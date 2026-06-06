// pills.jsx - pill rendering, launch-line zone (drag-reorder + inline editors), preview, validation
import React, { useState as plS, useRef as plR, useEffect as plE } from "react";
import { Icon } from "./icons.jsx";
import { Popover } from "./surfaces.jsx";
import { GAMESCOPE_SCHEMA, CATALOGUE, makePill, isEnvToken, STALE_TOKENS } from "./catalogue-data.jsx";

/* ---------- final-string highlighter ---------- */
function HiString({ value }) {
  if (!value) return <span className="empty-hint">empty, add a wrapper to begin</span>;
  const toks = value.split(/(\s+)/);
  return (
    <>{toks.map((t, i) => {
      if (/^\s+$/.test(t)) return t;
      if (t === '%command%') return <span key={i} className="cmd">{t}</span>;
      if (t === '--') return <span key={i} className="dash">{t}</span>;
      if (STALE_TOKENS[t] || STALE_TOKENS[t.replace(/=.*/, '')]) return <span key={i} className="stale">{t}</span>;
      if (isEnvToken(t)) return <span key={i} className="env">{t}</span>;
      if (t.startsWith('-')) return <span key={i} className="flag">{t}</span>;
      return <span key={i}>{t}</span>;
    })}</>
  );
}

/* ---------- gamescope summary for the wrapper pill ---------- */
function gsSummary(cfg) {
  const bits = [];
  if (cfg.W && cfg.H) bits.push(`${cfg.W}x${cfg.H}`);
  if (cfg.r) bits.push(`${cfg.r}Hz`);
  if (cfg['hdr-enabled']) bits.push('HDR');
  if (cfg['adaptive-sync']) bits.push('VRR');
  return bits.join(' · ') || 'configure';
}

/* ---------- single pill ---------- */
function Pill({ pill, flag, onClick, onRemove, dnd }) {
  const isWrapper = pill.kind === 'wrapper' || pill.kind === 'complex';
  const isComplex = pill.kind === 'complex';
  const editable = pill.kind === 'choice' || pill.kind === 'input' || isWrapper;

  let body;
  if (isWrapper) {
    const wname = pill.name || 'Raw';
    body = (
      <span className={'pbody' + (editable ? ' clickable' : '')} onClick={editable ? onClick : undefined}>
        <span className="pw-ico"><Icon name={isComplex ? 'gamepad' : 'monitor'} size={13} /></span>
        <span className="pkey">{wname}</span>
        {isComplex && <span className="pw-summary">{gsSummary(pill.cfg)}</span>}
        <span className="pcmd">%command%</span>
        {editable && <span className="pchev"><Icon name="chevronDown" size={12} /></span>}
      </span>
    );
  } else if (pill.kind === 'choice') {
    body = (
      <span className="pbody clickable" onClick={onClick}>
        <span className="pkey">{pill.key}</span><span className="peq">=</span><span className="pval">{pill.value}</span>
        <span className="pchev"><Icon name="chevronDown" size={12} /></span>
      </span>
    );
  } else if (pill.kind === 'input') {
    body = (
      <span className="pbody clickable" onClick={onClick}>
        <span className="pkey">{pill.key}</span><span className="peq">=</span>
        <span className="pval">{pill.value === '' ? <span style={{ color: 'var(--tx-faint)' }}>(empty)</span> : pill.value}</span>
        <span className="pchev"><Icon name="edit" size={11} /></span>
      </span>
    );
  } else if (pill.kind === 'toggle') {
    const [k, v] = pill.token.split('=');
    body = <span className="pbody"><span className="pkey">{k}</span><span className="peq">={v}</span></span>;
  } else if (pill.kind === 'tool') {
    body = <span className="pbody"><span className="pkey">{pill.token}</span></span>;
  } else {
    body = <span className="pbody"><span className="pkey">{pill.token}</span><span className="ptag">custom</span></span>;
  }

  return (
    <span
      className={'pill cat-' + pill.cat + (isWrapper ? ' is-wrapper' : '') + (flag ? ' invalid' : '') + (dnd?.dragging ? ' dragging' : '') + (dnd?.over ? ' drop-target' : '')}
      draggable={!isWrapper}
      onDragStart={dnd?.onDragStart}
      onDragEnter={dnd?.onDragEnter}
      onDragEnd={dnd?.onDragEnd}
      onDragOver={(e) => e.preventDefault()}
      title={flag?.msg || ''}
    >
      {!isWrapper && <span className="pgrip"><Icon name="grip" size={13} /></span>}
      {isWrapper && <span className="pw-lock"><Icon name="lock" size={11} /></span>}
      {body}
      {flag && <span className="pwarn" title={flag.msg}><Icon name="alert" size={12} /></span>}
      <span className="px" onClick={onRemove} title="Remove"><Icon name="x" size={12} /></span>
    </span>
  );
}

/* ---------- choice editor popover ---------- */
function ChoiceEditor({ anchor, pill, onChange, onClose }) {
  return (
    <Popover anchor={anchor} onClose={onClose} width={220}>
      <div className="editor-pop">
        <div className="ep-head"><div className="ep-title">{pill.key}</div></div>
        <div className="ep-body">
          {pill.choices.map((c) => (
            <div key={c} className={'ep-choice' + (pill.value === c ? ' on' : '')} onClick={() => { onChange(c); onClose(); }}>
              <span className="epc-check">{pill.value === c ? <Icon name="check" size={13} /> : null}</span>
              {pill.key}={c}
            </div>
          ))}
        </div>
      </div>
    </Popover>
  );
}

/* ---------- input editor popover ---------- */
function InputEditor({ anchor, pill, onChange, onClose }) {
  const [v, setV] = plS(pill.value);
  const ref = plR(null);
  plE(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const commit = () => { onChange(v); onClose(); };
  return (
    <Popover anchor={anchor} onClose={onClose} width={250}>
      <div className="editor-pop">
        <div className="ep-head"><div className="ep-title">{pill.key}=</div><div className="ep-desc">{pill.inputType === 'number' ? 'Numeric value' : pill.inputType === 'path' ? 'Path, or empty to clear' : 'Value'}</div></div>
        <div className="ep-input-row">
          <input ref={ref} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') onClose(); }} placeholder={pill.placeholder} spellCheck={false} inputMode={pill.inputType === 'number' ? 'numeric' : 'text'} />
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
function GamescopeEditor({ anchor, pill, onChange, onClose }) {
  const [cfg, setCfg] = plS({ ...pill.cfg });
  const set = (k, v) => setCfg((c) => ({ ...c, [k]: v }));
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
                  <input value={cfg[f.key] ?? ''} placeholder={f.placeholder} inputMode="numeric" onChange={(e) => set(f.key, e.target.value)} />
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
                {togs.map((t) => (
                  <div key={t.key} className={'gs-toggle' + (cfg[t.key] ? ' on' : '')} onClick={() => set(t.key, !cfg[t.key])}>
                    <span className="gst-box" /><span className="gst-label">{t.flag}</span>
                  </div>
                ))}
              </div>
            );
          })}
          <div className="gs-group">
            <div className="gs-group-l">Nested environment</div>
            {GAMESCOPE_SCHEMA.envs.map((e) => (
              <div key={e.key} className={'gs-toggle' + (cfg[e.key] ? ' on' : '')} onClick={() => set(e.key, !cfg[e.key])}>
                <span className="gst-box" /><span className="gst-label">{e.label}</span>
              </div>
            ))}
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
function PillLine({ pills, flagged, onChange }) {
  const [editing, setEditing] = plS(null); // {uid, anchor}
  const [drag, setDrag] = plS({ from: null, over: null });

  const reorderable = pills.filter((p) => p.kind !== 'wrapper' && p.kind !== 'complex');
  const wrapper = pills.find((p) => p.kind === 'wrapper' || p.kind === 'complex');

  const openEditor = (uid, e) => {
    const r = e.currentTarget.closest('.pill').getBoundingClientRect();
    setEditing({ uid, anchor: r });
  };
  const removePill = (uid) => onChange(pills.filter((p) => p.uid !== uid));
  const updatePill = (uid, patch) => onChange(pills.map((p) => (p.uid === uid ? { ...p, ...patch } : p)));

  // drag among reorderable pills
  const onDragStart = (uid) => (e) => { setDrag({ from: uid, over: null }); e.dataTransfer.effectAllowed = 'move'; };
  const onDragEnter = (uid) => () => setDrag((d) => (d.from && d.from !== uid ? { ...d, over: uid } : d));
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
    <div className={'pill-line' + (drag.from ? ' drag-active' : '')}>
      {pills.length === 0 ? (
        <div className="line-empty">
          <div className="le-ico"><Icon name="terminal" size={15} /></div>
          <div className="le-t">No building blocks yet</div>
          <div className="le-s">Pick a wrapper and options from the catalogue to compose a launch line.</div>
        </div>
      ) : (
        <>
          {reorderable.map((p) => (
            <Pill
              key={p.uid} pill={p} flag={flagged[p.uid]}
              onClick={(e) => openEditor(p.uid, e)}
              onRemove={() => removePill(p.uid)}
              dnd={{
                dragging: drag.from === p.uid, over: drag.over === p.uid,
                onDragStart: onDragStart(p.uid), onDragEnter: onDragEnter(p.uid), onDragEnd,
              }}
            />
          ))}
          {wrapper && (
            <>
              {reorderable.length > 0 && <span className="pill-join"><Icon name="chevronRight" size={13} /></span>}
              <Pill key={wrapper.uid} pill={wrapper} flag={flagged[wrapper.uid]} onClick={(e) => openEditor(wrapper.uid, e)} onRemove={() => removePill(wrapper.uid)} />
            </>
          )}
        </>
      )}

      {editPill && editPill.kind === 'choice' && (
        <ChoiceEditor anchor={editing.anchor} pill={editPill} onClose={() => setEditing(null)} onChange={(v) => updatePill(editPill.uid, { value: v })} />
      )}
      {editPill && editPill.kind === 'input' && (
        <InputEditor anchor={editing.anchor} pill={editPill} onClose={() => setEditing(null)} onChange={(v) => updatePill(editPill.uid, { value: v })} />
      )}
      {editPill && editPill.kind === 'complex' && (
        <GamescopeEditor anchor={editing.anchor} pill={editPill} onClose={() => setEditing(null)} onChange={(cfg) => updatePill(editPill.uid, { cfg })} />
      )}
      {editPill && editPill.kind === 'wrapper' && (
        <WrapperEditor anchor={editing.anchor} pill={editPill} onClose={() => setEditing(null)} onChange={(item) => {
          const np = makePill(item);
          onChange(pills.map((p) => (p.uid === editPill.uid ? { ...np, uid: editPill.uid } : p)));
        }} />
      )}
    </div>
  );
}

/* ---------- wrapper swap popover (click a non-complex wrapper pill) ---------- */
function WrapperEditor({ anchor, pill, onChange, onClose }) {
  const wrappers = CATALOGUE.filter((c) => c.cat === 'wrapper');
  return (
    <Popover anchor={anchor} onClose={onClose} width={260}>
      <div className="editor-pop">
        <div className="ep-head"><div className="ep-title" style={{ fontFamily: 'var(--sans)', fontWeight: 600 }}>Wrapper</div><div className="ep-desc">Owns %command% · only one</div></div>
        <div className="ep-body">
          {wrappers.map((w) => (
            <div key={w.id} className={'ep-choice' + (pill.itemId === w.id ? ' on' : '')} onClick={() => { onChange(w); onClose(); }} style={{ fontFamily: 'var(--sans)' }}>
              <span className="epc-check">{pill.itemId === w.id ? <Icon name="check" size={13} /> : null}</span>
              <span style={{ flex: 1 }}>{w.name}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--tx-faint)' }}>{w.head || 'raw'}</span>
            </div>
          ))}
        </div>
      </div>
    </Popover>
  );
}

/* ---------- preview + validation block ---------- */
function PreviewBlock({ finalStr, validation, rawMode, onToggleRaw, rawText, onRawChange }) {
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
          {lvl === 'warn' && <span className="vstat warn"><Icon name="alert" size={12} />{validation.issues.filter((i) => i.level === 'warn').length} warning{validation.issues.filter((i) => i.level === 'warn').length !== 1 ? 's' : ''}</span>}
          {lvl === 'error' && <span className="vstat error"><Icon name="xCircle" size={12} />{validation.issues.find((i) => i.level === 'error')?.msg.split('.')[0]}</span>}
          <button className="copy-btn" onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={12} />{copied ? 'copied' : 'copy'}</button>
        </div>
      </div>
      {validation.issues.length > 0 && (
        <div className="issues">
          {validation.issues.map((iss, i) => (
            <div key={i} className={'issue ' + iss.level}>
              <span className="i-ico"><Icon name={iss.level === 'error' ? 'xCircle' : 'alert'} size={13} /></span>
              <span>{iss.msg}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { Pill, PillLine, PreviewBlock, HiString, gsSummary };
