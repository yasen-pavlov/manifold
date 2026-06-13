// catalogue.tsx - searchable building-block catalogue (right pane of the builder).
// Env + tool blocks browse by namespace; the "Game arguments" tab is the post-command picker.
import { useState as cgS, useMemo as cgM } from "react";
import { Icon } from "./icons";
import { CATEGORIES, CATALOGUE, GAME_ARGS, TOOL_BY_ID } from "./catalogue-data";
import type { CatalogueItem, Category, Pill, ToolPill } from "./types";

type ItemState = 'added' | null;

function kindLabel(kind: string): string {
  const labels: Record<string, string> = { toggle: 'toggle', choice: 'choice', input: 'input', tool: 'tool' };
  return labels[kind] || kind;
}

interface CatalogueRowProps {
  item: CatalogueItem;
  state: ItemState;
  onAdd: (item: CatalogueItem) => void;
}
function CatalogueRow({ item, state, onAdd }: Readonly<CatalogueRowProps>) {
  const mono = item.kind === 'toggle' || item.kind === 'choice' || item.kind === 'input';
  const added = state === 'added';
  const add = () => onAdd(item);
  return (
    <button type="button" className={'cat-item' + (added ? ' added' : '')} onClick={add}>
      <div className="ci-main">
        <div className={'ci-name' + (mono ? ' mono' : '')}>
          {item.kind === 'tool' ? <span className="ci-tool-ico"><Icon name={TOOL_BY_ID[item.toolId].icon} size={12} /></span> : null}
          {item.name}<span className={'kind-tag ' + item.kind}>{kindLabel(item.kind)}</span>
        </div>
        <div className="ci-desc">{item.desc}</div>
      </div>
      <span className={'ci-add' + (added ? ' is-added' : '')} title={added ? 'In line' : 'Add'}>
        <Icon name={added ? 'check' : 'plus'} size={14} />
      </span>
    </button>
  );
}

interface CatalogueProps {
  pills: Pill[];
  onAdd: (item: CatalogueItem) => void;
  onAddCustom: (token: string) => void;
  onAddArg: (text: string) => void;
}
function Catalogue({ pills, onAdd, onAddCustom, onAddArg }: Readonly<CatalogueProps>) {
  const [q, setQ] = cgS('');
  const [cat, setCat] = cgS('all');
  const [customVal, setCustomVal] = cgS('');
  const [argGroup, setArgGroup] = cgS('Universal');

  const inLine = cgM(() => {
    const byItem = new Set(pills.map((p) => p.itemId));
    const toolIds = new Set(pills.filter((p): p is ToolPill => p.kind === 'tool').map((p) => p.toolId));
    return { byItem, toolIds };
  }, [pills]);

  const filtered = cgM(() => {
    const query = q.trim().toLowerCase();
    return CATALOGUE.filter((c) => {
      if (cat !== 'all' && cat !== 'custom' && cat !== 'args' && c.cat !== cat) return false;
      if (cat === 'custom' || cat === 'args') return false;
      if (!query) return true;
      const token = 'token' in c ? c.token : '';
      const key = 'key' in c ? c.key : '';
      return (c.name + ' ' + c.desc + ' ' + token + ' ' + key).toLowerCase().includes(query);
    });
  }, [q, cat]);

  const grouped = cgM(() => {
    const order = CATEGORIES.map((c) => c.id);
    const m: Record<string, CatalogueItem[]> = {};
    filtered.forEach((c) => { (m[c.cat] = m[c.cat] || []).push(c); });
    return order.filter((id) => m[id]).map((id) => ({ cat: CATEGORIES.find((c) => c.id === id) as Category, items: m[id] }));
  }, [filtered]);

  const stateFor = (item: CatalogueItem): ItemState => {
    if (item.kind === 'tool') return inLine.toolIds.has(item.toolId) ? 'added' : null;
    return inLine.byItem.has(item.id) ? 'added' : null;
  };
  const showArgs = cat === 'args';
  const showCustom = cat === 'all' || cat === 'custom';
  const grp = GAME_ARGS.find((g) => g.group === argGroup) ?? GAME_ARGS[0];

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
            <button key={c.id} className={'cat-tab' + (cat === c.id ? ' on' : '') + (c.post ? ' post' : '')} onClick={() => setCat(c.id)}>
              <Icon name={c.icon} size={12} />{c.name}
            </button>
          ))}
        </div>
      </div>
      <div className="cat-list">
        {showArgs ? (
          <div className="args-cat">
            <div className="args-cat-note"><Icon name="info" size={13} /><span>Game arguments are passed after <span className="mono">%command%</span>. They depend on the game and may or may not work.</span></div>
            <div className="ai-tabs">
              {GAME_ARGS.map((g) => <button type="button" key={g.group} className={'ai-tab' + (argGroup === g.group ? ' on' : '')} onClick={() => setArgGroup(g.group)}>{g.group}</button>)}
            </div>
            {grp.args.map((a) => (
              <button type="button" key={a.text} className="cat-item" onClick={() => onAddArg(a.text)}>
                <div className="ci-main"><div className="ci-name mono">{a.text}{a.value ? <span className="ai-ph"> …</span> : null}</div><div className="ci-desc">{a.desc}</div></div>
                <span className="ci-add"><Icon name="plus" size={14} /></span>
              </button>
            ))}
          </div>
        ) : (
          <>
            {grouped.map(({ cat: c, items }) => (
              <div key={c.id}>
                <div className="cat-group-label"><span className="cgl-ico"><Icon name={c.icon} size={12} /></span>{c.name}<span style={{ color: 'var(--tx-faint)', fontFamily: 'var(--mono)', fontWeight: 400 }}>· {items.length}</span></div>
                {items.map((item) => <CatalogueRow key={item.id} item={item} state={stateFor(item)} onAdd={onAdd} />)}
              </div>
            ))}
            {grouped.length === 0 && <div className="cat-empty">No building blocks match “{q}”.</div>}
            {showCustom && (
              <div className="custom-add">
                <div className="ca-label"><Icon name="wand" size={13} style={{ color: 'var(--acc)' }} />Custom env / fragment</div>
                <div className="ca-row">
                  <input
                    value={customVal}
                    onChange={(e) => setCustomVal(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && customVal.trim()) { onAddCustom(customVal.trim()); setCustomVal(''); } }}
                    placeholder="KEY=VALUE or a command prefix"
                    spellCheck={false}
                  />
                  <button className="btn primary" style={{ height: 28 }} disabled={!customVal.trim()} onClick={() => { onAddCustom(customVal.trim()); setCustomVal(''); }}>
                    <Icon name="plus" size={13} />Add
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

export { Catalogue, CatalogueRow as CatalogueItem };
