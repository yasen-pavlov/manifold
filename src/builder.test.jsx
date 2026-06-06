import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BuilderSurface, PresetsList } from "./builder.jsx";
import { parseLine } from "./catalogue-data.jsx";

// click a catalogue item (right pane) by its visible name
function addFromCatalogue(name) {
  const items = [...document.querySelectorAll(".builder-cat .cat-item")];
  const el = items.find((i) => i.querySelector(".ci-name")?.textContent.trim().startsWith(name));
  if (!el) throw new Error(`catalogue item not found: ${name}`);
  fireEvent.click(el);
}
const pills = () => [...document.querySelectorAll(".pill-line .pill")];
const pillByText = (t) => pills().find((p) => p.textContent.includes(t));

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
        context={{ mode: "apply", targets: [{ id: "g1" }], initialPills: parseLine("PROTON_ENABLE_HDR=1 game %command%") }}
      />,
    );
    expect(screen.getByText("Set launch options")).toBeInTheDocument();
    expect(pillByText("PROTON_ENABLE_HDR")).toBeTruthy();
    expect(document.querySelector(".vstat.ok")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Apply to 1 game/ })).toBeEnabled();
  });

  it("adds and toggles catalogue items", () => {
    render(
      <BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [{ id: "g1" }], initialPills: [] }} />,
    );
    addFromCatalogue("PROTON_ENABLE_HDR");
    expect(pillByText("PROTON_ENABLE_HDR")).toBeTruthy();
    // adding the same toggle again removes it
    addFromCatalogue("PROTON_ENABLE_HDR");
    expect(pillByText("PROTON_ENABLE_HDR")).toBeFalsy();
  });

  it("a wrapper is mutually exclusive and pinned with %command%", () => {
    render(
      <BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [{ id: "g1" }], initialPills: [] }} />,
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
      <BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [{ id: "g1" }], initialPills: [] }} />,
    );
    addFromCatalogue("Gamescope");
    const wrap = pills().find((p) => p.classList.contains("is-wrapper"));
    await user.click(wrap.querySelector(".pbody.clickable"));
    expect(document.querySelector(".gs-pop")).toBeInTheDocument();
    // toggle one flag off then apply
    const firstToggle = document.querySelector(".gs-toggle");
    fireEvent.click(firstToggle);
    fireEvent.click(document.querySelector(".gs-pop .ep-foot .btn.primary"));
    expect(document.querySelector(".gs-pop")).not.toBeInTheDocument();
  });

  it("edits a choice pill via its popover", async () => {
    const user = userEvent.setup();
    render(
      <BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [{ id: "g1" }], initialPills: parseLine("DXVK_HUD=fps game %command%") }} />,
    );
    await user.click(pillByText("DXVK_HUD").querySelector(".pbody.clickable"));
    const choice = [...document.querySelectorAll(".ep-choice")].find((c) => c.textContent.includes("full"));
    fireEvent.click(choice);
    expect(pillByText("DXVK_HUD").textContent).toContain("full");
  });

  it("edits an input pill via its popover", async () => {
    const user = userEvent.setup();
    render(
      <BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [{ id: "g1" }], initialPills: parseLine("DXVK_FRAME_RATE=60 game %command%") }} />,
    );
    await user.click(pillByText("DXVK_FRAME_RATE").querySelector(".pbody.clickable"));
    const input = document.querySelector(".ep-input-row input");
    await user.clear(input);
    await user.type(input, "144");
    fireEvent.click(document.querySelector(".editor-pop .ep-foot .btn.primary"));
    expect(pillByText("DXVK_FRAME_RATE").textContent).toContain("144");
  });

  it("swaps the wrapper via the wrapper popover", async () => {
    const user = userEvent.setup();
    render(
      <BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [{ id: "g1" }], initialPills: parseLine("game %command%") }} />,
    );
    const wrap = pills().find((p) => p.classList.contains("is-wrapper"));
    await user.click(wrap.querySelector(".pbody.clickable"));
    const choice = [...document.querySelectorAll(".ep-choice")].find((c) => c.textContent.includes("XWayland"));
    fireEvent.click(choice);
    expect(pills().find((p) => p.classList.contains("is-wrapper")).textContent).toContain("XWayland");
  });

  it("removes a pill and clears the line", () => {
    render(
      <BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [{ id: "g1" }], initialPills: parseLine("PROTON_ENABLE_HDR=1 game %command%") }} />,
    );
    fireEvent.click(pillByText("PROTON_ENABLE_HDR").querySelector(".px"));
    expect(pillByText("PROTON_ENABLE_HDR")).toBeFalsy();
    fireEvent.click(screen.getByRole("button", { name: /^Clear$/ }));
    expect(pills()).toHaveLength(0);
    expect(document.querySelector(".line-empty")).toBeInTheDocument();
  });

  it("reorders reorderable pills with drag events", () => {
    render(
      <BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [{ id: "g1" }], initialPills: parseLine("PROTON_ENABLE_HDR=1 PROTON_USE_NTSYNC=1 game %command%") }} />,
    );
    const first = pillByText("PROTON_ENABLE_HDR");
    const second = pillByText("PROTON_USE_NTSYNC");
    const dt = { effectAllowed: "", setData: () => {} };
    // the drag source is now the grip handle button
    fireEvent.dragStart(first.querySelector(".pgrip"), { dataTransfer: dt });
    fireEvent.dragEnter(second, { dataTransfer: dt });
    fireEvent.dragEnd(first.querySelector(".pgrip"), { dataTransfer: dt });
    const order = pills().map((p) => p.textContent);
    expect(order[0]).toContain("PROTON_USE_NTSYNC");
  });

  it("reorders pills with the keyboard (arrow keys on the grip)", () => {
    render(
      <BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [{ id: "g1" }], initialPills: parseLine("PROTON_ENABLE_HDR=1 PROTON_USE_NTSYNC=1 game %command%") }} />,
    );
    const first = pillByText("PROTON_ENABLE_HDR");
    fireEvent.keyDown(first.querySelector(".pgrip"), { key: "ArrowRight" });
    expect(pills().map((p) => p.textContent)[0]).toContain("PROTON_USE_NTSYNC");
  });

  it("removes a pill via the grip Delete key", () => {
    render(
      <BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [{ id: "g1" }], initialPills: parseLine("PROTON_ENABLE_HDR=1 game %command%") }} />,
    );
    fireEvent.keyDown(pillByText("PROTON_ENABLE_HDR").querySelector(".pgrip"), { key: "Delete" });
    expect(pillByText("PROTON_ENABLE_HDR")).toBeFalsy();
  });

  it("supports raw editing as an escape hatch", async () => {
    const user = userEvent.setup();
    render(
      <BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [{ id: "g1" }], initialPills: parseLine("game %command%") }} />,
    );
    await user.click(screen.getByRole("button", { name: /Edit raw/ }));
    const ta = document.querySelector(".prev-raw");
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
      <BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [{ id: "g1" }], initialPills: parseLine("game %command%") }} />,
    );
    await user.click(document.querySelector(".copy-btn"));
    expect(writeSpy).toHaveBeenCalledWith("game %command%");
  });

  it("disables apply when the line is empty", () => {
    render(
      <BuilderSurface {...baseProps()} context={{ mode: "apply", targets: [{ id: "g1" }], initialPills: [] }} />,
    );
    expect(screen.getByRole("button", { name: /Apply to 1 game/ })).toBeDisabled();
  });

  it("calls onApply with the composed line", () => {
    const props = baseProps();
    render(
      <BuilderSurface {...props} context={{ mode: "apply", targets: [{ id: "g1" }], initialPills: parseLine("PROTON_ENABLE_HDR=1 game %command%") }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Apply to 1 game/ }));
    expect(props.onApply).toHaveBeenCalledWith("PROTON_ENABLE_HDR=1 game %command%");
  });

  it("save-as-preset hands the line to onStartFromPreset", () => {
    const props = baseProps();
    render(
      <BuilderSurface {...props} context={{ mode: "apply", targets: [{ id: "g1" }], initialPills: parseLine("game %command%") }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Save as preset/ }));
    expect(props.onStartFromPreset).toHaveBeenCalled();
  });

  it("shows a mixed-selection badge and the differing lines", () => {
    render(
      <BuilderSurface
        {...baseProps()}
        mixedLines={[["game %command%", 2], ["", 1]]}
        context={{ mode: "apply", targets: [{ id: "a" }, { id: "b" }, { id: "c" }], initialPills: [], mixedLines: [["game %command%", 2], ["", 1]] }}
      />,
    );
    expect(screen.getByText(/mixed selection/)).toBeInTheDocument();
    expect(screen.getByText(/Current lines differ/)).toBeInTheDocument();
  });

  it("cancel calls onClose", () => {
    const props = baseProps();
    render(<BuilderSurface {...props} context={{ mode: "apply", targets: [{ id: "g1" }], initialPills: [] }} />);
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
    await user.type(document.querySelector(".preset-fields input"), "My Preset");
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
    fireEvent.click(document.querySelector(".mixed-list .mixed-row"));
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
    const firstCard = document.querySelector(".preset-card");
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
