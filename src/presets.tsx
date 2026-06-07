// presets.tsx - backups view + command palette.
// (The presets manager + item editor were replaced by the structured builder; see builder.tsx.)
import { useState as pS, useEffect as pE, useRef as pR } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Icon } from "./icons";
import type { Backup, Command } from "./types";

/* ============ Backups ============ */
const BACKUPS: Backup[] = [
  { id: 'b1', when: '2026-06-05 14:22:08', games: 7,  note: 'Set launch options · OptiScaler + DLSS upgrade' },
  { id: 'b2', when: '2026-06-05 14:09:51', games: 12, note: 'Set compatibility · proton-cachyos-slr' },
  { id: 'b3', when: '2026-06-04 23:41:30', games: 3,  note: 'Clear launch options' },
  { id: 'b4', when: '2026-06-04 19:02:17', games: 1,  note: 'Set launch options · Native HDR' },
  { id: 'b5', when: '2026-06-03 09:15:44', games: 36, note: 'Initial snapshot on first scan' },
];
function BackupsView({ onRestore }: { onRestore: (b: Backup) => void }) {
  return (
    <div className="page">
      <div className="page-inner" style={{ maxWidth: 820 }}>
        <div className="page-head">
          <div>
            <h1>Backups</h1>
            <p>Every write snapshots the affected <span className="mono" style={{ fontSize: 12 }}>localconfig.vdf</span> entries first. Restore any point in time.</p>
          </div>
          <div className="ph-actions"><button className="btn"><Icon name="download" size={14} />Export all</button></div>
        </div>
        {BACKUPS.map((b) => (
          <div className="card" key={b.id}>
            <div className="card-row" style={{ alignItems: 'center' }}>
              <div className="card-icon opt"><Icon name="history" size={15} /></div>
              <div className="card-main">
                <div className="card-name mono" style={{ fontSize: 12.5 }}>{b.when}</div>
                <div className="card-desc">{b.note} · <span className="mono" style={{ color: 'var(--tx-mid)' }}>{b.games} game{b.games === 1 ? '' : 's'}</span></div>
              </div>
              <button className="btn" onClick={() => onRestore(b)}><Icon name="rotate" size={14} />Restore</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============ Command palette ============ */
type IndexedCommand = Command & { _i: number };

function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [q, setQ] = pS('');
  const [active, setActive] = pS(0);
  const inputRef = pR<HTMLInputElement>(null);
  pE(() => { inputRef.current?.focus(); }, []);

  const filtered = commands.filter((c) => (c.name + ' ' + (c.group || '')).toLowerCase().includes(q.toLowerCase()));
  pE(() => { setActive(0); }, [q]);

  const run = (c: Command) => { onClose(); c.run(); };
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[active]) run(filtered[active]); }
    else if (e.key === 'Escape') { onClose(); }
  };

  // group
  const groups: Array<{ name: string; items: IndexedCommand[] }> = [];
  filtered.forEach((c, i) => {
    const gname = c.group || 'Actions';
    let grp = groups.find((g) => g.name === gname);
    if (!grp) { grp = { name: gname, items: [] }; groups.push(grp); }
    grp.items.push({ ...c, _i: i });
  });

  return (
    <div className="cmdk-scrim">
      <button type="button" className="cmdk-backdrop" aria-label="Close command palette" onClick={onClose} />
      <div className="cmdk">
        <div className="cmdk-input">
          <Icon name="command" size={17} style={{ color: 'var(--tx-lo)' }} />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Type a command or search…" spellCheck={false} />
        </div>
        <div className="cmdk-list">
          {groups.map((g) => (
            <div key={g.name}>
              <div className="cmdk-group-label">{g.name}</div>
              {g.items.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  className={'cmdk-item' + (c._i === active ? ' active' : '')}
                  onMouseEnter={() => setActive(c._i)}
                  onClick={() => run(c)}
                >
                  <span className="ci-ico"><Icon name={c.icon} size={15} /></span>
                  <span className="ci-name">{c.name}</span>
                  {c.hint && <span className="ci-hint">{c.hint}</span>}
                </button>
              ))}
            </div>
          ))}
          {filtered.length === 0 && <div style={{ padding: '24px', textAlign: 'center', color: 'var(--tx-faint)', fontSize: 12.5 }}>No commands match “{q}”.</div>}
        </div>
        <div className="cmdk-foot">
          <span><span className="kbd">↑↓</span> navigate</span>
          <span><span className="kbd">↵</span> run</span>
          <span><span className="kbd">esc</span> close</span>
        </div>
      </div>
    </div>
  );
}

export { BackupsView, CommandPalette };
