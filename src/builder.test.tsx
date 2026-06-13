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
const toolPill = (): HTMLElement => { const w = pills().find((p) => p.classList.contains("pill-tool")); if (!w) throw new Error("no tool pill"); return w; };
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
    { id: "ex_native", name: "Native HDR", desc: "hdr", value: "PROTON_ENABLE_HDR=1 %command%" },
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
        context={{ mode: "apply", targets: [game()], initialPills: parseLine("PROTON_ENABLE_HDR=1 %command%") }}
      />,
    );
    expect(screen.getByText("Set launch options")).toBeInTheDocument();
    expect(pillByText("PROTON_ENABLE_HDR")).toBeTruthy();
    expect(document.querySelector(".cmd-divider")).toBeInTheDocument();
    expect(document.querySelector(".vstat.ok")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Apply to 1 game/ })).toBeEnabled();
  });

  it("adds and toggles catalogue items", () => {
    render(<BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: [] }} />);
    addFromCatalogue("PROTON_ENABLE_HDR");
    expect(pillByText("PROTON_ENABLE_HDR")).toBeTruthy();
    addFromCatalogue("PROTON_ENABLE_HDR");
    expect(pillByText("PROTON_ENABLE_HDR")).toBeFalsy();
  });

  it("tools are unique; gamescope is pinned last and owns %command%", () => {
    render(<BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: [] }} />);
    addFromCatalogue("MangoHud");
    addFromCatalogue("gamescope");
    const tools = pills().filter((p) => p.classList.contains("pill-tool"));
    expect(tools).toHaveLength(2);
    // gamescope sits last and is pinned
    expect(tools[tools.length - 1].textContent).toContain("gamescope");
    expect(tools[tools.length - 1].classList.contains("pinned-last")).toBe(true);
    // the final line ends with the gamescope terminator before %command%
    expect(qs(".prev-str").textContent).toMatch(/-- %command%$/);
    // adding gamescope again removes it
    addFromCatalogue("gamescope");
    expect(pills().some((p) => p.textContent?.includes("gamescope"))).toBe(false);
  });

  it("opens the tool popover, edits a sub-control, and applies", async () => {
    const user = userEvent.setup();
    render(<BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: [] }} />);
    addFromCatalogue("gamescope");
    await user.click(qs(".pbody.clickable", toolPill()));
    expect(document.querySelector(".tool-pop")).toBeInTheDocument();
    fireEvent.click(qs(".tool-pop .gs-toggle"));
    fireEvent.click(qs(".tool-pop .ep-foot .btn.primary"));
    expect(document.querySelector(".tool-pop")).not.toBeInTheDocument();
  });

  it("edits a choice pill via its popover", async () => {
    const user = userEvent.setup();
    render(<BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: parseLine("DXVK_HUD=fps %command%") }} />);
    await user.click(qs(".pbody.clickable", pillX("DXVK_HUD")));
    const choice = [...document.querySelectorAll<HTMLElement>(".ep-choice")].find((c) => c.textContent?.includes("full"));
    fireEvent.click(choice!);
    expect(pillX("DXVK_HUD").textContent).toContain("full");
  });

  it("edits an input pill via its popover", async () => {
    const user = userEvent.setup();
    render(<BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: parseLine("DXVK_FRAME_RATE=60 %command%") }} />);
    await user.click(qs(".pbody.clickable", pillX("DXVK_FRAME_RATE")));
    const input = qs(".ep-input-row input");
    await user.clear(input);
    await user.type(input, "144");
    fireEvent.click(qs(".editor-pop .ep-foot .btn.primary"));
    expect(pillX("DXVK_FRAME_RATE").textContent).toContain("144");
  });

  it("adds a post-command game argument from the inserter", () => {
    render(<BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: parseLine("mangohud %command%") }} />);
    // open the "Game arguments" catalogue tab, add -novid
    fireEvent.click(screen.getByRole("button", { name: /Game arguments/ }));
    const argItem = [...document.querySelectorAll<HTMLElement>(".args-cat .cat-item")].find((i) => i.textContent?.includes("-novid"));
    fireEvent.click(argItem!);
    expect(document.querySelector(".arg-chip")).toHaveTextContent("-novid");
    expect(qs(".prev-str").textContent).toContain("%command% -novid");
  });

  it("types game arguments into the post-command zone and backspaces them off", () => {
    render(<BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: parseLine("mangohud %command%") }} />);
    const input = qs(".post-input");
    fireEvent.change(input, { target: { value: "-novid" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(document.querySelector(".arg-chip")).toHaveTextContent("-novid");
    expect(qs(".prev-str").textContent).toContain("%command% -novid");
    // backspace on the empty input removes the last chip
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(document.querySelector(".arg-chip")).toBeNull();
  });

  it("inserts a common game arg from the in-line picker", () => {
    render(<BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: parseLine("mangohud %command%") }} />);
    fireEvent.click(qs(".post-pick"));
    expect(document.querySelector(".args-inserter")).toBeInTheDocument();
    const item = [...document.querySelectorAll<HTMLElement>(".args-inserter .ai-item")].find((i) => i.textContent?.includes("-novid"));
    fireEvent.click(item!);
    expect(document.querySelector(".arg-chip")).toHaveTextContent("-novid");
  });

  it("removes an arg chip via its remove button", () => {
    render(<BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: parseLine("mangohud %command% -dx11") }} />);
    expect(document.querySelector(".arg-chip")).toHaveTextContent("-dx11");
    fireEvent.click(qs(".arg-chip .px"));
    expect(document.querySelector(".arg-chip")).toBeNull();
  });

  it("adds a custom fragment from the catalogue, shown as a custom pill", () => {
    render(<BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: [] }} />);
    fireEvent.change(qs(".custom-add input"), { target: { value: "MY_VAR=1" } });
    fireEvent.click(qs(".custom-add .btn.primary"));
    const custom = pillX("MY_VAR=1");
    expect(custom.textContent).toContain("custom");
  });

  it("searches the catalogue across namespaces", () => {
    render(<BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: [] }} />);
    fireEvent.change(qs(".cat-search input"), { target: { value: "hdr" } });
    const items = [...document.querySelectorAll<HTMLElement>(".builder-cat .cat-item")];
    expect(items.some((i) => i.textContent?.includes("PROTON_ENABLE_HDR"))).toBe(true);
    expect(items.some((i) => i.textContent?.includes("PROTON_USE_NTSYNC"))).toBe(false);
  });

  it("removes a pill and clears the line", () => {
    render(<BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: parseLine("PROTON_ENABLE_HDR=1 mangohud %command%") }} />);
    fireEvent.click(qs(".px", pillX("PROTON_ENABLE_HDR")));
    expect(pillByText("PROTON_ENABLE_HDR")).toBeFalsy();
    fireEvent.click(screen.getByRole("button", { name: /^Clear$/ }));
    expect(pills()).toHaveLength(0);
    expect(document.querySelector(".zone-empty")).toBeInTheDocument();
  });

  it("reorders tool pills with drag events", () => {
    render(<BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: parseLine("mangohud gamemoderun %command%") }} />);
    const first = pillX("MangoHud");
    const second = pillX("gamemoderun");
    const dt = { effectAllowed: "", setData: () => {} };
    fireEvent.dragStart(qs(".pgrip", first), { dataTransfer: dt });
    fireEvent.dragEnter(second, { dataTransfer: dt });
    fireEvent.dragEnd(qs(".pgrip", first), { dataTransfer: dt });
    expect(pills().map((p) => p.textContent)[0]).toContain("gamemoderun");
  });

  it("reorders tool pills with the keyboard (arrow keys on the grip)", () => {
    render(<BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: parseLine("mangohud gamemoderun %command%") }} />);
    fireEvent.keyDown(qs(".pgrip", pillX("MangoHud")), { key: "ArrowRight" });
    expect(pills().map((p) => p.textContent)[0]).toContain("gamemoderun");
  });

  it("removes a tool pill via the grip Delete key", () => {
    render(<BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: parseLine("mangohud %command%") }} />);
    fireEvent.keyDown(qs(".pgrip", pillX("MangoHud")), { key: "Delete" });
    expect(pillByText("MangoHud")).toBeFalsy();
  });

  it("supports raw editing as an escape hatch", async () => {
    const user = userEvent.setup();
    render(<BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: parseLine("%command%") }} />);
    await user.click(screen.getByRole("button", { name: /Edit raw/ }));
    const ta = qs(".prev-raw");
    await user.clear(ta);
    await user.type(ta, "mangohud %command%");
    await user.click(screen.getByRole("button", { name: /Done editing/ }));
    expect(pillByText("MangoHud")).toBeTruthy();
  });

  it("copies the final line", async () => {
    const user = userEvent.setup();
    const writeSpy = vi.spyOn(navigator.clipboard, "writeText");
    render(<BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: parseLine("mangohud %command%") }} />);
    await user.click(qs(".copy-btn"));
    expect(writeSpy).toHaveBeenCalledWith("mangohud %command%");
  });

  it("disables apply when the line is empty", () => {
    render(<BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: [] }} />);
    expect(screen.getByRole("button", { name: /Apply to 1 game/ })).toBeDisabled();
  });

  it("keeps apply disabled after a raw-edit session is cleared (stale rawText guard)", async () => {
    const user = userEvent.setup();
    render(<BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [game()], initialPills: parseLine("mangohud %command%") }} />);
    await user.click(screen.getByRole("button", { name: /Edit raw/ }));
    await user.click(screen.getByRole("button", { name: /Done editing/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Clear$/ }));
    expect(screen.getByRole("button", { name: /Apply to 1 game/ })).toBeDisabled();
  });

  it("calls onApply with the composed line", () => {
    const props = baseProps();
    render(<BuilderSurface {...props} context={{ mode: "apply", targets: [game()], initialPills: parseLine("PROTON_ENABLE_HDR=1 %command%") }} />);
    fireEvent.click(screen.getByRole("button", { name: /Apply to 1 game/ }));
    expect(props.onApply).toHaveBeenCalledWith("PROTON_ENABLE_HDR=1 %command%");
  });

  it("save-as-preset hands the line to onStartFromPreset", () => {
    const props = baseProps();
    render(<BuilderSurface {...props} context={{ mode: "apply", targets: [game()], initialPills: parseLine("mangohud %command%") }} />);
    fireEvent.click(screen.getByRole("button", { name: /Save as preset/ }));
    expect(props.onStartFromPreset).toHaveBeenCalled();
  });

  it("shows a mixed-selection badge and the differing lines", () => {
    render(
      <BuilderSurface
        {...baseProps()}
        mixedLines={[["mangohud %command%", 2], ["", 1]]}
        context={{ mode: "apply", targets: [game({ id: "a" }), game({ id: "b" }), game({ id: "c" })], initialPills: [], mixedLines: [["mangohud %command%", 2], ["", 1]] }}
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
    render(<BuilderSurface {...props} context={{ mode: "preset", preset: null, initialPills: parseLine("mangohud %command%") }} />);
    const saveBtn = screen.getByRole("button", { name: /Save preset/ });
    expect(saveBtn).toBeDisabled();
    await user.type(qs(".preset-fields input"), "My Preset");
    expect(saveBtn).toBeEnabled();
    fireEvent.click(saveBtn);
    expect(props.onSavePreset).toHaveBeenCalledWith(
      expect.objectContaining({ name: "My Preset", value: "mangohud %command%" }),
    );
  });

  it("edits an existing preset (Save changes label)", () => {
    render(
      <BuilderSurface
        {...baseProps()}
        context={{ mode: "preset", preset: { id: "ex_native", name: "Native HDR", desc: "hdr", value: "mangohud %command%" }, initialPills: parseLine("mangohud %command%") }}
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
    { id: "p1", name: "Native HDR", desc: "hdr pipeline", value: "PROTON_ENABLE_HDR=1 %command%" },
    { id: "p2", name: "No desc", desc: "", value: "mangohud %command%" },
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
