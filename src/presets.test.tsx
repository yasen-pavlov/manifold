import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BackupsView, CommandPalette } from "./presets";

describe("BackupsView", () => {
  it("lists backups and restores one", () => {
    const onRestore = vi.fn();
    render(<BackupsView onRestore={onRestore} />);
    expect(screen.getByText("Backups")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Restore/ })[0]);
    expect(onRestore).toHaveBeenCalled();
  });
});

describe("CommandPalette", () => {
  const commands = [
    { id: "a", group: "Go to", icon: "layers", name: "Library", run: vi.fn() },
    { id: "b", group: "Go to", icon: "bookmark", name: "Presets", run: vi.fn() },
    { id: "c", group: "Create", icon: "plus", name: "New preset", hint: "n", run: vi.fn() },
  ];
  it("filters, navigates with arrows, and runs on Enter", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CommandPalette commands={commands} onClose={onClose} />);
    const input = screen.getByPlaceholderText(/Type a command/);
    await user.type(input, "preset");
    expect(screen.getByText("New preset")).toBeInTheDocument();
    expect(screen.queryByText("Library")).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(commands[1].run).toHaveBeenCalled(); // "Presets"
    expect(onClose).toHaveBeenCalled();
  });
  it("runs a command on click and closes on Escape", () => {
    const onClose = vi.fn();
    render(<CommandPalette commands={commands} onClose={onClose} />);
    fireEvent.click(screen.getByText("Library"));
    expect(commands[0].run).toHaveBeenCalled();
    render(<CommandPalette commands={commands} onClose={onClose} />);
    fireEvent.keyDown(screen.getAllByPlaceholderText(/Type a command/)[0], { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
  it("shows a no-match state", async () => {
    const user = userEvent.setup();
    render(<CommandPalette commands={commands} onClose={vi.fn()} />);
    await user.type(screen.getByPlaceholderText(/Type a command/), "zzzz");
    expect(screen.getByText(/No commands match/)).toBeInTheDocument();
  });
});
