// table.jsx - toolbar, games table, bulk bar, footer
import React, { useState } from "react";
import { Icon } from "./icons.jsx";
import { parseWrapper, HiLaunch, compatName, LIBRARY_PATH } from "./data.jsx";

/* ---------------- Checkbox ---------------- */
function Check({ state, onClick }) {
  // state: false | true | 'dash'
  let cls = 'cbx';
  let icon = null;
  if (state === 'dash') {
    cls = 'cbx dash';
    icon = <Icon name="minus" size={11} stroke={3} />;
  } else if (state) {
    cls = 'cbx on';
    icon = <Icon name="check" size={11} stroke={3} />;
  }
  return (
    <button className={cls} onClick={(e) => { e.stopPropagation(); onClick(e); }}>
      {icon}
    </button>
  );
}

/* ---------------- Toolbar ---------------- */
function Toolbar({ search, setSearch, filters, toggleFilter, counts, onOpenCmdk }) {
  const FILTERS = [
    { id: 'installed', label: 'Installed', ct: counts.installed },
    { id: 'owned', label: 'Owned-only', ct: counts.owned },
    { id: 'custom', label: 'Custom launch', ct: counts.custom },
    { id: 'forced', label: 'Forced compat', ct: counts.forced },
  ];
  return (
    <div className="toolbar">
      <div className="search">
        <span className="s-ico"><Icon name="search" size={15} /></span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by name, appid, or launch string…"
          spellCheck={false}
        />
        {search && (
          <button className="s-clear" onClick={() => setSearch('')}><Icon name="x" size={13} /></button>
        )}
      </div>
      <div className="filters">
        {FILTERS.map((f) => (
          <button key={f.id} className={'chip' + (filters[f.id] ? ' on' : '')} onClick={() => toggleFilter(f.id)}>
            {f.label}<span className="c-ct">{f.ct}</span>
          </button>
        ))}
      </div>
      <div className="toolbar-spacer" />
      <button className="icon-btn" title="Command palette  ⌘K" onClick={onOpenCmdk}>
        <Icon name="command" size={15} />
      </button>
    </div>
  );
}

/* ---------------- Table ---------------- */
const COLUMNS = [
  { id: 'name', label: 'Game', cls: 'col-name', sortable: true },
  { id: 'appid', label: 'AppID', cls: 'col-appid', sortable: true },
  { id: 'status', label: 'Status', cls: 'col-status', sortable: true },
  { id: 'compat', label: 'Compatibility', cls: 'col-compat', sortable: true },
  { id: 'launch', label: 'Launch options', cls: 'col-launch', sortable: false },
];

function StatusBadge({ status }) {
  if (status === 'installed') {
    return <span className="badge installed"><span className="dot" />Installed</span>;
  }
  return <span className="badge owned"><span className="dot" />Owned-only</span>;
}

function WrapTag({ launch }) {
  const w = parseWrapper(launch);
  if (w === 'none') return null;
  const labels = { gamescope: 'gamescope', xwayland: 'xwayland', native: 'native', other: 'env' };
  return <span className={'wrap-tag ' + w}>{labels[w]}</span>;
}

function LaunchCell({ value }) {
  if (!value) return <span className="launch-empty">no launch options</span>;
  return (
    <div className="launch-cell">
      <span className="launch-str mono"><HiLaunch value={value} /></span>
    </div>
  );
}

function GameRow({ game, selected, onToggle, onCompatClick, onRowMenu, onLaunchClick, onTip }) {
  return (
    <tr className={selected ? 'sel' : ''} onClick={() => onToggle(game.id)}>
      <td className="col-check">
        <Check state={selected} onClick={() => onToggle(game.id)} />
      </td>
      <td className="col-name">
        <div className="g-name">{game.name}<WrapTag launch={game.launch} /></div>
      </td>
      <td className="col-appid"><span className="g-appid">{game.appid}</span></td>
      <td className="col-status"><StatusBadge status={game.status} /></td>
      <td className="col-compat">
        <button
          className={'compat-cell mono' + (game.compat === 'default' ? ' is-default' : '')}
          onClick={(e) => { e.stopPropagation(); onCompatClick(e, game); }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{compatName(game.compat)}</span>
          <span className="cc-chev"><Icon name="chevronsUpDown" size={12} /></span>
        </button>
      </td>
      <td className="col-launch">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div
            className="launch-click"
            style={{ flex: 1, minWidth: 0 }}
            role="button"
            tabIndex={0}
            title={game.launch || undefined}
            onClick={(e) => { e.stopPropagation(); onLaunchClick(game); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onLaunchClick(game); } }}
            onMouseEnter={(e) => { if (game.launch) onTip(e, game.launch); }}
            onMouseLeave={() => onTip(null)}
          >
            <LaunchCell value={game.launch} />
          </div>
          <button className="row-act" onClick={(e) => { e.stopPropagation(); onRowMenu(e, game); }}>
            <Icon name="more" size={15} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function GamesTable({ rows, selected, sort, setSort, onToggle, onToggleAll, headState, onCompatClick, onRowMenu, onLaunchClick }) {
  const [tip, setTip] = useState(null);
  const onTip = (e, value) => {
    if (!e) { setTip(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ value, x: r.left, y: r.bottom + 6 });
  };
  const setSortCol = (id) => {
    setSort((s) => s.col === id ? { col: id, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col: id, dir: 'asc' });
  };
  return (
    <div className="table-wrap">
      <table className="grid">
        <thead>
          <tr>
            <th className="col-check">
              <Check state={headState} onClick={onToggleAll} />
            </th>
            {COLUMNS.map((c) => (
              <th
                key={c.id}
                className={c.cls + (c.sortable ? ' sortable' : '')}
                onClick={c.sortable ? () => setSortCol(c.id) : undefined}
              >
                <span className="th-in">
                  {c.label}
                  {sort.col === c.id && (
                    <span className="sort-i"><Icon name={sort.dir === 'asc' ? 'chevronUp' : 'chevronDown'} size={12} /></span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((game) => (
            <GameRow
              key={game.id}
              game={game}
              selected={selected.has(game.id)}
              onToggle={onToggle}
              onCompatClick={onCompatClick}
              onRowMenu={onRowMenu}
              onLaunchClick={onLaunchClick}
              onTip={onTip}
            />
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div style={{ padding: '60px', textAlign: 'center', color: 'var(--tx-faint)', fontSize: 13 }}>
          <Icon name="search" size={22} style={{ marginBottom: 8, opacity: 0.5 }} /><br />
          No games match the current filter.
        </div>
      )}
      {tip && (
        <div className="tip mono" style={{ left: Math.min(tip.x, window.innerWidth - 380), top: tip.y }}>
          <HiLaunch value={tip.value} />
        </div>
      )}
    </div>
  );
}

/* ---------------- Bulk bar ---------------- */
function BulkBar({ count, installedCount, ownedCount, onSetLaunch, onSetCompat, onClearLaunch, onClear, disabled }) {
  return (
    <div className="bulkbar">
      <div className="bulk-count">
        <b className="tnum">{count}</b> selected
        {ownedCount > 0 && (
          <span className="bulk-sub">· {installedCount} installed · {ownedCount} owned-only</span>
        )}
      </div>
      <div className="bulk-spacer" />
      <button className="btn ghost" onClick={onClearLaunch} disabled={disabled}>
        <Icon name="x" size={14} />Clear launch options
      </button>
      <button className="btn" onClick={onSetCompat} disabled={disabled}>
        <Icon name="cpu" size={14} />Set compatibility…
      </button>
      <button className="btn primary" onClick={onSetLaunch} disabled={disabled}>
        <Icon name="terminal" size={14} />Set launch options…
      </button>
      <button className="bulk-clear" onClick={onClear}>
        <Icon name="x" size={13} />Deselect
      </button>
    </div>
  );
}

/* ---------------- Footer ---------------- */
function Footer({ total, installed, shown, selected, steamRunning, steamBusy, onCloseSteam, onStartSteam }) {
  const steamAction = steamRunning ? onCloseSteam : onStartSteam;
  const onClick = steamBusy ? undefined : steamAction;
  const steamLabel = steamRunning ? 'Close Steam' : 'Start Steam';
  const title = steamBusy ? 'Working…' : steamLabel;
  const runText = steamRunning ? 'running' : 'stopped';
  const stateText = steamBusy ? 'working…' : runText;
  const runHint = steamRunning ? '· close' : '· start';
  const actionHint = steamBusy ? '' : runHint;
  return (
    <div className="footer">
      <div className="foot-item">
        <Icon name="layers" size={13} style={{ opacity: 0.7 }} />
        <span className="mono tnum">{shown}</span>
        <span style={{ color: 'var(--tx-faint)' }}>shown</span>
        <span style={{ color: 'var(--tx-faint)' }}>/</span>
        <span className="mono tnum">{total}</span>
        <span style={{ color: 'var(--tx-faint)' }}>games</span>
      </div>
      <div className="foot-item">
        <span className="mono tnum">{installed}</span>
        <span style={{ color: 'var(--tx-faint)' }}>installed</span>
      </div>
      {selected > 0 && (
        <div className="foot-item" style={{ color: 'var(--acc-text)' }}>
          <span className="mono tnum">{selected}</span>
          <span>selected</span>
        </div>
      )}
      <div className="foot-spacer" />
      <div className="foot-item foot-path">{LIBRARY_PATH}</div>
      <div
        className={'foot-item clickable foot-state ' + (steamRunning ? 'running' : 'stopped')}
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => { if (onClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick(); } }}
        title={title}
      >
        <span className="dot" />
        <span>Steam {stateText}</span>
        <span style={{ color: 'var(--tx-faint)', marginLeft: 4 }}>{actionHint}</span>
      </div>
    </div>
  );
}

export { Toolbar, GamesTable, BulkBar, Footer, Check, StatusBadge, WrapTag };
