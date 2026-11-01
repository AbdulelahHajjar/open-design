import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SidecarStamp } from "@open-design/sidecar";
import { describe, expect, it } from "vitest";

import {
  holdMacLauncherForBootstrappedDesktop,
  type MacLauncherGuardianDeps,
} from "../src/macos-launcher-guardian.js";

const stamp: SidecarStamp = {
  app: "desktop",
  channel: "stable",
  mode: "runtime",
  namespace: "guardian-test",
  source: "packaged",
};

type Listener = (...args: unknown[]) => void;

function harness(options: {
  generations?: number[][];
  livePolls?: Record<number, number>;
  findError?: Error;
  showError?: Error;
  hasDock?: boolean;
} = {}) {
  const trace: string[] = [];
  const listeners = new Map<string, Listener>();
  const ready = Promise.withResolvers<void>();
  const generations = [...(options.generations ?? [])];
  const livePolls = { ...options.livePolls };
  const shows: Array<{ deeplinkUrl?: string }> = [];
  const relaunches: Array<string | null> = [];
  const deps: MacLauncherGuardianDeps = {
    app: {
      dock: options.hasDock === false ? undefined : { hide: () => trace.push("dock-hide") },
      on: ((event: string, listener: Listener) => {
        trace.push(`on:${event}`);
        listeners.set(event, listener);
      }) as MacLauncherGuardianDeps["app"]["on"],
      whenReady: async () => {
        trace.push("when-ready");
        await ready.promise;
        trace.push("ready");
      },
    },
    findGenerationPids: async (target) => {
      expect(target).toBe(stamp);
      if (options.findError) throw options.findError;
      const pids = generations.shift() ?? [];
      trace.push(`find:${pids.join(",") || "none"}`);
      return pids;
    },
    isProcessAlive: (pid) => {
      const remaining = livePolls[pid] ?? 0;
      livePolls[pid] = remaining - 1;
      return remaining > 0;
    },
    logger: { warn: (message) => trace.push(`warn:${message}`) },
    relaunchApp: (deeplinkUrl) => { relaunches.push(deeplinkUrl); },
    showDesktop: async (target, input) => {
      expect(target).toBe(stamp);
      shows.push(input);
      if (options.showError) throw options.showError;
      return { accepted: true };
    },
    sleep: async (ms) => { trace.push(`sleep:${ms}`); },
  };
  return { deps, listeners, ready, relaunches, shows, trace };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

describe("holdMacLauncherForBootstrappedDesktop", () => {
  it("hides the Dock tile only after the app is ready", async () => {
    const { deps, ready, trace } = harness();
    const holding = holdMacLauncherForBootstrappedDesktop(stamp, {}, deps);
    await Promise.resolve();
    expect(trace).not.toContain("dock-hide");
    ready.resolve();
    await holding;
    expect(trace.indexOf("dock-hide")).toBeGreaterThan(trace.indexOf("ready"));
  });

  it("waits for each desktop generation in turn and returns once two lookups find none", async () => {
    const { deps, ready, trace } = harness({
      generations: [[7654], [8765], [], []],
      livePolls: { 7654: 2, 8765: 1 },
    });
    ready.resolve();
    await holdMacLauncherForBootstrappedDesktop(stamp, {}, deps);
    expect(trace.filter(event => /^(find|sleep):/.test(event))).toEqual([
      "find:7654", "sleep:1000", "sleep:1000",
      "find:8765", "sleep:1000",
      "find:none", "sleep:500", "find:none",
    ]);
  });

  it("keeps guarding when a lookup finds nothing but the next one finds the desktop", async () => {
    const { deps, ready, trace } = harness({ generations: [[], [7654], [], []], livePolls: { 7654: 1 } });
    ready.resolve();
    await holdMacLauncherForBootstrappedDesktop(stamp, {}, deps);
    expect(trace.filter(event => /^(find|sleep):/.test(event))).toEqual([
      "find:none", "sleep:500", "find:7654", "sleep:1000",
      "find:none", "sleep:500", "find:none",
    ]);
  });

  it("listens for reopen and URL events before waiting for the app to be ready", async () => {
    const { deps, ready, trace } = harness();
    ready.resolve();
    await holdMacLauncherForBootstrappedDesktop(stamp, {}, deps);
    expect(trace.indexOf("on:activate")).toBeLessThan(trace.indexOf("when-ready"));
    expect(trace.indexOf("on:open-url")).toBeLessThan(trace.indexOf("when-ready"));
  });

  it("forwards a reopen to the desktop as a plain SHOW", async () => {
    const { deps, listeners, ready, relaunches, shows } = harness();
    ready.resolve();
    await holdMacLauncherForBootstrappedDesktop(stamp, {}, deps);
    listeners.get("activate")!();
    await settle();
    expect(shows).toEqual([{}]);
    expect(relaunches).toEqual([]);
  });

  it("forwards a URL open to the desktop and claims the event", async () => {
    const { deps, listeners, ready, shows } = harness();
    ready.resolve();
    await holdMacLauncherForBootstrappedDesktop(stamp, {}, deps);
    let prevented = false;
    listeners.get("open-url")!({ preventDefault: () => { prevented = true; } }, "opendesign://invite/abc");
    await settle();
    expect(prevented).toBe(true);
    expect(shows).toEqual([{ deeplinkUrl: "opendesign://invite/abc" }]);
  });

  it("relaunches the app, link included, when an open arrives after the desktop is gone", async () => {
    const { deps, listeners, ready, relaunches, trace } = harness({ showError: new Error("desktop unreachable") });
    ready.resolve();
    await holdMacLauncherForBootstrappedDesktop(stamp, {}, deps);
    listeners.get("open-url")!({ preventDefault() {} }, "opendesign://invite/abc");
    await settle();
    expect(trace).toContain("warn:[open-design launcher] guardian could not show the desktop: desktop unreachable");
    expect(relaunches).toEqual(["opendesign://invite/abc"]);
    listeners.get("activate")!();
    await settle();
    expect(relaunches).toEqual(["opendesign://invite/abc"]);
  });

  it("does not relaunch when SHOW fails while the desktop is still running", async () => {
    const { deps, listeners, ready, relaunches } = harness({
      generations: [[7654], [], [], [7654]],
      livePolls: { 7654: 0 },
      showError: new Error("timed out"),
    });
    ready.resolve();
    await holdMacLauncherForBootstrappedDesktop(stamp, {}, deps);
    listeners.get("activate")!();
    await settle();
    expect(relaunches).toEqual([]);
  });

  it("returns and logs when the desktop lookup throws", async () => {
    const { deps, ready, trace } = harness({ findError: new Error("lookup failed") });
    ready.resolve();
    await expect(holdMacLauncherForBootstrappedDesktop(stamp, {}, deps)).resolves.toBeUndefined();
    expect(trace).toContain("warn:[open-design launcher] guardian stopped watching the desktop: lookup failed");
  });

  it("still guards when Electron exposes no Dock API", async () => {
    const { deps, ready, trace } = harness({ generations: [[7654], [], []], livePolls: { 7654: 1 }, hasDock: false });
    ready.resolve();
    await holdMacLauncherForBootstrappedDesktop(stamp, {}, deps);
    expect(trace).not.toContain("dock-hide");
    expect(trace).toContain("find:7654");
  });

  it("writes its warnings to the launcher log under logsRoot", async () => {
    const logsRoot = await mkdtemp(join(tmpdir(), "od-guardian-log-"));
    try {
      const { deps, ready } = harness({ findError: new Error("lookup failed") });
      const { logger: _ignored, ...withoutLogger } = deps;
      ready.resolve();
      await holdMacLauncherForBootstrappedDesktop(stamp, { logsRoot }, withoutLogger);
      let log = "";
      for (let attempt = 0; attempt < 50 && !log.includes("lookup failed"); attempt += 1) {
        await settle();
        log = await readFile(join(logsRoot, "launcher", "guardian.log"), "utf8").catch(() => "");
      }
      expect(log).toContain("guardian stopped watching the desktop: lookup failed");
    } finally {
      await rm(logsRoot, { recursive: true, force: true });
    }
  });
});
