// presets.jsx — presets manager, editor, backups, command palette
import React, { useState as pS, useEffect as pE, useRef as pR } from "react";
import { Icon } from "./icons.jsx";
import { HiLaunch } from "./data.jsx";

/* ============ Preset / option editor ============ */
function ItemEditor({ item, onSave, onClose }) {
  const isNew = !item.name;
  const [kind, setKind] = pS(item.kind || 'preset');
  const [name, setName] = pS(item.name || '');
  const [desc, setDesc] = pS(item.desc || '');
  const [value, setValue] = pS(item.value || '');
  const valid = name.trim() && value.trim();
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" style={{ width: 480 }} role="dialog">
        <div className="sheet-head">
          <div>
            <div className="sh-title">
              <Icon name={isNew ? 'plus' : 'edit'} size={16} style={{ color: 'var(--acc)' }} />
              {isNew ? 'New' : 'Edit'} {kind === 'preset' ? 'preset' : 'single option'}
            </div>
          </div>
          <button className="icon-btn sheet-x" onClick={onClose}><Icon name="x" size={15} /></button>
        </div>
        <div className="sheet-body">
          <div className="field">
            <label>Kind</label>
            <div className="seg">
              <button className={kind === 'preset' ? 'on' : ''} onClick={() => setKind('preset')}>Preset</button>
              <button className={kind === 'option' ? 'on' : ''} onClick={() => setKind('option')}>Single option</button>
            </div>
            <div className="hint">{kind === 'preset' ? 'A full or partial named launch line.' : 'A small reusable fragment (env var or wrapper).'}</div>
          </div>
          <div className="field">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'preset' ? 'e.g. Native HDR' : 'e.g. PROTON_USE_OPTISCALER=1'} spellCheck={false} className={kind === 'option' ? 'mono' : ''} />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What it does, when to use it…" spellCheck={false} style={{ minHeight: 48 }} />
          </div>
          <div className="field">
            <label>{kind === 'preset' ? 'Launch line' : 'Fragment value'}</label>
            <textarea className="mono" value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === 'preset' ? 'PROTON_ENABLE_HDR=1 game %command%' : 'PROTON_USE_OPTISCALER=1'} spellCheck={false} />
            <div className="hint">{kind === 'preset' ? 'Include %command% where the game executable goes.' : 'No %command% needed — fragments compose before it.'}</div>
          </div>
          {value.trim() && (
            <div className="preview" style={{ borderColor: 'var(--line)' }}>
              <div className="preview-head" style={{ background: 'var(--bg-2)' }}><span className="ph-label" style={{ color: 'var(--tx-lo)' }}>Preview</span></div>
              <div style={{ padding: '10px 12px', fontFamily: 'var(--mono)', fontSize: 12.5, color: 'var(--tx-hi)' }}><HiLaunch value={value} /></div>
            </div>
          )}
        </div>
        <div className="sheet-foot">
          <div style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!valid} onClick={() => onSave({ ...item, kind, name: name.trim(), desc: desc.trim(), value: value.trim() })}>
            <Icon name="check" size={14} />{isNew ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </>
  );
}

/* ============ Presets manager ============ */
function PresetCard({ item, onEdit, onDuplicate, onDelete }) {
  const isPreset = item.kind === 'preset';
  return (
    <div className="card">
      <div className="card-row">
        <div className={'card-icon' + (isPreset ? '' : ' opt')}>
          <Icon name={isPreset ? 'layers' : 'sliders'} size={15} />
        </div>
        <div className="card-main">
          <div className="card-name">{item.name}</div>
          <div className="card-desc">{item.desc || <span style={{ color: 'var(--tx-faint)' }}>No description</span>}</div>
          <div className="card-val mono"><HiLaunch value={item.value} /></div>
        </div>
        <div className="card-acts">
          <button className="row-act" style={{ opacity: 1 }} title="Edit" onClick={() => onEdit(item)}><Icon name="edit" size={14} /></button>
          <button className="row-act" style={{ opacity: 1 }} title="Duplicate" onClick={() => onDuplicate(item)}><Icon name="copy" size={14} /></button>
          <button className="row-act" style={{ opacity: 1 }} title="Delete" onClick={() => onDelete(item)}><Icon name="trash" size={14} /></button>
        </div>
      </div>
    </div>
  );
}

function PresetsManager({ presets, options, onEdit, onNew, onDuplicate, onDelete }) {
  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Presets &amp; options</h1>
            <p>Reusable building blocks. Stack presets and single options together in <b style={{ color: 'var(--tx-mid)', fontWeight: 500 }}>Set launch options</b>.</p>
          </div>
          <div className="ph-actions">
            <button className="btn" onClick={() => onNew('option')}><Icon name="plus" size={14} />New option</button>
            <button className="btn primary" onClick={() => onNew('preset')}><Icon name="plus" size={14} />New preset</button>
          </div>
        </div>

        <div className="pm-grid">
          <div>
            <div className="pm-col-head">
              <h2><Icon name="layers" size={15} style={{ color: 'var(--acc)' }} />Presets</h2>
              <span className="pm-ct">{presets.length}</span>
            </div>
            {presets.map((p) => (
              <PresetCard key={p.id} item={p} onEdit={onEdit} onDuplicate={onDuplicate} onDelete={onDelete} />
            ))}
            {presets.length === 0 && <div style={{ color: 'var(--tx-faint)', fontSize: 12.5, padding: '14px 0' }}>No presets yet.</div>}
          </div>
          <div>
            <div className="pm-col-head">
              <h2><Icon name="sliders" size={15} style={{ color: 'var(--tx-lo)' }} />Single options</h2>
              <span className="pm-ct">{options.length}</span>
            </div>
            {options.map((o) => (
              <PresetCard key={o.id} item={o} onEdit={onEdit} onDuplicate={onDuplicate} onDelete={onDelete} />
            ))}
            {options.length === 0 && <div style={{ color: 'var(--tx-faint)', fontSize: 12.5, padding: '14px 0' }}>No options yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============ Backups ============ */
const BACKUPS = [
  { id: 'b1', when: '2026-06-05 14:22:08', games: 7,  note: 'Set launch options · OptiScaler + DLSS upgrade' },
  { id: 'b2', when: '2026-06-05 14:09:51', games: 12, note: 'Set compatibility · proton-cachyos-slr' },
  { id: 'b3', when: '2026-06-04 23:41:30', games: 3,  note: 'Clear launch options' },
  { id: 'b4', when: '2026-06-04 19:02:17', games: 1,  note: 'Set launch options · Native HDR' },
  { id: 'b5', when: '2026-06-03 09:15:44', games: 36, note: 'Initial snapshot on first scan' },
];
function BackupsView({ onRestore }) {
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
                <div className="card-desc">{b.note} · <span className="mono" style={{ color: 'var(--tx-mid)' }}>{b.games} game{b.games !== 1 ? 's' : ''}</span></div>
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
function CommandPalette({ commands, onClose }) {
  const [q, setQ] = pS('');
  const [active, setActive] = pS(0);
  const inputRef = pR(null);
  pE(() => { inputRef.current?.focus(); }, []);

  const filtered = commands.filter((c) => (c.name + ' ' + (c.group || '')).toLowerCase().includes(q.toLowerCase()));
  pE(() => { setActive(0); }, [q]);

  const run = (c) => { onClose(); c.run(); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[active]) run(filtered[active]); }
    else if (e.key === 'Escape') { onClose(); }
  };

  // group
  const groups = [];
  filtered.forEach((c, i) => {
    const gname = c.group || 'Actions';
    let grp = groups.find((g) => g.name === gname);
    if (!grp) { grp = { name: gname, items: [] }; groups.push(grp); }
    grp.items.push({ ...c, _i: i });
  });

  return (
    <div className="cmdk-scrim" onClick={onClose}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <div className="cmdk-input">
          <Icon name="command" size={17} style={{ color: 'var(--tx-lo)' }} />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Type a command or search…" spellCheck={false} />
        </div>
        <div className="cmdk-list">
          {groups.map((g) => (
            <div key={g.name}>
              <div className="cmdk-group-label">{g.name}</div>
              {g.items.map((c) => (
                <div
                  key={c.id}
                  className={'cmdk-item' + (c._i === active ? ' active' : '')}
                  onMouseEnter={() => setActive(c._i)}
                  onClick={() => run(c)}
                >
                  <span className="ci-ico"><Icon name={c.icon} size={15} /></span>
                  <span className="ci-name">{c.name}</span>
                  {c.hint && <span className="ci-hint">{c.hint}</span>}
                </div>
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

export { PresetsManager, ItemEditor, BackupsView, CommandPalette };
