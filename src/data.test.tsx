import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import {
  COMPAT_TOOLS,
  GAMES,
  MOCK_PRESETS,
  matchPresetForLaunch,
  preCommandKey,
  tokenizeLaunch,
  HiLaunch,
  LIBRARY_PATH,
  compatName,
  setCompatTools,
} from "./data";

describe("preCommandKey", () => {
  it("normalises whitespace and drops the post-command tail", () => {
    expect(preCommandKey("  mangohud   %command%  -novid ")).toBe("mangohud");
    expect(preCommandKey("PROTON_ENABLE_HDR=1 DXVK_HDR=1 %command%")).toBe("PROTON_ENABLE_HDR=1 DXVK_HDR=1");
  });
  it("returns '' for empty or command-only lines", () => {
    expect(preCommandKey("")).toBe("");
    expect(preCommandKey(null)).toBe("");
    expect(preCommandKey("%command% -novid")).toBe("");
  });
});

describe("matchPresetForLaunch", () => {
  it("matches a game line to a preset by its pre-command segment", () => {
    const p = matchPresetForLaunch("mangohud %command%", MOCK_PRESETS);
    expect(p?.id).toBe("ex_mangohud");
  });
  it("still matches when the game adds trailing game args", () => {
    const p = matchPresetForLaunch("mangohud %command% -skipmovies", MOCK_PRESETS);
    expect(p?.id).toBe("ex_mangohud");
  });
  it("returns null for an empty launch or a non-matching custom line", () => {
    expect(matchPresetForLaunch("", MOCK_PRESETS)).toBeNull();
    expect(matchPresetForLaunch("PROTON_LOG=1 %command%", MOCK_PRESETS)).toBeNull();
  });
});

describe("tokenizeLaunch", () => {
  it("returns [] for empty", () => {
    expect(tokenizeLaunch("")).toEqual([]);
  });
  it("classifies spaces, command, env, and plain tokens", () => {
    const toks = tokenizeLaunch("DXVK_HUD=fps mangohud %command%");
    expect(toks.find((t) => t.t === "env")!.v).toBe("DXVK_HUD=fps");
    expect(toks.find((t) => t.t === "cmd")!.v).toBe("%command%");
    expect(toks.find((t) => t.t === "plain")!.v).toBe("mangohud");
    expect(toks.some((t) => t.t === "sp")).toBe(true);
  });
});

describe("HiLaunch", () => {
  it("renders highlighted tokens", () => {
    const { container } = render(<HiLaunch value="DXVK_HUD=fps mangohud %command%" />);
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
  it("ships mock games, example presets, and a library path", () => {
    expect(GAMES.length).toBeGreaterThan(0);
    expect(GAMES[0]).toHaveProperty("appid");
    expect(MOCK_PRESETS.length).toBe(3);
    expect(LIBRARY_PATH).toContain("steam");
  });
  it("no mock game references a retired wrapper script", () => {
    expect(GAMES.every((g) => !/\bgame(_xwayland|_gamescope)?\b|gamescope_proton|gamescope_native/.test(g.launch))).toBe(true);
  });
});
