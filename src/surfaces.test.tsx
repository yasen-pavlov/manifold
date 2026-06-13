import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  Popover,
  CompatPicker,
  PresetPicker,
  RowMenu,
  SteamConfirm,
  SettingsSheet,
  WindowControls,
  Toasts,
  EmptyState,
} from "./surfaces";
import type { Game, Preset, Settings, Toast } from "./types";

const anchor = { left: 10, top: 0, bottom: 20 };
const qs = (sel: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`element not found: ${sel}`);
  return el;
};
const game = (over: Partial<Game> = {}): Game => ({ id: "g1", name: "G", appid: "1", status: "installed", compat: "default", launch: "", ...over });

describe("WindowControls", () => {
  it("renders mac traffic lights on the left", () => {
    render(<WindowControls side="left" />);
    expect(document.querySelector(".tb-dots")).toBeInTheDocument();
    fireEvent.click(qs(".tb-dot.c"));
    fireEvent.click(qs(".tb-dot.m"));
    fireEvent.click(qs(".tb-dot.x"));
  });
  it("renders win/linux controls on the right", () => {
    render(<WindowControls side="right" />);
    expect(document.querySelector(".win-ctl")).toBeInTheDocument();
    document.querySelectorAll(".wc").forEach((b) => fireEvent.click(b));
  });
});

describe("Popover", () => {
  it("renders children and closes on Escape and outside click", () => {
    const onClose = vi.fn();
    render(<Popover anchor={anchor} onClose={onClose} width={200}><div>inner</div></Popover>);
    expect(screen.getByText("inner")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
  it("flips position when near the viewport edge", () => {
    render(<Popover anchor={{ left: 99999, top: 99999, bottom: 99999 }} onClose={vi.fn()} width={300}><div>x</div></Popover>);
    expect(document.querySelector(".popover")).toBeInTheDocument();
  });
});

describe("CompatPicker", () => {
  it("lists tools and picks one", () => {
    const onPick = vi.fn();
    render(<CompatPicker anchor={anchor} targets={[game({ compat: "default" })]} onPick={onPick} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Proton - Experimental"));
    expect(onPick).toHaveBeenCalled();
  });
  it("flags a mixed selection", () => {
    render(<CompatPicker anchor={anchor} targets={[game({ compat: "default" }), game({ compat: "exp" })]} onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/mixed/)).toBeInTheDocument();
  });
});

describe("PresetPicker", () => {
  const presets: Preset[] = [
    { id: "p1", name: "Native HDR", desc: "Wayland HDR pipeline", value: "PROTON_ENABLE_HDR=1 %command%" },
    { id: "p2", name: "MangoHud", desc: "", value: "mangohud %command%" },
  ];
  it("shows the description (or the line as fallback) and picks one", () => {
    const onPick = vi.fn();
    render(<PresetPicker anchor={anchor} presets={presets} targets={[game(), game({ id: "g2" })]} onPick={onPick} onClose={vi.fn()} />);
    expect(screen.getByText(/Apply preset · 2 games/)).toBeInTheDocument();
    expect(screen.getByText("Wayland HDR pipeline")).toBeInTheDocument(); // desc shown when present
    expect(screen.getByText("mangohud %command%")).toBeInTheDocument();   // line fallback when no desc
    fireEvent.click(screen.getByText("MangoHud"));
    expect(onPick).toHaveBeenCalledWith(presets[1]);
  });
  it("shows an empty state when there are no presets", () => {
    render(<PresetPicker anchor={anchor} presets={[]} targets={[game()]} onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/No presets yet/)).toBeInTheDocument();
  });
});

describe("RowMenu", () => {
  it("fires each action", () => {
    const onAction = vi.fn();
    render(<RowMenu anchor={anchor} game={game({ name: "Elden Ring", appid: "1", launch: "game %command%" })} onAction={onAction} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText(/Set launch options/));
    fireEvent.click(screen.getByText(/Set compatibility/));
    fireEvent.click(screen.getByText(/Copy launch string/));
    fireEvent.click(screen.getByText(/Copy AppID/));
    fireEvent.click(screen.getByText(/Clear launch options/));
    expect(onAction).toHaveBeenCalledWith("launch");
    expect(onAction).toHaveBeenCalledWith("clear");
  });
  it("disables copy/clear when there is no launch line", () => {
    render(<RowMenu anchor={anchor} game={game({ name: "X", appid: "2", launch: "" })} onAction={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/Copy launch string/).closest("button")).toBeDisabled();
  });
});

describe("SteamConfirm", () => {
  it("offers cancel / close+apply / close+apply+reopen", () => {
    const onChoose = vi.fn();
    render(<SteamConfirm count={3} onChoose={onChoose} />);
    fireEvent.click(screen.getByRole("button", { name: /Close & apply/ }));
    fireEvent.click(screen.getByRole("button", { name: /reopen/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
    expect(onChoose).toHaveBeenCalledWith("closed");
    expect(onChoose).toHaveBeenCalledWith("reopen");
    expect(onChoose).toHaveBeenCalledWith("cancel");
  });
});

describe("Toasts", () => {
  it("renders, dismisses, and undoes", () => {
    const onDismiss = vi.fn(), onUndo = vi.fn();
    const toasts: Toast[] = [
      { id: 1, kind: "ok", title: "Saved", sub: "ok" },
      { id: 2, kind: "err", title: "Failed", undo: { kind: "launch", changes: [] } },
    ];
    render(<Toasts toasts={toasts} onDismiss={onDismiss} onUndo={onUndo} />);
    expect(screen.getByText("Saved")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
    expect(onUndo).toHaveBeenCalled();
    document.querySelectorAll(".b-dismiss").forEach((b) => fireEvent.click(b));
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe("EmptyState", () => {
  it("renders and retries", () => {
    const onRetry = vi.fn();
    render(<EmptyState onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: /Re-scan/ }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe("SettingsSheet", () => {
  const base = {
    settings: { steam_root: "", silent_start: true, window_controls: "auto", ui_scale: 0, close_to_tray: false, start_minimized: false } as Settings,
    effectiveRoot: "/home/u/.steam/steam",
    discovered: [{ path: "/home/u/.steam/steam", valid: true }, { path: "/tmp/x", valid: false }],
    systemScale: 1,
    onPreviewScale: vi.fn(),
    onSave: vi.fn(),
    onClose: vi.fn(),
  };
  it("renders, edits, previews scale, and saves the payload", () => {
    const p = { ...base, onSave: vi.fn(), onPreviewScale: vi.fn() };
    render(<SettingsSheet {...p} />);
    // edit steam root
    fireEvent.change(screen.getByPlaceholderText(/Auto-detect/), { target: { value: "/custom/steam" } });
    // pick a discovered root chip
    fireEvent.click(screen.getByText("/tmp/x"));
    // window controls segmented
    fireEvent.click(screen.getByRole("button", { name: /^Left$/ }));
    // silent toggle
    fireEvent.click(screen.getByRole("button", { name: /Normal window/ }));
    // close-to-tray toggle
    fireEvent.click(screen.getByRole("button", { name: /Hide to tray/ }));
    // start-minimized toggle
    fireEvent.click(screen.getByRole("button", { name: /Start in tray/ }));
    // scale step + auto
    fireEvent.click(screen.getByTitle("Larger"));
    expect(p.onPreviewScale).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle("Follow desktop scale"));
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(p.onSave).toHaveBeenCalledWith(expect.objectContaining({ window_controls: "left", silent_start: false, close_to_tray: true, start_minimized: true }));
  });
  it("cancels", () => {
    const p = { ...base, onClose: vi.fn() };
    render(<SettingsSheet {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
    expect(p.onClose).toHaveBeenCalled();
  });
});
