import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Toolbar, GamesTable, BulkBar, Footer, Check, StatusBadge, PresetTag } from "./table";
import type { Mock } from "vitest";
import type { Game, Preset, SortState, CheckState } from "./types";

const qs = (sel: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`element not found: ${sel}`);
  return el;
};

const ROWS: Game[] = [
  { id: "g1", name: "Elden Ring", appid: "1245620", status: "installed", compat: "default", launch: "PROTON_ENABLE_HDR=1 %command%" },
  { id: "g2", name: "Stellaris", appid: "281990", status: "owned", compat: "exp", launch: "" },
];
const PRESETS: Preset[] = [{ id: "ex_mangohud", name: "MangoHud overlay", desc: "", value: "mangohud %command%" }];

describe("Check", () => {
  it("renders unchecked / checked / dash and stops propagation", () => {
    const onClick = vi.fn();
    const { rerender } = render(<Check state={false} onClick={onClick} />);
    expect(document.querySelector(".cbx")).not.toHaveClass("on");
    rerender(<Check state={true} onClick={onClick} />);
    expect(document.querySelector(".cbx.on")).toBeInTheDocument();
    rerender(<Check state="dash" onClick={onClick} />);
    expect(document.querySelector(".cbx.dash")).toBeInTheDocument();
    fireEvent.click(qs(".cbx"));
    expect(onClick).toHaveBeenCalled();
  });
});

describe("StatusBadge + PresetTag", () => {
  it("renders installed and owned badges", () => {
    const { rerender } = render(<StatusBadge status="installed" />);
    expect(screen.getByText("Installed")).toBeInTheDocument();
    rerender(<StatusBadge status="owned" />);
    expect(screen.getByText("Owned-only")).toBeInTheDocument();
  });
  it("tags a matching launch with the preset name, ignoring trailing game args", () => {
    const { container } = render(<PresetTag launch="mangohud %command% -novid" presets={PRESETS} />);
    expect(container.querySelector(".preset-tag.matched")).toHaveTextContent("MangoHud overlay");
  });
  it("tags a non-matching launch as Custom and renders nothing for empty", () => {
    const { container, rerender } = render(<PresetTag launch="PROTON_LOG=1 %command%" presets={PRESETS} />);
    expect(container.querySelector(".preset-tag.custom")).toHaveTextContent("Custom");
    rerender(<PresetTag launch="" presets={PRESETS} />);
    expect(container.querySelector(".preset-tag")).toBeNull();
  });
});

describe("Toolbar", () => {
  const props = () => ({
    search: "",
    setSearch: vi.fn(),
    filters: { installed: false, owned: false, shortcut: false, custom: false, forced: false },
    toggleFilter: vi.fn(),
    counts: { installed: 12, owned: 2, shortcut: 3, custom: 4, forced: 0 },
    onOpenCmdk: vi.fn(),
  });
  it("types into search and toggles a filter + opens cmdk", () => {
    const p = props();
    render(<Toolbar {...p} />);
    fireEvent.change(screen.getByPlaceholderText(/Filter by name/), { target: { value: "eld" } });
    expect(p.setSearch).toHaveBeenCalledWith("eld");
    fireEvent.click(screen.getByRole("button", { name: /Installed/ }));
    expect(p.toggleFilter).toHaveBeenCalledWith("installed");
    fireEvent.click(screen.getByTitle(/Command palette/));
    expect(p.onOpenCmdk).toHaveBeenCalled();
  });
  it("shows a clear button when search has text", () => {
    const p = { ...props(), search: "x" };
    render(<Toolbar {...p} />);
    fireEvent.click(qs(".s-clear"));
    expect(p.setSearch).toHaveBeenCalledWith("");
  });
});

describe("GamesTable", () => {
  const props = (over: Partial<Parameters<typeof GamesTable>[0]> = {}) => ({
    rows: ROWS,
    presets: PRESETS,
    selected: new Set(["g1"]),
    sort: { col: "name", dir: "asc" } as SortState,
    setSort: vi.fn(),
    onToggle: vi.fn(),
    onToggleAll: vi.fn(),
    headState: "dash" as CheckState,
    onCompatClick: vi.fn(),
    onRowMenu: vi.fn(),
    onLaunchClick: vi.fn(),
    ...over,
  });

  it("renders rows and reflects selection", () => {
    render(<GamesTable {...props()} />);
    expect(screen.getByText("Elden Ring")).toBeInTheDocument();
    expect(document.querySelector("tr.sel")).toBeInTheDocument();
  });

  it("toggles a row and select-all", () => {
    const p = props();
    render(<GamesTable {...p} />);
    fireEvent.click(screen.getByText("Stellaris"));
    expect(p.onToggle).toHaveBeenCalledWith("g2");
    fireEvent.click(qs("thead .cbx"));
    expect(p.onToggleAll).toHaveBeenCalled();
  });

  it("sorts on a sortable header, toggling direction on the active column", () => {
    const p = props();
    render(<GamesTable {...p} />);
    fireEvent.click(screen.getByText("AppID"));
    expect(p.setSort).toHaveBeenCalled();
    // calling the updater with the same active col flips direction
    const updater = (p.setSort as Mock).mock.calls[0][0];
    expect(updater({ col: "appid", dir: "asc" })).toEqual({ col: "appid", dir: "desc" });
    expect(updater({ col: "name", dir: "asc" })).toEqual({ col: "appid", dir: "asc" });
  });

  it("fires compat / launch / row-menu handlers", () => {
    const p = props();
    render(<GamesTable {...p} />);
    fireEvent.click(screen.getByText("Default"));
    expect(p.onCompatClick).toHaveBeenCalled();
    fireEvent.click(screen.getByText(/PROTON_ENABLE_HDR/));
    expect(p.onLaunchClick).toHaveBeenCalled();
    fireEvent.click(qs(".row-act"));
    expect(p.onRowMenu).toHaveBeenCalled();
  });

  it("shows a launch tooltip on hover and hides it on leave", () => {
    render(<GamesTable {...props()} />);
    const cell = qs(".launch-click");
    fireEvent.mouseEnter(cell);
    expect(document.querySelector(".tip")).toBeInTheDocument();
    fireEvent.mouseLeave(cell);
    expect(document.querySelector(".tip")).not.toBeInTheDocument();
  });

  it("renders the empty state", () => {
    render(<GamesTable {...props({ rows: [] })} />);
    expect(screen.getByText(/No games match/)).toBeInTheDocument();
  });
});

describe("BulkBar", () => {
  it("renders counts and wires the actions", () => {
    const p = {
      count: 3, installedCount: 2, ownedCount: 1, shortcutCount: 0,
      onSetLaunch: vi.fn(), onApplyPreset: vi.fn(), onSetCompat: vi.fn(), onClearLaunch: vi.fn(), onClear: vi.fn(), disabled: false,
    };
    render(<BulkBar {...p} />);
    expect(screen.getByText(/installed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Set launch options/ }));
    fireEvent.click(screen.getByRole("button", { name: /Apply preset/ }));
    fireEvent.click(screen.getByRole("button", { name: /Set compatibility/ }));
    fireEvent.click(screen.getByRole("button", { name: /Clear launch options/ }));
    fireEvent.click(screen.getByRole("button", { name: /Deselect/ }));
    expect(p.onSetLaunch).toHaveBeenCalled();
    expect(p.onApplyPreset).toHaveBeenCalled();
    expect(p.onSetCompat).toHaveBeenCalled();
    expect(p.onClearLaunch).toHaveBeenCalled();
    expect(p.onClear).toHaveBeenCalled();
  });
  it("disables write actions when disabled", () => {
    render(<BulkBar count={1} installedCount={1} ownedCount={0} shortcutCount={0} onSetLaunch={vi.fn()} onApplyPreset={vi.fn()} onSetCompat={vi.fn()} onClearLaunch={vi.fn()} onClear={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: /Set launch options/ })).toBeDisabled();
  });
});

describe("Footer", () => {
  it("shows counts and toggles Steam (start when stopped)", () => {
    const onStartSteam = vi.fn();
    render(<Footer total={36} installed={30} shown={36} selected={2} steamRunning={false} steamBusy={false} onCloseSteam={vi.fn()} onStartSteam={onStartSteam} />);
    expect(screen.getByText("selected")).toBeInTheDocument();
    fireEvent.click(qs(".foot-state"));
    expect(onStartSteam).toHaveBeenCalled();
  });
  it("calls close when running, and no-ops while busy", () => {
    const onCloseSteam = vi.fn();
    const { rerender } = render(<Footer total={1} installed={1} shown={1} selected={0} steamRunning={true} steamBusy={false} onCloseSteam={onCloseSteam} onStartSteam={vi.fn()} />);
    fireEvent.click(qs(".foot-state"));
    expect(onCloseSteam).toHaveBeenCalledTimes(1);
    rerender(<Footer total={1} installed={1} shown={1} selected={0} steamRunning={true} steamBusy={true} onCloseSteam={onCloseSteam} onStartSteam={vi.fn()} />);
    fireEvent.click(qs(".foot-state"));
    expect(onCloseSteam).toHaveBeenCalledTimes(1); // unchanged while busy
  });
});
