// catalogue.jsx - searchable building-block catalogue (right pane of the builder)
import React, { useState as cgS, useMemo as cgM } from "react";
import { Icon } from "./icons.jsx";
import { CATEGORIES, CATALOGUE } from "./catalogue-data.jsx";

function kindLabel(kind) {
  return { toggle: 'toggle', choice: 'choice', input: 'input', wrapper: 'wrapper', complex: 'complex', tool: 'tool' }[kind] || kind;
}

function CatalogueItem({ item, state, onAdd }) {
  // state: 'added' | 'current' | null
  const isWrapper = item.kind === 'wrapper' || item.kind === 'complex';
  const monoName = item.kind === 'toggle' || item.kind === 'choice' || item.kind === 'input' || item.kind === 'tool';
  const added = state === 'added' || state === 'current';
  const addCls = { current: ' is-current', added: ' is-added' }[state] || '';
  let title = 'Add';
  if (isWrapper) title = 'Set wrapper';
  else if (added) title = 'In line';
  const add = () => onAdd(item);
  return (
    <div
      className={'cat-item' + (added ? ' added' : '')}
      role="button"
      tabIndex={0}
      onClick={add}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); add(); } }}
    >
      <div className="ci-main">
        <div className={'ci-name' + (monoName ? ' mono' : '')}>
          {item.name}
          <span className={'kind-tag ' + item.kind}>{kindLabel(item.kind)}</span>
        </div>
        <div className="ci-desc">{item.desc}</div>
      </div>
      <span className={'ci-add' + addCls} title={title}>
        <Icon name={added ? 'check' : 'plus'} size={14} />
      </span>
    </div>
  );
}

function Catalogue({ pills, onAdd, onAddCustom }) {
  const [q, setQ] = cgS('');
  const [cat, setCat] = cgS('all');
  const [customVal, setCustomVal] = cgS('');

  const inLine = cgM(() => {
    const byItem = new Set(pills.map((p) => p.itemId));
    const wrapper = pills.find((p) => p.kind === 'wrapper' || p.kind === 'complex');
    return { byItem, wrapperId: wrapper?.itemId };
  }, [pills]);

  const filtered = cgM(() => {
    const query = q.trim().toLowerCase();
    return CATALOGUE.filter((c) => {
      if (cat !== 'all' && cat !== 'custom' && c.cat !== cat) return false;
      if (cat === 'custom') return false;
      if (!query) return true;
      return (c.name + ' ' + c.desc + ' ' + (c.token || '') + ' ' + (c.key || '')).toLowerCase().includes(query);
    });
  }, [q, cat]);

  const grouped = cgM(() => {
    const order = CATEGORIES.map((c) => c.id);
    const m = {};
    filtered.forEach((c) => {
      if (!m[c.cat]) m[c.cat] = [];
      m[c.cat].push(c);
    });
    return order.filter((id) => m[id]).map((id) => ({ cat: CATEGORIES.find((c) => c.id === id), items: m[id] }));
  }, [filtered]);

  const stateFor = (item) => {
    if (item.kind === 'wrapper' || item.kind === 'complex') return inLine.wrapperId === item.id ? 'current' : null;
    return inLine.byItem.has(item.id) ? 'added' : null;
  };

  const showCustom = cat === 'all' || cat === 'custom';

  return (
    <>
      <div className="cat-search">
        <div className="cs-in">
          <span className="cs-ico"><Icon name="search" size={14} /></span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search building blocks…" spellCheck={false} />
        </div>
        <div className="cat-tabs">
          <button className={'cat-tab' + (cat === 'all' ? ' on' : '')} onClick={() => setCat('all')}>All</button>
          {CATEGORIES.map((c) => (
            <button key={c.id} className={'cat-tab' + (cat === c.id ? ' on' : '')} onClick={() => setCat(c.id)}>
              <Icon name={c.icon} size={12} />{c.name}
            </button>
          ))}
        </div>
      </div>
      <div className="cat-list">
        {grouped.map(({ cat: c, items }) => (
          <div key={c.id}>
            <div className="cat-group-label"><span className="cgl-ico"><Icon name={c.icon} size={12} /></span>{c.name}<span style={{ color: 'var(--tx-faint)', fontFamily: 'var(--mono)', fontWeight: 400 }}>· {items.length}</span></div>
            {items.map((item) => <CatalogueItem key={item.id} item={item} state={stateFor(item)} onAdd={onAdd} />)}
          </div>
        ))}
        {grouped.length === 0 && cat !== 'custom' && <div className="cat-empty">No building blocks match “{q}”.</div>}

        {showCustom && (
          <div className="custom-add">
            <div className="ca-label"><Icon name="wand" size={13} style={{ color: 'var(--acc)' }} />Custom fragment</div>
            <div className="ca-row">
              <input
                value={customVal}
                onChange={(e) => setCustomVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && customVal.trim()) { onAddCustom(customVal.trim()); setCustomVal(''); } }}
                placeholder="KEY=VALUE, a flag, or a wrapper script"
                spellCheck={false}
              />
              <button className="btn primary" style={{ height: 28 }} disabled={!customVal.trim()} onClick={() => { onAddCustom(customVal.trim()); setCustomVal(''); }}>
                <Icon name="plus" size={13} />Add
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export { Catalogue, CatalogueItem };
