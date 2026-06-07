// surfaces.tsx - launch sheet, compat picker, row menu, banner, toasts, empty, cmdk
import { useState as uS, useEffect as uE, useRef as uR, useMemo as uM } from "react";
import type { ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Icon } from "./icons";
import { COMPAT_TOOLS } from "./data";
import type {
  AnchorRect, Game, DiscoveredRoot, Settings, Toast, WindowControlsPref,
} from "./types";

export type RowAction = 'launch' | 'compat' | 'clear' | 'copyLaunch' | 'copyId';
export type SteamChoice = 'cancel' | 'closed' | 'reopen';

/* ============ Window controls (custom titlebar, decorations off) ============ */
function appWindow(): ReturnType<typeof getCurrentWindow> | null {
  try { return getCurrentWindow(); } catch { return null; }
}
function WindowControls({ side }: Readonly<{ side: 'left' | 'right' }>) {
  const min = () => appWindow()?.minimize().catch(() => {});
  const max = () => appWindow()?.toggleMaximize().catch(() => {});
  const close = () => appWindow()?.close().catch(() => {});
  if (side === 'left') {
    // macOS traffic lights: close · minimize · maximize
    return (
      <div className="tb-dots">
        <button className="tb-dot c" onClick={close} title="Close" />
        <button className="tb-dot m" onClick={min} title="Minimize" />
        <button className="tb-dot x" onClick={max} title="Zoom" />
      </div>
    );
  }
  // Windows/Linux: minimize · maximize · close
  return (
    <div className="win-ctl">
      <button className="wc" onClick={min} title="Minimize"><Icon name="minus" size={15} /></button>
      <button className="wc" onClick={max} title="Maximize"><Icon name="square" size={12} /></button>
      <button className="wc wc-close" onClick={close} title="Close"><Icon name="x" size={15} /></button>
    </div>
  );
}

/* ============ Modal scrim (native <button>; click or Enter to close) ============ */
function Scrim({ onClose }: Readonly<{ onClose: () => void }>) {
  return (
    <button type="button" className="scrim" aria-label="Close" onClick={onClose} />
  );
}

/* ============ Popover (anchored) ============ */
interface PopoverProps {
  anchor: AnchorRect;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}
function Popover({ anchor, onClose, children, width }: Readonly<PopoverProps>) {
  const ref = uR<HTMLDivElement>(null);
  uE(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, []);
  // position: prefer below-left of anchor, flip up if needed
  const w = width || 240;
  let left = anchor.left;
  if (left + w > globalThis.innerWidth - 12) left = globalThis.innerWidth - w - 12;
  let top = anchor.bottom + 5;
  const estH = 280;
  if (top + estH > globalThis.innerHeight - 12) top = Math.max(12, anchor.top - estH);
  return (
    <div className="popover" ref={ref} style={{ left, top, minWidth: w }}>{children}</div>
  );
}

/* ============ Compat picker ============ */
interface CompatPickerProps {
  anchor: AnchorRect;
  targets: Game[];
  onPick: (id: string) => void;
  onClose: () => void;
}
function CompatPicker({ anchor, targets, onPick, onClose }: Readonly<CompatPickerProps>) {
  const vals = uM(() => new Set(targets.map((t) => t.compat)), [targets]);
  const mixed = vals.size > 1;
  const current = mixed ? null : [...vals][0];
  return (
    <Popover anchor={anchor} onClose={onClose} width={258}>
      <div className="pop-label">Compatibility · {targets.length} game{targets.length === 1 ? '' : 's'}{mixed ? ' · mixed' : ''}</div>
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
interface RowMenuProps {
  anchor: AnchorRect;
  game: Game;
  onAction: (action: RowAction) => void;
  onClose: () => void;
}
function RowMenu({ anchor, game, onAction, onClose }: Readonly<RowMenuProps>) {
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

/* ============ Steam close/apply/reopen confirm ============ */
interface SteamConfirmProps {
  count: number;
  onChoose: (choice: SteamChoice) => void;
}
function SteamConfirm({ count, onChoose }: Readonly<SteamConfirmProps>) {
  return (
    <dialog className="modal-host" open aria-label="Steam is running">
      <Scrim onClose={() => onChoose('cancel')} />
      <div className="sheet" style={{ width: 460 }}>
        <div className="sheet-head">
          <div>
            <div className="sh-title"><Icon name="power" size={17} style={{ color: 'var(--warn)' }} />Steam is running</div>
            <div className="sh-sub">Applying to <b>{count} game{count === 1 ? '' : 's'}</b> needs Steam closed.</div>
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
    </dialog>
  );
}

/* ============ Settings sheet ============ */
interface SettingsSheetProps {
  settings: Settings;
  effectiveRoot: string;
  discovered: DiscoveredRoot[];
  systemScale: number;
  onPreviewScale: (v: number) => void;
  onSave: (next: Settings) => void;
  onClose: () => void;
}
function SettingsSheet({ settings, effectiveRoot, discovered, systemScale, onPreviewScale, onSave, onClose }: Readonly<SettingsSheetProps>) {
  const sys = typeof systemScale === 'number' && systemScale > 0 ? systemScale : 1;
  const [root, setRoot] = uS(settings.steam_root || '');
  const [silent, setSilent] = uS(settings.silent_start !== false);
  const [wc, setWc] = uS<WindowControlsPref>(settings.window_controls || 'auto');
  const [closeToTray, setCloseToTray] = uS(settings.close_to_tray === true);
  const [startMinimized, setStartMinimized] = uS(settings.start_minimized === true);
  const [scaleAuto, setScaleAuto] = uS(settings.ui_scale <= 0);
  const [manualScale, setManualScale] = uS(settings.ui_scale > 0 ? settings.ui_scale : sys);
  const trimmed = root.trim();
  const usingAuto = trimmed === '';
  const detectedSuffix = effectiveRoot ? ` (${effectiveRoot})` : '';
  const detectPlaceholder = `Auto-detect${detectedSuffix}`;
  const WC_OPTS: Array<[WindowControlsPref, string]> = [['auto', 'Auto'], ['left', 'Left'], ['right', 'Right'], ['hidden', 'Hidden']];
  const effScale = scaleAuto ? sys : manualScale;
  const preview = (v: number) => { if (onPreviewScale) onPreviewScale(v); };
  const stepScale = (delta: number) => {
    const base = scaleAuto ? sys : manualScale;
    const c = Math.min(2, Math.max(0.6, Math.round((base + delta) * 100) / 100));
    setScaleAuto(false);
    setManualScale(c);
    preview(c);
  };
  const useAutoScale = () => { setScaleAuto(true); preview(sys); };
  return (
    <dialog className="modal-host" open aria-label="Settings">
      <Scrim onClose={onClose} />
      <div className="sheet" style={{ width: 520 }}>
        <div className="sheet-head">
          <div>
            <div className="sh-title"><Icon name="settings" size={17} style={{ color: 'var(--acc)' }} />Settings</div>
            <div className="sh-sub">Manifold preferences · stored in <span className="mono">~/.config/manifold/settings.json</span></div>
          </div>
          <button className="icon-btn sheet-x" onClick={onClose}><Icon name="x" size={15} /></button>
        </div>

        <div className="sheet-body">
          <div className="section-label"><Icon name="folder" size={13} />Steam installation<span className="sl-line" /></div>
          <div className="note info" style={{ marginBottom: 12 }}>
            <span className="n-ico" style={{ color: 'var(--tx-lo)' }}><Icon name="info" size={15} /></span>
            <div>Currently using <span className="mono">{effectiveRoot || '(not detected)'}</span>{usingAuto ? <span style={{ color: 'var(--tx-faint)' }}> (auto-detected)</span> : null}</div>
          </div>

          <div className="field">
            <label htmlFor="set-steam-root">Steam path override</label>
            <input id="set-steam-root" className="mono" value={root} onChange={(e) => setRoot(e.target.value)} spellCheck={false}
              placeholder={detectPlaceholder} />
            <div className="hint">Leave empty to auto-detect. Point at a Steam root (the folder containing <span className="mono">config/</span> and <span className="mono">steamapps/</span>).</div>
          </div>

          {discovered.length > 0 && (
            <div className="field">
              <div className="field-cap">Detected</div>
              <div className="filters" style={{ flexWrap: 'wrap' }}>
                {discovered.map((d) => (
                  <button key={d.path} className={'chip' + (trimmed === d.path ? ' on' : '')} onClick={() => setRoot(d.path)} title={d.valid ? 'Valid Steam root' : 'Folder exists but no config/steamapps found'}>
                    <span className="mono" style={{ fontSize: 11 }}>{d.path}</span>
                    <span className="c-ct" style={{ color: d.valid ? 'var(--ok)' : 'var(--warn)' }}>{d.valid ? '✓' : '?'}</span>
                  </button>
                ))}
                <button className={'chip' + (usingAuto ? ' on' : '')} onClick={() => setRoot('')}>Auto-detect</button>
              </div>
            </div>
          )}

          <div className="section-label" style={{ marginTop: 18 }}><Icon name="power" size={13} />Steam launch<span className="sl-line" /></div>
          <div className="field">
            <div className="field-cap">Starting Steam</div>
            <div className="seg">
              <button className={silent ? 'on' : ''} onClick={() => setSilent(true)}>Silent (tray)</button>
              <button className={silent ? '' : 'on'} onClick={() => setSilent(false)}>Normal window</button>
            </div>
            <div className="hint">{silent ? 'Start Steam minimized to the tray (steam -silent).' : 'Start Steam with its window shown.'}</div>
          </div>

          <div className="section-label" style={{ marginTop: 18 }}><Icon name="square" size={12} />Window<span className="sl-line" /></div>
          <div className="field">
            <div className="field-cap">Window-control buttons</div>
            <div className="seg">
              {WC_OPTS.map(([id, label]) => (
                <button key={id} className={wc === id ? 'on' : ''} onClick={() => setWc(id)}>{label}</button>
              ))}
            </div>
            <div className="hint">
              The native title bar is off; these are Manifold's own controls.{" "}
              <b>Auto</b> puts them where your OS does (macOS left, Linux/Windows right).{" "}
              <b>Hidden</b> removes them (use your compositor, e.g. Hyprland, to manage the window).
            </div>
          </div>
          <div className="field">
            <div className="field-cap">Closing the window</div>
            <div className="seg">
              <button className={closeToTray ? '' : 'on'} onClick={() => setCloseToTray(false)}>Quit Manifold</button>
              <button className={closeToTray ? 'on' : ''} onClick={() => setCloseToTray(true)}>Hide to tray</button>
            </div>
            <div className="hint">{closeToTray ? 'The close button hides Manifold to the tray; reopen it from the tray icon, or quit from the tray menu.' : 'The close button quits Manifold. The tray icon still shows or hides the window while it runs.'}</div>
          </div>
          <div className="field">
            <div className="field-cap">On launch</div>
            <div className="seg">
              <button className={startMinimized ? '' : 'on'} onClick={() => setStartMinimized(false)}>Show window</button>
              <button className={startMinimized ? 'on' : ''} onClick={() => setStartMinimized(true)}>Start in tray</button>
            </div>
            <div className="hint">{startMinimized ? 'Manifold launches hidden in the tray; open it from the tray icon.' : 'Manifold opens its window on launch.'}</div>
          </div>

          <div className="section-label" style={{ marginTop: 18 }}><Icon name="eye" size={13} />Interface<span className="sl-line" /></div>
          <div className="field">
            <div className="field-cap">Interface scale</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button className="btn" onClick={() => stepScale(-0.1)} disabled={effScale <= 0.6} title="Smaller"><Icon name="minus" size={14} /></button>
              <span className="mono tnum" style={{ minWidth: 56, textAlign: 'center', fontSize: 13 }}>{Math.round(effScale * 100)}%</span>
              <button className="btn" onClick={() => stepScale(0.1)} disabled={effScale >= 2} title="Larger"><Icon name="plus" size={14} /></button>
              <button className={'btn' + (scaleAuto ? ' primary' : '')} onClick={useAutoScale} title="Follow desktop scale" style={{ marginLeft: 4 }}>
                <Icon name="check" size={13} style={{ opacity: scaleAuto ? 1 : 0.5 }} />Auto
              </button>
            </div>
            <div className="hint">
              <b>Auto</b> matches your desktop scale ({Math.round(sys * 100)}%). Step it to set a custom scale.
              Previews live; Cancel reverts.
            </div>
          </div>
        </div>

        <div className="sheet-foot">
          <div style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => onSave({ steam_root: trimmed, silent_start: silent, window_controls: wc, ui_scale: scaleAuto ? 0 : manualScale, close_to_tray: closeToTray, start_minimized: startMinimized })}>
            <Icon name="check" size={14} />Save
          </button>
        </div>
      </div>
    </dialog>
  );
}

/* ============ Toasts ============ */
interface ToastsProps {
  toasts: Toast[];
  onDismiss: (id: number) => void;
  onUndo: (t: Toast) => void;
}
function Toasts({ toasts, onDismiss, onUndo }: Readonly<ToastsProps>) {
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
function EmptyState({ onRetry }: Readonly<{ onRetry: () => void }>) {
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

export { CompatPicker, RowMenu, SteamConfirm, SettingsSheet, WindowControls, Toasts, EmptyState, Popover };
