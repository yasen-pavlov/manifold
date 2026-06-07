import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import App from "./app";

// The mocked invoke is dynamically reconfigured per test; treat it as a loose Mock.
const invokeMock = invoke as unknown as Mock;

const TOOLS = [
  { id: "default", name: "Default", note: "" },
  { id: "exp", name: "Proton - Experimental", note: "" },
  { id: "cachyos", name: "proton-cachyos", note: "" },
];
const PRESETS = [{ id: "pre_hdr", name: "Native HDR", desc: "hdr", value: "PROTON_ENABLE_HDR=1 game %command%" }];
const SETTINGS = { steam_root: "", silent_start: true, window_controls: "auto", ui_scale: 0, close_to_tray: false };

let steamRunning = false;
const games = () => [
  { id: "g1", name: "Elden Ring", appid: "1245620", status: "installed", compat: "cachyos", launch: "PROTON_USE_OPTISCALER=1 game %command%", sizeGB: 58 },
  { id: "g2", name: "Stellaris", appid: "281990", status: "owned", compat: "default", launch: "", sizeGB: 0 },
  { id: "g3", name: "Hades", appid: "1145360", status: "installed", compat: "default", launch: "game %command%", sizeGB: 8 },
];
const lib = (over: Record<string, unknown> = {}) => ({ games: games(), compat_tools: TOOLS, steam_running: steamRunning, steam_root: "/home/u/.steam/steam", ...over });

beforeEach(() => {
  steamRunning = false;
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case "scan_library": return lib();
      case "load_presets": return { presets: PRESETS };
      case "load_settings": return SETTINGS;
      case "get_system_scale": return 1;
      case "discover_steam_roots": return [{ path: "/home/u/.steam/steam", valid: true }];
      case "set_launch_options":
      case "set_compat_tool":
      case "close_steam": return lib({ steam_running: false });
      case "start_steam": return lib({ steam_running: true });
      case "save_presets":
      case "save_settings": return undefined;
      default: return undefined;
    }
  });
});

async function renderApp() {
  const u = render(<App />);
  await screen.findByText("Elden Ring");
  return u;
}
const called = (cmd: string) => invokeMock.mock.calls.filter((c) => c[0] === cmd);
const catItem = (text: string): HTMLElement => {
  const el = [...document.querySelectorAll<HTMLElement>(".builder-cat .cat-item")].find((i) => i.textContent?.includes(text));
  if (!el) throw new Error(`catalogue item not found: ${text}`);
  return el;
};

describe("App - load + library", () => {
  it("scans the library and renders games + footer counts", async () => {
    await renderApp();
    expect(called("scan_library").length).toBeGreaterThan(0);
    expect(screen.getByText("Stellaris")).toBeInTheDocument();
    expect(screen.getByText("Hades")).toBeInTheDocument();
  });

  it("filters via search", async () => {
    await renderApp();
    fireEvent.change(screen.getByPlaceholderText(/Filter by name/), { target: { value: "stellaris" } });
    expect(screen.queryByText("Elden Ring")).not.toBeInTheDocument();
    expect(screen.getByText("Stellaris")).toBeInTheDocument();
  });

  it("filters via the Installed chip", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: /Installed/ }));
    expect(screen.queryByText("Stellaris")).not.toBeInTheDocument();
  });
});

describe("App - launch options flow", () => {
  it("bulk-applies a launch line and supports undo", async () => {
    await renderApp();
    // select two games
    fireEvent.click(screen.getByText("Elden Ring"));
    fireEvent.click(screen.getByText("Hades"));
    fireEvent.click(screen.getByRole("button", { name: /Set launch options…/ }));
    // builder open (mixed selection -> empty line); add a wrapper to make it valid
    await screen.findByText("Set launch options");
    fireEvent.click(catItem("Native (Wayland)"));
    fireEvent.click(screen.getByRole("button", { name: /Apply to 2 games/ }));
    await waitFor(() => expect(called("set_launch_options").length).toBe(1));
    const changes = called("set_launch_options")[0][1].changes;
    expect(changes).toHaveLength(2);
    // undo
    const undoBtn = await screen.findByRole("button", { name: /Undo/ });
    fireEvent.click(undoBtn);
    await waitFor(() => expect(called("set_launch_options").length).toBe(2));
  });

  it("opens the builder from a row launch cell", async () => {
    await renderApp();
    fireEvent.click(screen.getByText(/PROTON_USE_OPTISCALER/));
    expect(await screen.findByText("Set launch options")).toBeInTheDocument();
  });

  it("clears launch options via the bulk bar", async () => {
    await renderApp();
    fireEvent.click(screen.getByText("Elden Ring"));
    fireEvent.click(screen.getByRole("button", { name: /Clear launch options/ }));
    await waitFor(() => expect(called("set_launch_options").length).toBe(1));
    expect(called("set_launch_options")[0][1].changes[0][1]).toBe("");
  });
});

describe("App - compatibility flow", () => {
  it("sets a compat tool on a selection", async () => {
    await renderApp();
    fireEvent.click(screen.getByText("Elden Ring"));
    fireEvent.click(screen.getByRole("button", { name: /Set compatibility…/ }));
    fireEvent.click(await screen.findByText("Proton - Experimental"));
    await waitFor(() => expect(called("set_compat_tool").length).toBe(1));
  });

  it("opens the compat picker from a row cell", async () => {
    await renderApp();
    // Stellaris compat is "Default"
    fireEvent.click(screen.getAllByText("Default")[0]);
    expect(await screen.findByText(/Compatibility ·/)).toBeInTheDocument();
  });
});

describe("App - row menu", () => {
  it("copies the appid and clears via the menu", async () => {
    const writeSpy = vi.spyOn(navigator.clipboard, "writeText");
    await renderApp();
    fireEvent.click(document.querySelectorAll(".row-act")[0]);
    fireEvent.click(await screen.findByText(/Copy AppID/));
    expect(writeSpy).toHaveBeenCalled();
    fireEvent.click(document.querySelectorAll(".row-act")[0]);
    fireEvent.click(await screen.findByText(/Clear launch options/));
    await waitFor(() => expect(called("set_launch_options").length).toBe(1));
  });
});

describe("App - Steam running", () => {
  it("shows the footer indicator and runs the close/apply/reopen flow", async () => {
    steamRunning = true;
    await renderApp();
    expect(screen.getByText(/Steam running/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Elden Ring"));
    fireEvent.click(screen.getByRole("button", { name: /Set launch options…/ }));
    await screen.findByText("Set launch options");
    fireEvent.click(screen.getByRole("button", { name: /Apply to 1 game/ }));
    // SteamConfirm appears
    fireEvent.click(await screen.findByRole("button", { name: /Close, apply & reopen/ }));
    await waitFor(() => {
      expect(called("close_steam").length).toBe(1);
      expect(called("set_launch_options").length).toBe(1);
      expect(called("start_steam").length).toBe(1);
    });
  });

  it("closes Steam from the footer", async () => {
    steamRunning = true;
    await renderApp();
    fireEvent.click(document.querySelector(".foot-state")!);
    await waitFor(() => expect(called("close_steam").length).toBe(1));
  });
});

describe("App - presets tab", () => {
  it("creates a preset", async () => {
    const user = userEvent.setup();
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: /Presets/ }));
    fireEvent.click(screen.getByRole("button", { name: /New preset/ }));
    const nameInput = await screen.findByPlaceholderText(/e\.g\. Native HDR/);
    await user.type(nameInput, "My Preset");
    // add a wrapper so the line is valid
    fireEvent.click(catItem("Native (Wayland)"));
    fireEvent.click(screen.getByRole("button", { name: /Save preset/ }));
    await waitFor(() => expect(called("save_presets").length).toBe(1));
  });

  it("edits, duplicates, and deletes a preset", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: /Presets/ }));
    const card = await screen.findByText("Native HDR");
    const cardEl = card.closest(".preset-card") as HTMLElement;
    fireEvent.click(within(cardEl).getByTitle("Duplicate"));
    await waitFor(() => expect(called("save_presets").length).toBe(1));
    fireEvent.click(within(cardEl).getByTitle("Delete"));
    await waitFor(() => expect(called("save_presets").length).toBe(2));
  });

  it("applies a preset to the current selection", async () => {
    await renderApp();
    fireEvent.click(screen.getByText("Elden Ring"));
    fireEvent.click(screen.getByRole("button", { name: /Presets/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Apply to 1/ }));
    await waitFor(() => expect(called("set_launch_options").length).toBe(1));
  });
});

describe("App - settings + command palette + tabs", () => {
  it("saves settings", async () => {
    await renderApp();
    fireEvent.click(screen.getByTitle("Settings"));
    fireEvent.click(await screen.findByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(called("save_settings").length).toBe(1));
  });

  it("opens the command palette with Ctrl+K and runs a command", async () => {
    await renderApp();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByPlaceholderText(/Type a command/);
    fireEvent.change(input, { target: { value: "Backups" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText(/Every write snapshots/)).toBeInTheDocument();
  });

  it("re-scans from the command palette", async () => {
    await renderApp();
    const before = called("scan_library").length;
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByPlaceholderText(/Type a command/);
    fireEvent.change(input, { target: { value: "Re-scan" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(called("scan_library").length).toBe(before + 1));
  });

  it("switches to the Backups tab", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: /Backups/ }));
    expect(await screen.findByText(/Every write snapshots/)).toBeInTheDocument();
  });
});

describe("App - keyboard", () => {
  it("Ctrl+A selects all and Escape clears selection", async () => {
    await renderApp();
    // Fire inside waitFor: the global keydown listener is re-attached on each
    // filteredIds change, so a single event can race a stale closure. Retrying
    // the dispatch (selectAll is idempotent) makes this deterministic.
    await waitFor(() => {
      fireEvent.keyDown(window, { key: "a", ctrlKey: true });
      expect(document.querySelector(".bulkbar")).toBeInTheDocument();
    });
    await waitFor(() => {
      fireEvent.keyDown(window, { key: "Escape" });
      expect(document.querySelector(".bulkbar")).not.toBeInTheDocument();
    });
  });
});
