import { describe, it, expect } from "vitest";
import {
  CATEGORIES, CATALOGUE, CAT_BY_ID, ENV_ITEMS, TOOLS, TOOL_BY_ID, GAME_ARGS, GS_NICE,
  toolDefaults, makePill, makeToolPill, makeCustomPill, makeCommandPill, makeArgPill,
  isEnvToken, looksLikeArg, tokenizeArgs, compileTool, toolSummary,
  splitAtCommand, orderedTools, composeLine, validateLine, parseLine, STALE_TOKENS,
} from "./catalogue-data";
import type { ChoicePill, InputPill, TokenPill, ToolPill } from "./types";

describe("catalogue data integrity", () => {
  it("every catalogue item has a known category and a unique id", () => {
    const catIds = new Set(CATEGORIES.map((c) => c.id));
    const seen = new Set<string>();
    for (const item of CATALOGUE) {
      expect(catIds.has(item.cat)).toBe(true);
      expect(seen.has(item.id)).toBe(false);
      seen.add(item.id);
    }
  });
  it("the wrapper category is gone; NVIDIA + Game arguments are present", () => {
    const ids = CATEGORIES.map((c) => c.id);
    expect(ids).not.toContain("wrapper");
    expect(ids).toContain("nvidia");
    expect(CATEGORIES.find((c) => c.id === "args")?.post).toBe(true);
  });
  it("CAT_BY_ID maps ids to items", () => {
    expect((CAT_BY_ID.p_hdr as { token: string }).token).toBe("PROTON_ENABLE_HDR=1");
    expect((CAT_BY_ID.p_fsr4_ind as { token: string }).token).toBe("PROTON_FSR4_INDICATOR=1");
    expect(CAT_BY_ID.tool_gamescope.kind).toBe("tool");
  });
  it("exposes the five tools incl. gamescope pinned last", () => {
    expect(TOOLS.map((t) => t.id)).toEqual(["gamescope", "mangohud", "vkbasalt", "gamemoderun", "game-performance"]);
    expect(TOOL_BY_ID.gamescope.pinnedLast).toBe(true);
    expect(TOOL_BY_ID.mangohud.compile).toBe("env-config");
    expect(TOOL_BY_ID.gamemoderun.sections).toHaveLength(0);
  });
  it("ships engine-grouped game-arg suggestions", () => {
    expect(GAME_ARGS.map((g) => g.group)).toContain("Source / Source 2");
    expect(GAME_ARGS.every((g) => g.args.length > 0)).toBe(true);
  });
});

describe("isEnvToken / looksLikeArg", () => {
  it("recognizes KEY=VALUE env tokens, including __GL_* and __NV_*", () => {
    expect(isEnvToken("PROTON_ENABLE_HDR=1")).toBe(true);
    expect(isEnvToken("DXVK_HUD=fps")).toBe(true);
    expect(isEnvToken("__NV_PRIME_RENDER_OFFLOAD=1")).toBe(true);
    expect(isEnvToken("__GL_THREADED_OPTIMIZATIONS=1")).toBe(true);
  });
  it("rejects non-env tokens", () => {
    expect(isEnvToken("mangohud")).toBe(false);
    expect(isEnvToken("%command%")).toBe(false);
    expect(isEnvToken("--flag")).toBe(false);
  });
  it("looksLikeArg matches game args but not the -- terminator", () => {
    expect(looksLikeArg("-novid")).toBe(true);
    expect(looksLikeArg("+exec")).toBe(true);
    expect(looksLikeArg("--")).toBe(false);
    expect(looksLikeArg("mangohud")).toBe(false);
  });
});

describe("tokenizeArgs", () => {
  it("splits plain flags", () => {
    expect(tokenizeArgs("-novid -dx11")).toEqual(["-novid", "-dx11"]);
  });
  it("keeps +cvar value pairs together", () => {
    expect(tokenizeArgs("+fps_max 0 -novid")).toEqual(["+fps_max 0", "-novid"]);
  });
  it("joins -Flag= value into one token", () => {
    expect(tokenizeArgs("-ResX= 1920")).toEqual(["-ResX=1920"]);
  });
  it("returns [] for empty", () => {
    expect(tokenizeArgs("")).toEqual([]);
  });
});

describe("factories", () => {
  it("makePill builds toggle / choice / input pills", () => {
    expect((makePill(CAT_BY_ID.p_hdr) as TokenPill).token).toBe("PROTON_ENABLE_HDR=1");
    const choice = makePill(CAT_BY_ID.d_hud) as ChoicePill;
    expect(choice.kind).toBe("choice");
    expect(choice.value).toBe("fps");
    const input = makePill(CAT_BY_ID.s_preload) as InputPill;
    expect(input.kind).toBe("input");
    expect(input.value).toBe("");
  });
  it("makePill(tool) and makeToolPill build a tool pill seeded with gamescope defaults", () => {
    const gs = makePill(CAT_BY_ID.tool_gamescope) as ToolPill;
    expect(gs.kind).toBe("tool");
    expect(gs.toolId).toBe("gamescope");
    expect(gs.cfg.W).toBe(GS_NICE.W);
    expect(gs.cfg.f).toBe(true);
    expect(gs.extra).toBe("");
    // a no-default tool gets the schema defaults (all off/empty)
    const mh = makeToolPill("mangohud");
    expect(mh.cfg.preset).toBe("");
    expect(mh.cfg.cpu_temp).toBe(false);
  });
  it("makeCustomPill / makeCommandPill / makeArgPill", () => {
    expect(makeCustomPill("FOO=bar")).toMatchObject({ kind: "custom", token: "FOO=bar", cat: "custom" });
    expect(makeCommandPill().kind).toBe("command");
    expect(makeArgPill("-novid")).toMatchObject({ kind: "arg", text: "-novid" });
  });
  it("toolDefaults yields one entry per control", () => {
    const d = toolDefaults(TOOL_BY_ID.gamescope);
    expect(d.f).toBe(false);
    expect(d.W).toBe("");
    expect(d.F).toBe("none");
  });
});

describe("compileTool", () => {
  it("flags tool (gamescope) emits prefix + flags + -- terminator", () => {
    const { envs, prefixes } = compileTool(makeToolPill("gamescope"));
    expect(envs).toEqual([]);
    expect(prefixes[0]).toBe("gamescope");
    expect(prefixes).toContain("-W");
    expect(prefixes).toContain("--hdr-enabled");
    expect(prefixes[prefixes.length - 1]).toBe("--");
  });
  it("env-config tool (mangohud) serialises into MANGOHUD_CONFIG", () => {
    const mh = makeToolPill("mangohud", { ...toolDefaults(TOOL_BY_ID.mangohud), preset: "2", fps_limit: "60", cpu_temp: true });
    const { envs, prefixes } = compileTool(mh);
    expect(prefixes).toEqual(["mangohud"]);
    expect(envs).toEqual(["MANGOHUD_CONFIG=preset=2,fps_limit=60,cpu_temp"]);
  });
  it("a default mangohud emits just the prefix (no config)", () => {
    expect(compileTool(makeToolPill("mangohud"))).toEqual({ envs: [], prefixes: ["mangohud"] });
  });
  it("env-toggle tool (vkbasalt) emits ENABLE_VKBASALT and an optional config", () => {
    expect(compileTool(makeToolPill("vkbasalt")).envs).toEqual(["ENABLE_VKBASALT=1"]);
    const cfgd = makeToolPill("vkbasalt", { ...toolDefaults(TOOL_BY_ID.vkbasalt), config: "/tmp/v.conf" });
    expect(compileTool(cfgd).envs).toContain("VKBASALT_CONFIG_FILE=/tmp/v.conf");
  });
  it("no-schema tool (gamemoderun) emits just the prefix; extra args append", () => {
    expect(compileTool(makeToolPill("gamemoderun"))).toEqual({ envs: [], prefixes: ["gamemoderun"] });
    const withExtra = makeToolPill("gamemoderun", undefined, "--some-flag");
    expect(compileTool(withExtra).prefixes).toEqual(["gamemoderun", "--some-flag"]);
  });
  it("toolSummary describes gamescope + mangohud config", () => {
    expect(toolSummary(makeToolPill("gamescope"))).toContain("3840x2160");
    const mh = makeToolPill("mangohud", { ...toolDefaults(TOOL_BY_ID.mangohud), fps_limit: "60" });
    expect(toolSummary(mh)).toContain("60 fps");
  });
});

describe("splitAtCommand / orderedTools", () => {
  it("splits pills around the command divider", () => {
    const pills = [makePill(CAT_BY_ID.p_hdr), makeCommandPill(), makeArgPill("-novid")];
    const { pre, post } = splitAtCommand(pills);
    expect(pre.map((p) => p.kind)).toEqual(["toggle"]);
    expect(post.map((p) => p.kind)).toEqual(["arg"]);
  });
  it("orderedTools puts gamescope last", () => {
    const pre = [makeToolPill("gamescope"), makeToolPill("mangohud")];
    expect(orderedTools(pre).map((t) => t.toolId)).toEqual(["mangohud", "gamescope"]);
  });
});

describe("composeLine", () => {
  it("orders env vars, then tool prefixes, then %command%, then game args", () => {
    const pills = [
      makeToolPill("mangohud"),
      makePill(CAT_BY_ID.p_hdr),
      makeCommandPill(),
      makeArgPill("-novid"),
    ];
    expect(composeLine(pills)).toBe("PROTON_ENABLE_HDR=1 mangohud %command% -novid");
  });
  it("emits just %command% for an empty/divider-only line", () => {
    expect(composeLine([makeCommandPill()])).toBe("%command%");
  });
  it("composes a gamescope line with the -- before %command%", () => {
    const pills = [makePill(CAT_BY_ID.s_gswsi), makeToolPill("gamescope"), makeCommandPill()];
    const line = composeLine(pills);
    expect(line.startsWith("ENABLE_GAMESCOPE_WSI=1 gamescope")).toBe(true);
    expect(line.endsWith("-- %command%")).toBe(true);
  });
});

describe("validateLine", () => {
  it("flags zero %command% as an error", () => {
    const v = validateLine("mangohud", []);
    expect(v.level).toBe("error");
    expect(v.cmdCount).toBe(0);
  });
  it("flags multiple %command% as an error", () => {
    const v = validateLine("%command% %command%", []);
    expect(v.cmdCount).toBe(2);
    expect(v.level).toBe("error");
  });
  it("passes a clean line", () => {
    const v = validateLine("PROTON_ENABLE_HDR=1 mangohud %command%", []);
    expect(v.level).toBe("ok");
    expect(v.issues).toHaveLength(0);
  });
  it("warns on a retired wrapper token and flags the offending custom pill", () => {
    const pill = makeCustomPill("game");
    const v = validateLine("game %command%", [pill]);
    expect(v.level).toBe("warn");
    expect(Object.keys(STALE_TOKENS)).toContain("game");
    expect(v.flagged[pill.uid]).toBeTruthy();
  });
  it("warns when mangohud is stacked in front of gamescope", () => {
    const pills = [makeToolPill("mangohud"), makeToolPill("gamescope"), makeCommandPill()];
    const v = validateLine(composeLine(pills), pills);
    expect(v.issues.some((i) => /mangoapp/.test(i.msg))).toBe(true);
  });
  it("warns when a pre-command custom pill looks like a game argument", () => {
    const pill = makeCustomPill("-novid");
    const v = validateLine("-novid %command%", [pill]);
    expect(v.flagged[pill.uid]?.msg).toMatch(/game argument/);
    expect(v.issues.some((i) => /after the %command% divider/.test(i.msg))).toBe(true);
  });
});

describe("parseLine", () => {
  it("returns just the command divider for empty / whitespace / null", () => {
    expect(parseLine("").map((p) => p.kind)).toEqual(["command"]);
    expect(parseLine("   ").map((p) => p.kind)).toEqual(["command"]);
    expect(parseLine(null).map((p) => p.kind)).toEqual(["command"]);
  });
  it("parses env toggles + tools + a command divider", () => {
    const pills = parseLine("PROTON_ENABLE_HDR=1 mangohud %command%");
    expect(pills.map((p) => p.kind)).toEqual(["toggle", "tool", "command"]);
    expect((pills[1] as ToolPill).toolId).toBe("mangohud");
  });
  it("parses choice + input env tokens to their pills", () => {
    const pills = parseLine("DXVK_HUD=full DXVK_FRAME_RATE=120 %command%");
    expect((pills.find((p) => p.kind === "choice") as ChoicePill).value).toBe("full");
    expect((pills.find((p) => p.kind === "input") as InputPill).value).toBe("120");
  });
  it("folds a standalone MANGOHUD_CONFIG into the mangohud pill", () => {
    const pills = parseLine("MANGOHUD_CONFIG=preset=2,fps_limit=60 mangohud %command%");
    const mh = pills.find((p) => p.kind === "tool") as ToolPill;
    expect(mh.cfg.preset).toBe("2");
    expect(mh.cfg.fps_limit).toBe("60");
  });
  it("captures post-command tokens as arg pills", () => {
    const pills = parseLine("mangohud %command% -novid +fps_max 0");
    const args = pills.filter((p) => p.kind === "arg") as Array<{ text: string }>;
    expect(args.map((a) => a.text)).toEqual(["-novid", "+fps_max 0"]);
  });
  it("treats an unknown pre-command token as a custom pill", () => {
    expect(parseLine("WONKY_THING=42 %command%").some((p) => p.kind === "custom")).toBe(true);
  });
  it("parses a full gamescope line back into a tool pill with cfg", () => {
    const pills = parseLine("ENABLE_GAMESCOPE_WSI=1 DXVK_HDR=1 gamescope -W 3840 -H 2160 -r 240 -f --hdr-enabled -- %command%");
    const gs = pills.find((p) => p.kind === "tool") as ToolPill;
    expect(gs.toolId).toBe("gamescope");
    expect(gs.cfg.W).toBe("3840");
    expect(gs.cfg.f).toBe(true);
    expect(gs.cfg["hdr-enabled"]).toBe(true);
    expect(pills.some((p) => p.kind === "toggle")).toBe(true);
  });
  it("keeps an unknown gamescope flag in the tool's extra args", () => {
    const gs = parseLine("gamescope --weird-flag -- %command%").find((p) => p.kind === "tool") as ToolPill;
    expect(gs.extra).toContain("--weird-flag");
  });
  it("folds vkBasalt into one pill regardless of env order (config before toggle)", () => {
    const pills = parseLine("VKBASALT_CONFIG_FILE=/x ENABLE_VKBASALT=1 %command%");
    expect(pills.filter((p) => p.kind === "tool" && (p as ToolPill).toolId === "vkbasalt")).toHaveLength(1);
    // round-trips to a single, well-formed line (no duplicated ENABLE_VKBASALT)
    expect(composeLine(pills)).toBe("ENABLE_VKBASALT=1 VKBASALT_CONFIG_FILE=/x %command%");
  });
});

describe("round-trip compose(parse(x))", () => {
  const lines = [
    "PROTON_ENABLE_WAYLAND=1 PROTON_ENABLE_HDR=1 DXVK_HDR=1 %command%",
    "mangohud %command% -skipmovies",
    "DXVK_HUD=fps %command%",
    "ENABLE_GAMESCOPE_WSI=1 DXVK_HDR=1 gamescope -W 3840 -H 2160 -r 240 -o 60 -f --adaptive-sync --hdr-enabled --mangoapp -- %command%",
    "ENABLE_VKBASALT=1 %command%",
  ];
  for (const line of lines) {
    it(`is stable for: ${line}`, () => {
      const once = composeLine(parseLine(line));
      expect(once).toBe(line);
      expect(composeLine(parseLine(once))).toBe(once);
    });
  }
});

describe("ENV_ITEMS coverage", () => {
  it("covers every env var the retired scripts used", () => {
    const tokens = new Set(ENV_ITEMS.flatMap((i) => ("token" in i ? [i.token] : ["key" in i ? i.key + "=" : ""])));
    for (const v of ["PROTON_ENABLE_WAYLAND=1", "PROTON_ENABLE_HDR=1", "PROTON_USE_NTSYNC=1", "PROTON_FSR4_UPGRADE=1", "DXVK_HDR=1", "ENABLE_LAYER_MESA_ANTI_LAG=1", "ENABLE_GAMESCOPE_WSI=1", "DISABLE_HDR_WSI=1"]) {
      expect(tokens.has(v)).toBe(true);
    }
    expect(tokens.has("LD_PRELOAD=")).toBe(true);
  });
});
