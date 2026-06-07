import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BuilderSurface, PresetsList } from "./builder";
import { parseLine } from "./catalogue-data";
import type { Game } from "./types";

const qs = (sel: string, root: ParentNode = document): HTMLElement => {
  const el = root.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`element not found: ${sel}`);
  return el;
};
const pills = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(".pill-line .pill")];
const pillByText = (t: string): HTMLElement | undefined => pills().find((p) => p.textContent?.includes(t));
const pillX = (t: string): HTMLElement => { const p = pillByText(t); if (!p) throw new Error(`pill not found: ${t}`); return p; };
const wrapperPill = (): HTMLElement => { const w = pills().find((p) => p.classList.contains("is-wrapper")); if (!w) throw new Error("no wrapper pill"); return w; };
const game = (over: Partial<Game> = {}): Game => ({ id: "g1", name: "G", appid: "1", status: "installed", compat: "default", launch: "", ...over });

// click a catalogue item (right pane) by its visible name
function addFromCatalogue(name: string) {
  const items = [...document.querySelectorAll<HTMLElement>(".builder-cat .cat-item")];
  const el = items.find((i) => i.querySelector(".ci-name")?.textContent?.trim().startsWith(name));
  if (!el) throw new Error(`catalogue item not found: ${name}`);
  fireEvent.click(el);
}

const baseProps = () => ({
  presets: [
    { id: "pre_hdr", name: "Native HDR", desc: "hdr", value: "PROTON_ENABLE_HDR=1 game %command%" },
  ],
  onApply: vi.fn(),
  onSavePreset: vi.fn(),
  onClose: vi.fn(),
  onStartFromPreset: vi.fn(),
});

describe("BuilderSurface - apply context", () => {
  it("renders initial pills parsed from the shared line and validates ok", () => {
    render(
      <BuilderSurface
        {...baseProps()}
        context={{ mode: "apply", targets: [game()], initialPills: parseLine("PROTON_ENABLE_HDR=1 game %command%") }}
      />,
    );
    expect(screen.getByText("Set launch options")).toBeInTheDocument();
    expect(pillByText("PROTON_ENABLE_HDR")).toBeTruthy();
    expect(document.querySelector(".vstat.ok")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Apply to 1 game/ })).toBeEnabled();
  });

  it("adds and toggles catalogue items", () => {
    render(
      <BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: [] }} />,
    );
    addFromCatalogue("PROTON_ENABLE_HDR");
    expect(pillByText("PROTON_ENABLE_HDR")).toBeTruthy();
    // adding the same toggle again removes it
    addFromCatalogue("PROTON_ENABLE_HDR");
    expect(pillByText("PROTON_ENABLE_HDR")).toBeFalsy();
  });

  it("a wrapper is mutually exclusive and pinned with %command%", () => {
    render(
      <BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: [] }} />,
    );
    addFromCatalogue("Native (Wayland)");
    addFromCatalogue("XWayland");
    const wrappers = pills().filter((p) => p.classList.contains("is-wrapper"));
    expect(wrappers).toHaveLength(1);
    expect(wrappers[0].textContent).toContain("%command%");
  });

  it("opens the gamescope complex editor, edits sub-controls, and applies", async () => {
    const user = userEvent.setup();
    render(
      <BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: [] }} />,
    );
    addFromCatalogue("Gamescope");
    await user.click(qs(".pbody.clickable", wrapperPill()));
    expect(document.querySelector(".gs-pop")).toBeInTheDocument();
    // toggle one flag off then apply
    fireEvent.click(qs(".gs-toggle"));
    fireEvent.click(qs(".gs-pop .ep-foot .btn.primary"));
    expect(document.querySelector(".gs-pop")).not.toBeInTheDocument();
  });

  it("edits a choice pill via its popover", async () => {
    const user = userEvent.setup();
    render(
      <BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: parseLine("DXVK_HUD=fps game %command%") }} />,
    );
    await user.click(qs(".pbody.clickable", pillX("DXVK_HUD")));
    const choice = [...document.querySelectorAll<HTMLElement>(".ep-choice")].find((c) => c.textContent?.includes("full"));
    fireEvent.click(choice!);
    expect(pillX("DXVK_HUD").textContent).toContain("full");
  });

  it("edits an input pill via its popover", async () => {
    const user = userEvent.setup();
    render(
      <BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: parseLine("DXVK_FRAME_RATE=60 game %command%") }} />,
    );
    await user.click(qs(".pbody.clickable", pillX("DXVK_FRAME_RATE")));
    const input = qs(".ep-input-row input");
    await user.clear(input);
    await user.type(input, "144");
    fireEvent.click(qs(".editor-pop .ep-foot .btn.primary"));
    expect(pillX("DXVK_FRAME_RATE").textContent).toContain("144");
  });

  it("swaps the wrapper via the wrapper popover", async () => {
    const user = userEvent.setup();
    render(
      <BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: parseLine("game %command%") }} />,
    );
    await user.click(qs(".pbody.clickable", wrapperPill()));
    const choice = [...document.querySelectorAll<HTMLElement>(".ep-choice")].find((c) => c.textContent?.includes("XWayland"));
    fireEvent.click(choice!);
    expect(wrapperPill().textContent).toContain("XWayland");
  });

  it("removes a pill and clears the line", () => {
    render(
      <BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: parseLine("PROTON_ENABLE_HDR=1 game %command%") }} />,
    );
    fireEvent.click(qs(".px", pillX("PROTON_ENABLE_HDR")));
    expect(pillByText("PROTON_ENABLE_HDR")).toBeFalsy();
    fireEvent.click(screen.getByRole("button", { name: /^Clear$/ }));
    expect(pills()).toHaveLength(0);
    expect(document.querySelector(".line-empty")).toBeInTheDocument();
  });

  it("reorders reorderable pills with drag events", () => {
    render(
      <BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: parseLine("PROTON_ENABLE_HDR=1 PROTON_USE_NTSYNC=1 game %command%") }} />,
    );
    const first = pillX("PROTON_ENABLE_HDR");
    const second = pillX("PROTON_USE_NTSYNC");
    const dt = { effectAllowed: "", setData: () => {} };
    // the drag source is now the grip handle button
    fireEvent.dragStart(qs(".pgrip", first), { dataTransfer: dt });
    fireEvent.dragEnter(second, { dataTransfer: dt });
    fireEvent.dragEnd(qs(".pgrip", first), { dataTransfer: dt });
    const order = pills().map((p) => p.textContent);
    expect(order[0]).toContain("PROTON_USE_NTSYNC");
  });

  it("reorders pills with the keyboard (arrow keys on the grip)", () => {
    render(
      <BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: parseLine("PROTON_ENABLE_HDR=1 PROTON_USE_NTSYNC=1 game %command%") }} />,
    );
    const first = pillX("PROTON_ENABLE_HDR");
    fireEvent.keyDown(qs(".pgrip", first), { key: "ArrowRight" });
    expect(pills().map((p) => p.textContent)[0]).toContain("PROTON_USE_NTSYNC");
  });

  it("removes a pill via the grip Delete key", () => {
    render(
      <BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: parseLine("PROTON_ENABLE_HDR=1 game %command%") }} />,
    );
    fireEvent.keyDown(qs(".pgrip", pillX("PROTON_ENABLE_HDR")), { key: "Delete" });
    expect(pillByText("PROTON_ENABLE_HDR")).toBeFalsy();
  });

  it("supports raw editing as an escape hatch", async () => {
    const user = userEvent.setup();
    render(
      <BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: parseLine("game %command%") }} />,
    );
    await user.click(screen.getByRole("button", { name: /Edit raw/ }));
    const ta = qs(".prev-raw");
    await user.clear(ta);
    await user.type(ta, "mangohud game %command%");
    // toggle back to pills (parses the raw text)
    await user.click(screen.getByRole("button", { name: /Edit raw/ }));
    expect(pillByText("mangohud")).toBeTruthy();
  });

  it("copies the final line", async () => {
    const user = userEvent.setup();
    const writeSpy = vi.spyOn(navigator.clipboard, "writeText");
    render(
      <BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: parseLine("game %command%") }} />,
    );
    await user.click(qs(".copy-btn"));
    expect(writeSpy).toHaveBeenCalledWith("game %command%");
  });

  it("disables apply when the line is empty", () => {
    render(
      <BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: [] }} />,
    );
    expect(screen.getByRole("button", { name: /Apply to 1 game/ })).toBeDisabled();
  });

  it("calls onApply with the composed line", () => {
    const props = baseProps();
    render(
      <BuilderSurface {...props} context={{ mode: "apply", targets: [game()], initialPills: parseLine("PROTON_ENABLE_HDR=1 game %command%") }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Apply to 1 game/ }));
    expect(props.onApply).toHaveBeenCalledWith("PROTON_ENABLE_HDR=1 game %command%");
  });

  it("save-as-preset hands the line to onStartFromPreset", () => {
    const props = baseProps();
    render(
      <BuilderSurface {...props} context={{ mode: "apply", targets: [game()], initialPills: parseLine("game %command%") }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Save as preset/ }));
    expect(props.onStartFromPreset).toHaveBeenCalled();
  });

  it("shows a mixed-selection badge and the differing lines", () => {
    render(
      <BuilderSurface
        {...baseProps()}
        mixedLines={[["game %command%", 2], ["", 1]]}
        context={{ mode: "apply", targets: [game({ id: "a" }), game({ id: "b" }), game({ id: "c" })], initialPills: [], mixedLines: [["game %command%", 2], ["", 1]] }}
      />,
    );
    expect(screen.getByText(/mixed selection/)).toBeInTheDocument();
    expect(screen.getByText(/Current lines differ/)).toBeInTheDocument();
  });

  it("cancel calls onClose", () => {
    const props = baseProps();
    render(<BuilderSurface {...props} context={{ mode: "apply", targets: [game()], initialPills: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
    expect(props.onClose).toHaveBeenCalled();
  });
});

describe("BuilderSurface - preset context", () => {
  it("requires a name then saves the composed value", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    render(<BuilderSurface {...props} context={{ mode: "preset", preset: null, initialPills: parseLine("game %command%") }} />);
    const saveBtn = screen.getByRole("button", { name: /Save preset/ });
    expect(saveBtn).toBeDisabled();
    await user.type(qs(".preset-fields input"), "My Preset");
    expect(saveBtn).toBeEnabled();
    fireEvent.click(saveBtn);
    expect(props.onSavePreset).toHaveBeenCalledWith(
      expect.objectContaining({ name: "My Preset", value: "game %command%" }),
    );
  });

  it("edits an existing preset (Save changes label)", () => {
    render(
      <BuilderSurface
        {...baseProps()}
        context={{ mode: "preset", preset: { id: "pre_hdr", name: "Native HDR", desc: "hdr", value: "game %command%" }, initialPills: parseLine("game %command%") }}
      />,
    );
    expect(screen.getByRole("button", { name: /Save changes/ })).toBeInTheDocument();
  });

  it("loads a preset via 'Start from preset'", async () => {
    const user = userEvent.setup();
    render(<BuilderSurface {...baseProps()} context={{ mode: "preset", preset: null, initialPills: [] }} />);
    await user.click(screen.getByRole("button", { name: /Start from preset/ }));
    fireEvent.click(qs(".mixed-list .mixed-row"));
    expect(pillByText("PROTON_ENABLE_HDR")).toBeTruthy();
  });
});

describe("PresetsList", () => {
  const presets = [
    { id: "p1", name: "Native HDR", desc: "hdr pipeline", value: "PROTON_ENABLE_HDR=1 game %command%" },
    { id: "p2", name: "No desc", desc: "", value: "game %command%" },
  ];
  it("renders each preset with its blocks and line", () => {
    render(<PresetsList presets={presets} onNew={vi.fn()} onEdit={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} onApply={vi.fn()} hasSelection={false} selCount={0} />);
    expect(screen.getByText("Native HDR")).toBeInTheDocument();
    expect(screen.getByText("No description")).toBeInTheDocument();
    expect(document.querySelectorAll(".preset-card")).toHaveLength(2);
  });
  it("wires edit / duplicate / delete / new", () => {
    const onEdit = vi.fn(), onDuplicate = vi.fn(), onDelete = vi.fn(), onNew = vi.fn();
    render(<PresetsList presets={presets} onNew={onNew} onEdit={onEdit} onDuplicate={onDuplicate} onDelete={onDelete} onApply={vi.fn()} hasSelection={false} selCount={0} />);
    fireEvent.click(screen.getByRole("button", { name: /New preset/ }));
    const firstCard = qs(".preset-card");
    fireEvent.click(within(firstCard).getByTitle("Edit"));
    fireEvent.click(within(firstCard).getByTitle("Duplicate"));
    fireEvent.click(within(firstCard).getByTitle("Delete"));
    expect(onNew).toHaveBeenCalled();
    expect(onEdit).toHaveBeenCalled();
    expect(onDuplicate).toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalled();
  });
  it("shows apply-to-selection only when there is a selection", () => {
    const onApply = vi.fn();
    render(<PresetsList presets={presets} onNew={vi.fn()} onEdit={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} onApply={onApply} hasSelection selCount={3} />);
    const applyBtn = screen.getAllByRole("button", { name: /Apply to 3/ })[0];
    fireEvent.click(applyBtn);
    expect(onApply).toHaveBeenCalled();
  });
  it("renders an empty state", () => {
    render(<PresetsList presets={[]} onNew={vi.fn()} onEdit={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} onApply={vi.fn()} hasSelection={false} selCount={0} />);
    expect(screen.getByText(/No presets yet/)).toBeInTheDocument();
  });
});
