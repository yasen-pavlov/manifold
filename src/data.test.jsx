import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import {
  COMPAT_TOOLS,
  GAMES,
  parseWrapper,
  tokenizeLaunch,
  HiLaunch,
  LIBRARY_PATH,
  compatName,
  setCompatTools,
} from "./data.jsx";

describe("parseWrapper", () => {
  it("returns 'none' for empty / blank", () => {
    expect(parseWrapper("")).toBe("none");
    expect(parseWrapper("   ")).toBe("none");
    expect(parseWrapper(null)).toBe("none");
  });
  it("detects gamescope, xwayland, native", () => {
    expect(parseWrapper("gamescope -W 100 -- %command%")).toBe("gamescope");
    expect(parseWrapper("game_xwayland %command%")).toBe("xwayland");
    expect(parseWrapper("PROTON_ENABLE_WAYLAND=1 game %command%")).toBe("native");
  });
  it("detects 'other' for env/tool lines without a known wrapper", () => {
    expect(parseWrapper("mangohud %command%")).toBe("other");
    expect(parseWrapper("DXVK_HUD=fps %command%")).toBe("other");
    expect(parseWrapper("gamemoderun %command%")).toBe("other");
  });
  it("returns 'none' for a bare launcher with nothing notable", () => {
    expect(parseWrapper("somegame %command%")).toBe("none");
  });
});

describe("tokenizeLaunch", () => {
  it("returns [] for empty", () => {
    expect(tokenizeLaunch("")).toEqual([]);
  });
  it("classifies spaces, command, env, and plain tokens", () => {
    const toks = tokenizeLaunch("DXVK_HUD=fps game %command%");
    expect(toks.find((t) => t.t === "env").v).toBe("DXVK_HUD=fps");
    expect(toks.find((t) => t.t === "cmd").v).toBe("%command%");
    expect(toks.find((t) => t.t === "plain").v).toBe("game");
    expect(toks.some((t) => t.t === "sp")).toBe(true);
  });
});

describe("HiLaunch", () => {
  it("renders highlighted tokens", () => {
    const { container } = render(<HiLaunch value="DXVK_HUD=fps game %command%" />);
    expect(container.querySelector(".env")).toHaveTextContent("DXVK_HUD=fps");
    expect(container.querySelector(".cmd")).toHaveTextContent("%command%");
  });
  it("renders nothing meaningful for empty value", () => {
    const { container } = render(<HiLaunch value="" />);
    expect(container.querySelector(".env")).toBeNull();
  });
});

describe("compatName + setCompatTools", () => {
  beforeEach(() => {
    setCompatTools([
      { id: "default", name: "Default", note: "" },
      { id: "exp", name: "Proton - Experimental", note: "" },
    ]);
  });
  it("resolves a known id", () => {
    expect(compatName("exp")).toBe("Proton - Experimental");
  });
  it("falls back to the first tool for an unknown id", () => {
    expect(compatName("nope")).toBe("Default");
  });
  it("setCompatTools replaces the live list in place", () => {
    setCompatTools([{ id: "p9", name: "Proton 9", note: "" }]);
    expect(COMPAT_TOOLS[0].name).toBe("Proton 9");
    expect(compatName("p9")).toBe("Proton 9");
  });
  it("setCompatTools ignores empty / non-array input", () => {
    const before = COMPAT_TOOLS.length;
    setCompatTools([]);
    setCompatTools(null);
    expect(COMPAT_TOOLS.length).toBe(before);
  });
});

describe("static data", () => {
  it("ships mock games and a library path", () => {
    expect(GAMES.length).toBeGreaterThan(0);
    expect(GAMES[0]).toHaveProperty("appid");
    expect(LIBRARY_PATH).toContain("steam");
  });
});
