import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Toolbar, GamesTable, BulkBar, Footer, Check, StatusBadge, WrapTag } from "./table.jsx";

const ROWS = [
  { id: "g1", name: "Elden Ring", appid: "1245620", status: "installed", compat: "default", launch: "PROTON_ENABLE_HDR=1 game %command%" },
  { id: "g2", name: "Stellaris", appid: "281990", status: "owned", compat: "exp", launch: "" },
];

describe("Check", () => {
  it("renders unchecked / checked / dash and stops propagation", () => {
    const onClick = vi.fn();
    const { rerender } = render(<Check state={false} onClick={onClick} />);
    expect(document.querySelector(".cbx")).not.toHaveClass("on");
    rerender(<Check state={true} onClick={onClick} />);
    expect(document.querySelector(".cbx.on")).toBeInTheDocument();
    rerender(<Check state="dash" onClick={onClick} />);
    expect(document.querySelector(".cbx.dash")).toBeInTheDocument();
    fireEvent.click(document.querySelector(".cbx"));
    expect(onClick).toHaveBeenCalled();
  });
});

describe("StatusBadge + WrapTag", () => {
  it("renders installed and owned badges", () => {
    const { rerender } = render(<StatusBadge status="installed" />);
    expect(screen.getByText("Installed")).toBeInTheDocument();
    rerender(<StatusBadge status="owned" />);
    expect(screen.getByText("Owned-only")).toBeInTheDocument();
  });
  it("renders a wrap tag only for non-none wrappers", () => {
    const { container, rerender } = render(<WrapTag launch="gamescope -- %command%" />);
    expect(container.querySelector(".wrap-tag")).toHaveTextContent("gamescope");
    rerender(<WrapTag launch="" />);
    expect(container.querySelector(".wrap-tag")).toBeNull();
  });
});

describe("Toolbar", () => {
  const props = () => ({
    search: "",
    setSearch: vi.fn(),
    filters: { installed: false, owned: false, custom: false, forced: false },
    toggleFilter: vi.fn(),
    counts: { installed: 12, owned: 2, custom: 4, forced: 0 },
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
    fireEvent.click(document.querySelector(".s-clear"));
    expect(p.setSearch).toHaveBeenCalledWith("");
  });
});

describe("GamesTable", () => {
  const props = (over = {}) => ({
    rows: ROWS,
    selected: new Set(["g1"]),
    sort: { col: "name", dir: "asc" },
    setSort: vi.fn(),
    onToggle: vi.fn(),
    onToggleAll: vi.fn(),
    headState: "dash",
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
    fireEvent.click(document.querySelector("thead .cbx"));
    expect(p.onToggleAll).toHaveBeenCalled();
  });

  it("sorts on a sortable header, toggling direction on the active column", () => {
    const p = props();
    render(<GamesTable {...p} />);
    fireEvent.click(screen.getByText("AppID"));
    expect(p.setSort).toHaveBeenCalled();
    // calling the updater with the same active col flips direction
    const updater = p.setSort.mock.calls[0][0];
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
    fireEvent.click(document.querySelectorAll(".row-act")[0]);
    expect(p.onRowMenu).toHaveBeenCalled();
  });

  it("shows a launch tooltip on hover and hides it on leave", () => {
    render(<GamesTable {...props()} />);
    const cell = document.querySelector(".launch-click");
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
      count: 3, installedCount: 2, ownedCount: 1,
      onSetLaunch: vi.fn(), onSetCompat: vi.fn(), onClearLaunch: vi.fn(), onClear: vi.fn(), disabled: false,
    };
    render(<BulkBar {...p} />);
    expect(screen.getByText(/installed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Set launch options/ }));
    fireEvent.click(screen.getByRole("button", { name: /Set compatibility/ }));
    fireEvent.click(screen.getByRole("button", { name: /Clear launch options/ }));
    fireEvent.click(screen.getByRole("button", { name: /Deselect/ }));
    expect(p.onSetLaunch).toHaveBeenCalled();
    expect(p.onSetCompat).toHaveBeenCalled();
    expect(p.onClearLaunch).toHaveBeenCalled();
    expect(p.onClear).toHaveBeenCalled();
  });
  it("disables write actions when disabled", () => {
    render(<BulkBar count={1} installedCount={1} ownedCount={0} onSetLaunch={vi.fn()} onSetCompat={vi.fn()} onClearLaunch={vi.fn()} onClear={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: /Set launch options/ })).toBeDisabled();
  });
});

describe("Footer", () => {
  it("shows counts and toggles Steam (start when stopped)", () => {
    const onStartSteam = vi.fn();
    render(<Footer total={36} installed={30} shown={36} selected={2} steamRunning={false} steamBusy={false} onCloseSteam={vi.fn()} onStartSteam={onStartSteam} />);
    expect(screen.getByText("selected")).toBeInTheDocument();
    fireEvent.click(document.querySelector(".foot-state"));
    expect(onStartSteam).toHaveBeenCalled();
  });
  it("calls close when running, and no-ops while busy", () => {
    const onCloseSteam = vi.fn();
    const { rerender } = render(<Footer total={1} installed={1} shown={1} selected={0} steamRunning={true} steamBusy={false} onCloseSteam={onCloseSteam} onStartSteam={vi.fn()} />);
    fireEvent.click(document.querySelector(".foot-state"));
    expect(onCloseSteam).toHaveBeenCalledTimes(1);
    rerender(<Footer total={1} installed={1} shown={1} selected={0} steamRunning={true} steamBusy={true} onCloseSteam={onCloseSteam} onStartSteam={vi.fn()} />);
    fireEvent.click(document.querySelector(".foot-state"));
    expect(onCloseSteam).toHaveBeenCalledTimes(1); // unchanged while busy
  });
});
