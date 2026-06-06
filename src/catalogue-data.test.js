import { describe, it, expect } from "vitest";
import {
  CATEGORIES,
  CATALOGUE,
  CAT_BY_ID,
  GAMESCOPE_SCHEMA,
  GAMESCOPE_DEFAULT,
  makePill,
  makeCustomPill,
  pillTokens,
  gamescopeTokens,
  composeLine,
  validateLine,
  parseLine,
  isEnvToken,
  KNOWN_PATH,
  STALE_TOKENS,
} from "./catalogue-data.jsx";

describe("catalogue data integrity", () => {
  it("every catalogue item has a known category and a unique id", () => {
    const catIds = new Set(CATEGORIES.map((c) => c.id));
    const seen = new Set();
    for (const item of CATALOGUE) {
      expect(catIds.has(item.cat)).toBe(true);
      expect(seen.has(item.id)).toBe(false);
      seen.add(item.id);
    }
  });

  it("CAT_BY_ID maps ids to items", () => {
    expect(CAT_BY_ID.w_native.name).toBe("Native (Wayland)");
    expect(CAT_BY_ID.p_hdr.token).toBe("PROTON_ENABLE_HDR=1");
  });

  it("exposes the gamescope schema + defaults", () => {
    expect(GAMESCOPE_SCHEMA.flags.length).toBeGreaterThan(0);
    expect(GAMESCOPE_DEFAULT.W).toBe("3840");
  });
});

describe("isEnvToken", () => {
  it("recognizes KEY=VALUE env tokens", () => {
    expect(isEnvToken("PROTON_ENABLE_HDR=1")).toBe(true);
    expect(isEnvToken("DXVK_HUD=fps")).toBe(true);
  });
  it("rejects non-env tokens", () => {
    expect(isEnvToken("mangohud")).toBe(false);
    expect(isEnvToken("%command%")).toBe(false);
    expect(isEnvToken("--flag")).toBe(false);
  });
});

describe("makePill", () => {
  it("builds a toggle pill carrying its token", () => {
    const p = makePill(CAT_BY_ID.p_hdr);
    expect(p.kind).toBe("toggle");
    expect(p.token).toBe("PROTON_ENABLE_HDR=1");
    expect(p.uid).toMatch(/^pill/);
    expect(p.itemId).toBe("p_hdr");
  });
  it("builds a tool pill", () => {
    expect(makePill(CAT_BY_ID.t_mangohud).token).toBe("mangohud");
  });
  it("builds a choice pill defaulting to its default value", () => {
    const p = makePill(CAT_BY_ID.d_hud);
    expect(p.kind).toBe("choice");
    expect(p.value).toBe("fps");
    expect(p.choices).toContain("full");
  });
  it("builds an input pill with empty default falling back to ''", () => {
    const p = makePill(CAT_BY_ID.v_cache);
    expect(p.kind).toBe("input");
    expect(p.value).toBe("");
    expect(p.inputType).toBe("path");
  });
  it("builds a wrapper pill with its head", () => {
    expect(makePill(CAT_BY_ID.w_native).head).toBe("game");
  });
  it("builds a complex (gamescope) pill with a cfg clone", () => {
    const p = makePill(CAT_BY_ID.w_gamescope);
    expect(p.kind).toBe("complex");
    expect(p.cfg).toEqual(GAMESCOPE_DEFAULT);
    expect(p.cfg).not.toBe(GAMESCOPE_DEFAULT);
  });
  it("applies overrides", () => {
    const p = makePill(CAT_BY_ID.d_hud, { value: "full" });
    expect(p.value).toBe("full");
  });
  it("merges from CAT_BY_ID when given a bare {id}", () => {
    const p = makePill({ id: "p_hdr" });
    expect(p.token).toBe("PROTON_ENABLE_HDR=1");
  });
  it("handles an unknown kind by returning the base", () => {
    const p = makePill({ id: "x", kind: "weird", cat: "misc", name: "X" });
    expect(p.kind).toBe("weird");
    expect(p.uid).toMatch(/^pill/);
  });
});

describe("makeCustomPill", () => {
  it("wraps a raw token", () => {
    const p = makeCustomPill("FOO=bar");
    expect(p.kind).toBe("custom");
    expect(p.token).toBe("FOO=bar");
    expect(p.cat).toBe("custom");
  });
});

describe("pillTokens", () => {
  it("toggle/tool/custom emit their token (or nothing when empty)", () => {
    expect(pillTokens({ kind: "toggle", token: "A=1" })).toEqual(["A=1"]);
    expect(pillTokens({ kind: "tool", token: "mangohud" })).toEqual(["mangohud"]);
    expect(pillTokens({ kind: "custom", token: "" })).toEqual([]);
  });
  it("choice/input emit KEY=VALUE", () => {
    expect(pillTokens({ kind: "choice", key: "DXVK_HUD", value: "fps" })).toEqual(["DXVK_HUD=fps"]);
    expect(pillTokens({ kind: "input", key: "LD_PRELOAD", value: "" })).toEqual(["LD_PRELOAD="]);
  });
  it("wrapper emits its head only when present", () => {
    expect(pillTokens({ kind: "wrapper", head: "game" })).toEqual(["game"]);
    expect(pillTokens({ kind: "wrapper", head: "" })).toEqual([]);
  });
  it("complex delegates to gamescopeTokens", () => {
    const toks = pillTokens({ kind: "complex", cfg: GAMESCOPE_DEFAULT });
    expect(toks).toContain("gamescope");
    expect(toks[toks.length - 1]).toBe("--");
  });
  it("unknown kind emits nothing", () => {
    expect(pillTokens({ kind: "nope" })).toEqual([]);
  });
});

describe("gamescopeTokens", () => {
  it("emits nested envs, gamescope, flags, toggles, and trailing --", () => {
    const toks = gamescopeTokens(GAMESCOPE_DEFAULT);
    expect(toks).toContain("ENABLE_GAMESCOPE_WSI=1");
    expect(toks).toContain("DXVK_HDR=1");
    expect(toks).toContain("gamescope");
    expect(toks).toContain("-W");
    expect(toks).toContain("3840");
    expect(toks).toContain("--hdr-enabled");
    expect(toks[toks.length - 1]).toBe("--");
  });
  it("omits empty flags and off toggles", () => {
    const cfg = { W: "", H: "", r: "", o: "", f: false, "hdr-enabled": false };
    const toks = gamescopeTokens(cfg);
    expect(toks).not.toContain("-W");
    expect(toks).not.toContain("-f");
    expect(toks).not.toContain("--hdr-enabled");
    expect(toks).toEqual(["gamescope", "--"]);
  });
});

describe("composeLine", () => {
  it("orders env vars, then tools, then wrapper head, then %command%", () => {
    const pills = [
      makePill(CAT_BY_ID.t_mangohud),
      makePill(CAT_BY_ID.p_hdr),
      makePill(CAT_BY_ID.w_native),
    ];
    expect(composeLine(pills)).toBe("PROTON_ENABLE_HDR=1 mangohud game %command%");
  });
  it("appends %command% even with no wrapper", () => {
    expect(composeLine([makePill(CAT_BY_ID.p_hdr)])).toBe("PROTON_ENABLE_HDR=1 %command%");
  });
  it("composes a gamescope line", () => {
    const pills = [makePill(CAT_BY_ID.p_ntsync), makePill(CAT_BY_ID.w_gamescope)];
    const line = composeLine(pills);
    expect(line.startsWith("PROTON_USE_NTSYNC=1 ENABLE_GAMESCOPE_WSI=1 DXVK_HDR=1 gamescope")).toBe(true);
    expect(line.endsWith("-- %command%")).toBe(true);
  });
});

describe("validateLine", () => {
  it("flags zero %command% as an error", () => {
    const v = validateLine("game", []);
    expect(v.level).toBe("error");
    expect(v.issues.some((i) => i.level === "error")).toBe(true);
  });
  it("flags multiple %command% as an error", () => {
    const v = validateLine("game %command% %command%", []);
    expect(v.cmdCount).toBe(2);
    expect(v.level).toBe("error");
  });
  it("passes a clean line", () => {
    const v = validateLine("PROTON_ENABLE_HDR=1 game %command%", []);
    expect(v.level).toBe("ok");
    expect(v.issues).toHaveLength(0);
  });
  it("warns on stale tokens and flags the offending pill", () => {
    const pill = makeCustomPill("gamescope_proton");
    const v = validateLine("gamescope_proton %command%", [pill]);
    expect(v.level).toBe("warn");
    expect(Object.keys(STALE_TOKENS)).toContain("gamescope_proton");
    expect(v.flagged[pill.uid]).toBeTruthy();
  });
  it("warns when the wrapper before %command% is not on PATH", () => {
    const v = validateLine("notarealwrapper %command%", []);
    expect(v.issues.some((i) => /not found on PATH/.test(i.msg))).toBe(true);
  });
  it("does not warn for a known wrapper", () => {
    expect(KNOWN_PATH.has("game")).toBe(true);
    const v = validateLine("game %command%", []);
    expect(v.level).toBe("ok");
  });
  it("flags a wrapper pill whose head is not on PATH", () => {
    const pill = makePill({ id: "w_raw", kind: "wrapper", cat: "wrapper" }, { head: "weirdwrap", name: "weirdwrap" });
    const v = validateLine("weirdwrap %command%", [pill]);
    expect(v.flagged[pill.uid]).toBeTruthy();
  });
});

describe("parseLine", () => {
  it("returns [] for empty / whitespace", () => {
    expect(parseLine("")).toEqual([]);
    expect(parseLine("   ")).toEqual([]);
    expect(parseLine(null)).toEqual([]);
  });

  it("parses env toggles + a known wrapper", () => {
    const pills = parseLine("PROTON_ENABLE_HDR=1 game %command%");
    expect(pills.map((p) => p.kind)).toEqual(["toggle", "wrapper"]);
    expect(pills[1].head).toBe("game");
  });

  it("parses choice and input env tokens to their pills", () => {
    const pills = parseLine("DXVK_HUD=full DXVK_FRAME_RATE=120 game %command%");
    const choice = pills.find((p) => p.kind === "choice");
    const input = pills.find((p) => p.kind === "input");
    expect(choice.value).toBe("full");
    expect(input.value).toBe("120");
  });

  it("parses a tool prefix", () => {
    const pills = parseLine("mangohud game %command%");
    expect(pills.find((p) => p.kind === "tool").token).toBe("mangohud");
  });

  it("treats an unknown token as a custom pill", () => {
    const pills = parseLine("WONKY_THING=42 game %command%");
    expect(pills.find((p) => p.kind === "custom")).toBeTruthy();
  });

  it("treats an unknown wrapper as a raw wrapper pill carrying the literal head", () => {
    const pills = parseLine("weirdwrap %command%");
    const w = pills.find((p) => p.kind === "wrapper");
    expect(w.head).toBe("weirdwrap");
  });

  it("creates a raw wrapper when %command% has only env tokens before it", () => {
    const pills = parseLine("PROTON_ENABLE_HDR=1 %command%");
    expect(pills.some((p) => p.kind === "wrapper")).toBe(true);
  });

  it("parses a full gamescope line back into a complex pill with cfg", () => {
    const line =
      "PROTON_USE_NTSYNC=1 ENABLE_GAMESCOPE_WSI=1 DXVK_HDR=1 gamescope -W 3840 -H 2160 -r 240 -f --hdr-enabled -- %command%";
    const pills = parseLine(line);
    const gs = pills.find((p) => p.kind === "complex");
    expect(gs).toBeTruthy();
    expect(gs.cfg.W).toBe("3840");
    expect(gs.cfg.r).toBe("240");
    expect(gs.cfg.f).toBe(true);
    expect(gs.cfg["hdr-enabled"]).toBe(true);
    expect(gs.cfg.ENABLE_GAMESCOPE_WSI).toBe(true);
    // ntsync survives as a toggle pill
    expect(pills.some((p) => p.kind === "toggle" && p.token === "PROTON_USE_NTSYNC=1")).toBe(true);
  });
});

describe("round-trip compose(parse(x))", () => {
  const lines = [
    "PROTON_ENABLE_WAYLAND=1 PROTON_ENABLE_HDR=1 DXVK_HDR=1 mangohud game %command%",
    "PROTON_USE_OPTISCALER=1 PROTON_DLSS_UPGRADE=1 game %command%",
    "DXVK_HUD=fps game %command%",
    "game_xwayland %command%",
  ];
  for (const line of lines) {
    it(`is stable for: ${line}`, () => {
      const once = composeLine(parseLine(line));
      const twice = composeLine(parseLine(once));
      expect(twice).toBe(once);
      expect(once).toContain("%command%");
    });
  }
});
