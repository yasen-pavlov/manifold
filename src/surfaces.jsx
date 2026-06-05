// surfaces.jsx — launch sheet, compat picker, row menu, banner, toasts, empty, cmdk
import React, { useState as uS, useEffect as uE, useRef as uR, useMemo as uM } from "react";
import { Icon } from "./icons.jsx";
import { HiLaunch, COMPAT_TOOLS } from "./data.jsx";
import { Check } from "./table.jsx";

/* ============ composition engine ============ */
function isLauncher(tok) {
  return tok === 'game' || tok.startsWith('game_') || tok.startsWith('gamescope');
}
function parseValue(val) {
  const toks = val.trim().split(/\s+/).filter(Boolean);
  const ci = toks.indexOf('%command%');
  if (ci === -1) return { envs: toks, launcher: null };
  const before = toks.slice(0, ci);
  let launcher = null;
  if (before.length && isLauncher(before[before.length - 1])) {
    launcher = before[before.length - 1];
    return { envs: before.slice(0, -1), launcher };
  }
  return { envs: before, launcher: null };
}
// compose selected preset/option values into one launch line
function composeLaunch(values) {
  const envs = [];
  let launcher = null;
  for (const v of values) {
    const p = parseValue(v);
    for (const e of p.envs) if (!envs.includes(e)) envs.push(e);
    if (p.launcher) launcher = p.launcher; // last wins
  }
  if (envs.length === 0 && !launcher) return '';
  return [...envs, launcher || 'game', '%command%'].join(' ');
}

/* ============ Launch options sheet ============ */
function LaunchSheet({ targets, presets, options, onApply, onClose, onClear }) {
  const currentLines = uM(() => {
    const m = new Map();
    targets.forEach((g) => m.set(g.launch || '', (m.get(g.launch || '') || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [targets]);
  const mixed = currentLines.length > 1;
  const sharedLine = !mixed ? currentLines[0][0] : '';

  const [picked, setPicked] = uS(() => new Set());
  const [text, setText] = uS(sharedLine);
  const [dirty, setDirty] = uS(!!sharedLine);

  const allItems = uM(() => [...presets, ...options], [presets, options]);
  const composed = uM(() => composeLaunch([...picked].map((id) => allItems.find((i) => i.id === id)?.value).filter(Boolean)), [picked, allItems]);

  // preview follows the composed line unless the user has hand-edited it
  uE(() => { if (!dirty) setText(composed); }, [composed, dirty]);

  const togglePick = (id) => {
    setPicked((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    setDirty(false);
  };
  const resetToComposed = () => { setText(composed); setDirty(false); };

  const cmdCount = (text.match(/%command%/g) || []).length;
  const valid = text.trim() === '' || cmdCount === 1;
  const ownedCount = targets.filter((t) => t.status === 'owned').length;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog">
        <div className="sheet-head">
          <div>
            <div className="sh-title"><Icon name="terminal" size={17} style={{ color: 'var(--acc)' }} />Set launch options</div>
            <div className="sh-sub">Applying to <b>{targets.length} game{targets.length !== 1 ? 's' : ''}</b>{ownedCount > 0 ? <span style={{ color: 'var(--tx-faint)' }}> · {ownedCount} owned-only</span> : null}</div>
          </div>
          <button className="icon-btn sheet-x" onClick={onClose}><Icon name="x" size={15} /></button>
        </div>

        <div className="sheet-body">
          {mixed ? (
            <div className="note warn">
              <span className="n-ico"><Icon name="alert" size={15} /></span>
              <div>
                <b>Mixed selection.</b> The {targets.length} games have different launch lines. Applying will overwrite all of them.
                <div className="curvals">
                  {currentLines.slice(0, 4).map(([line, ct], i) => (
                    <div className="curval" key={i}>
                      <span className="cv-ct">{ct}×</span>
                      <span className="cv-str">{line ? line : '— empty'}</span>
                    </div>
                  ))}
                  {currentLines.length > 4 && <div className="curval"><span className="cv-ct" /><span className="cv-str">+{currentLines.length - 4} more…</span></div>}
                </div>
              </div>
            </div>
          ) : (
            <div className="note info">
              <span className="n-ico" style={{ color: 'var(--tx-lo)' }}><Icon name="info" size={15} /></span>
              <div>Current line is {sharedLine ? <span className="mono">{sharedLine}</span> : <b>empty</b>} for {targets.length === 1 ? 'this game' : 'all selected games'}.</div>
            </div>
          )}

          <div className="section-label"><Icon name="layers" size={13} />Presets<span className="sl-ct">{presets.length}</span><span className="sl-line" /></div>
          <div className="pick-list">
            {presets.map((p) => (
              <div key={p.id} role="button" tabIndex={0} className={'pick' + (picked.has(p.id) ? ' on' : '')} onClick={() => togglePick(p.id)}>
                <Check state={picked.has(p.id)} onClick={() => togglePick(p.id)} />
                <div className="pk-main">
                  <div className="pk-name">{p.name}</div>
                  <div className="pk-desc">{p.desc}</div>
                  <div className="pk-val mono"><HiLaunch value={p.value} /></div>
                </div>
              </div>
            ))}
          </div>

          <div className="section-label"><Icon name="sliders" size={13} />Single options<span className="sl-ct">{options.length}</span><span className="sl-line" /></div>
          <div className="pick-list">
            {options.map((o) => (
              <div key={o.id} role="button" tabIndex={0} className={'pick' + (picked.has(o.id) ? ' on' : '')} onClick={() => togglePick(o.id)}>
                <Check state={picked.has(o.id)} onClick={() => togglePick(o.id)} />
                <div className="pk-main">
                  <div className="pk-name"><span className="mono" style={{ fontSize: 12 }}>{o.name}</span></div>
                  <div className="pk-desc">{o.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* live preview */}
        <div style={{ padding: '0 16px 12px' }}>
          <div className="preview">
            <div className="preview-head">
              <span className="ph-label">Final launch line</span>
              {dirty && <span className="ph-hint" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name="edit" size={11} style={{ color: 'var(--warn)' }} />hand-edited
                <button className="btn ghost" style={{ height: 20, padding: '0 6px', fontSize: 11 }} onClick={resetToComposed}>reset</button>
              </span>}
            </div>
            <textarea
              value={text}
              onChange={(e) => { setText(e.target.value); setDirty(true); }}
              placeholder="game %command%   ·   pick presets above or type the line directly"
              spellCheck={false}
            />
            <div className="preview-foot">
              {text.trim() === '' ? (
                <span style={{ color: 'var(--tx-faint)' }}>Empty — applying will clear launch options.</span>
              ) : valid ? (
                <span className="cmd-ok"><Icon name="checkCircle" size={12} />valid · one %command%</span>
              ) : (
                <span className="cmd-warn"><Icon name="alert" size={12} />{cmdCount === 0 ? 'no %command% token' : cmdCount + '× %command% — should appear once'}</span>
              )}
              <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)' }}>{text.length} ch</span>
            </div>
          </div>
        </div>

        <div className="sheet-foot">
          <button className="btn danger-ghost" onClick={() => onClear()}><Icon name="x" size={14} />Clear instead</button>
          <div style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!valid} onClick={() => onApply(text.trim())}>
            <Icon name="check" size={14} />Apply to {targets.length} game{targets.length !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </>
  );
}

/* ============ Popover (anchored) ============ */
function Popover({ anchor, onClose, children, width }) {
  const ref = uR(null);
  uE(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, []);
  // position: prefer below-left of anchor, flip up if needed
  const w = width || 240;
  let left = anchor.left;
  if (left + w > window.innerWidth - 12) left = window.innerWidth - w - 12;
  let top = anchor.bottom + 5;
  const estH = 280;
  if (top + estH > window.innerHeight - 12) top = Math.max(12, anchor.top - estH);
  return (
    <div className="popover" ref={ref} style={{ left, top, minWidth: w }}>{children}</div>
  );
}

/* ============ Compat picker ============ */
function CompatPicker({ anchor, targets, onPick, onClose }) {
  const vals = uM(() => {
    const s = new Set(targets.map((t) => t.compat));
    return s;
  }, [targets]);
  const mixed = vals.size > 1;
  const current = mixed ? null : [...vals][0];
  return (
    <Popover anchor={anchor} onClose={onClose} width={258}>
      <div className="pop-label">Compatibility · {targets.length} game{targets.length !== 1 ? 's' : ''}{mixed ? ' · mixed' : ''}</div>
      {COMPAT_TOOLS.map((c) => (
        <button key={c.id} className={'pop-item' + (current === c.id ? ' on' : '')} onClick={() => onPick(c.id)}>
          <span className="pi-check">{current === c.id ? <Icon name="check" size={13} /> : null}</span>
          <span className="pi-name">{c.name}</span>
        </button>
      ))}
    </Popover>
  );
}

/* ============ Row context menu ============ */
function RowMenu({ anchor, game, onAction, onClose }) {
  return (
    <Popover anchor={anchor} onClose={onClose} width={216}>
      <div className="pop-label" style={{ fontFamily: 'var(--mono)', textTransform: 'none', color: 'var(--tx-lo)' }}>{game.name}</div>
      <button className="pop-item" onClick={() => onAction('launch')}><Icon name="terminal" size={14} /><span style={{ flex: 1 }}>Set launch options…</span></button>
      <button className="pop-item" onClick={() => onAction('compat')}><Icon name="cpu" size={14} /><span style={{ flex: 1 }}>Set compatibility…</span></button>
      <div className="pop-sep" />
      <button className="pop-item" onClick={() => onAction('copyLaunch')} disabled={!game.launch}><Icon name="copy" size={14} /><span style={{ flex: 1 }}>Copy launch string</span></button>
      <button className="pop-item" onClick={() => onAction('copyId')}><Icon name="copy" size={14} /><span style={{ flex: 1 }}>Copy AppID</span></button>
      <div className="pop-sep" />
      <button className="pop-item danger" onClick={() => onAction('clear')} disabled={!game.launch}><Icon name="x" size={14} /><span style={{ flex: 1 }}>Clear launch options</span></button>
    </Popover>
  );
}

/* ============ Steam-running banner ============ */
function SteamBanner({ onCloseSteam, busy, onDismiss }) {
  return (
    <div className="banner">
      <span className="b-ico"><Icon name="alert" size={17} /></span>
      <div className="b-txt">
        <b>Steam is running</b> — <span>changes won't stick until Steam is closed. Manifold will offer to close Steam when you apply, or close it now.</span>
      </div>
      <div className="b-spacer" />
      <button className="b-act" onClick={onCloseSteam} disabled={busy}>
        <Icon name={busy ? 'refresh' : 'power'} size={13} style={{ marginRight: 5, verticalAlign: '-2px' }} />
        {busy ? 'Closing…' : 'Close Steam'}
      </button>
      <button className="b-dismiss" onClick={onDismiss} title="Dismiss this banner"><Icon name="x" size={14} /></button>
    </div>
  );
}

/* ============ Steam close/apply/reopen confirm ============ */
function SteamConfirm({ count, onChoose }) {
  return (
    <>
      <div className="scrim" onClick={() => onChoose('cancel')} />
      <div className="sheet" style={{ width: 460 }} role="dialog">
        <div className="sheet-head">
          <div>
            <div className="sh-title"><Icon name="power" size={17} style={{ color: 'var(--warn)' }} />Steam is running</div>
            <div className="sh-sub">Applying to <b>{count} game{count !== 1 ? 's' : ''}</b> needs Steam closed.</div>
          </div>
        </div>
        <div className="sheet-body">
          <div className="note warn">
            <span className="n-ico"><Icon name="alert" size={15} /></span>
            <div>
              Steam rewrites its config on exit, so Manifold only writes while it's closed.
              Closing Steam will also <b>close any running game</b>.
            </div>
          </div>
        </div>
        <div className="sheet-foot" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn ghost" onClick={() => onChoose('cancel')}>Cancel</button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={() => onChoose('closed')}>
            <Icon name="power" size={14} />Close &amp; apply
          </button>
          <button className="btn primary" onClick={() => onChoose('reopen')}>
            <Icon name="refresh" size={14} />Close, apply &amp; reopen
          </button>
        </div>
      </div>
    </>
  );
}

/* ============ Toasts ============ */
function Toasts({ toasts, onDismiss, onUndo }) {
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={'toast ' + (t.kind || 'ok')}>
          <span className="t-ico"><Icon name={t.kind === 'err' ? 'xCircle' : 'checkCircle'} size={17} /></span>
          <div className="t-main">
            <div className="t-title">{t.title}</div>
            {t.sub && <div className="t-sub">{t.sub}</div>}
          </div>
          {t.undo && <button className="t-act" onClick={() => onUndo(t)}>Undo</button>}
          <button className="b-dismiss" onClick={() => onDismiss(t.id)}><Icon name="x" size={13} /></button>
        </div>
      ))}
    </div>
  );
}

/* ============ Empty / first run ============ */
function EmptyState({ onRetry }) {
  return (
    <div className="empty">
      <div className="e-mark"><Icon name="folder" size={26} /></div>
      <h2>No Steam library found</h2>
      <p>Manifold scans your Steam config for installed and owned games. Point it at the right directory, then re-scan.</p>
      <div className="e-path">~/.steam/steam/steamapps · <span style={{ color: 'var(--warn)' }}>not found</span></div>
      <div className="e-acts">
        <button className="btn"><Icon name="folder" size={14} />Choose library folder…</button>
        <button className="btn primary" onClick={onRetry}><Icon name="refresh" size={14} />Re-scan</button>
      </div>
    </div>
  );
}

export { LaunchSheet, CompatPicker, RowMenu, SteamBanner, SteamConfirm, Toasts, EmptyState, Popover, composeLaunch };
