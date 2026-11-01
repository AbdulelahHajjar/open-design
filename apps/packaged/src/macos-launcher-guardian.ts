import { spawn } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { isProcessAlive } from "@open-design/platform";
import { findSidecarProcesses, invokeSidecar, type SidecarStamp } from "@open-design/sidecar";
import { SIDECAR_MESSAGES } from "@open-design/sidecar-proto";
import { app } from "electron";

const GENERATION_POLL_MS = 1_000;
const GENERATION_GONE_CONFIRM_MS = 500;
const SHOW_TIMEOUT_MS = 800;

type GuardianEvent = { preventDefault(): void };

export type MacLauncherGuardianDeps = {
  app: {
    dock?: { hide(): void };
    on(event: "activate", listener: () => void): unknown;
    on(event: "open-url", listener: (event: GuardianEvent, url: string) => void): unknown;
    whenReady(): Promise<unknown>;
  };
  /** Generation roots for the stamp. A failed process scan also reads as empty. */
  findGenerationPids(stamp: SidecarStamp): Promise<number[]>;
  isProcessAlive(pid: number): boolean;
  logger: { warn(message: string): void };
  relaunchApp(deeplinkUrl: string | null): void;
  showDesktop(stamp: SidecarStamp, input: { deeplinkUrl?: string }): Promise<unknown>;
  sleep(ms: number): Promise<unknown>;
};

/**
 * Keep the macOS launcher, the process LaunchServices started, alive and out
 * of the Dock for as long as the desktop generation it bootstrapped runs.
 *
 * The launcher hands the desktop to a stamped sidecar generation and has no
 * other work. If it exits, LaunchServices keeps its registration as
 * "exited-with-subordinates": the Dock shows that tile beside the desktop's
 * own, and macOS 27 can tear the launch's processes down with it. As a hidden
 * accessory process it leaves the desktop as the only Dock tile.
 *
 * While both processes run, LaunchServices may deliver a reopen or a URL open
 * to this process instead of the desktop, so both are forwarded as SHOW
 * requests. One that arrives after the desktop has quit, before this process
 * noticed, relaunches the app instead of being dropped.
 *
 * Returns once no generation for `stamp` is left. The supervisor root outlives
 * restarts of the desktop process, so those are followed. A payload update that
 * relaunches the app after quitting is not: this process exits, or the new
 * desktop retires it as an obsolete outer, and that launch keeps the extra tile.
 */
export async function holdMacLauncherForBootstrappedDesktop(
  stamp: SidecarStamp,
  options: { logsRoot?: string } = {},
  overrides: Partial<MacLauncherGuardianDeps> = {},
): Promise<void> {
  const deps: MacLauncherGuardianDeps = { ...defaultDeps(options.logsRoot), ...overrides };
  let stopped = false;
  const forward = async (deeplinkUrl: string | null) => {
    try {
      await deps.showDesktop(stamp, deeplinkUrl == null ? {} : { deeplinkUrl });
      return;
    } catch (error) {
      deps.logger.warn(`[open-design launcher] guardian could not show the desktop: ${errorMessage(error)}`);
    }
    if (stopped || (await deps.findGenerationPids(stamp)).length > 0) return;
    stopped = true;
    deps.relaunchApp(deeplinkUrl);
  };
  const forwardSafely = (deeplinkUrl: string | null) => {
    void forward(deeplinkUrl).catch((error: unknown) => {
      deps.logger.warn(`[open-design launcher] guardian could not forward an open: ${errorMessage(error)}`);
    });
  };
  deps.app.on("activate", () => forwardSafely(null));
  deps.app.on("open-url", (event, url) => {
    event.preventDefault();
    forwardSafely(url);
  });
  await deps.app.whenReady();
  deps.app.dock?.hide();
  try {
    while (!stopped) {
      const pid = await findGenerationRoot(stamp, deps);
      if (pid == null) return;
      while (!stopped && deps.isProcessAlive(pid)) await deps.sleep(GENERATION_POLL_MS);
    }
  } catch (error) {
    deps.logger.warn(`[open-design launcher] guardian stopped watching the desktop: ${errorMessage(error)}`);
  }
}

/** The first generation root, or null once two lookups in a row find none. */
async function findGenerationRoot(stamp: SidecarStamp, deps: MacLauncherGuardianDeps): Promise<number | null> {
  const [pid] = await deps.findGenerationPids(stamp);
  if (pid != null) return pid;
  await deps.sleep(GENERATION_GONE_CONFIRM_MS);
  const [confirmed] = await deps.findGenerationPids(stamp);
  return confirmed ?? null;
}

function defaultDeps(logsRoot: string | undefined): MacLauncherGuardianDeps {
  const logger = logsRoot == null ? console : launcherFileLogger(logsRoot);
  return {
    app,
    findGenerationPids: async (stamp) => (await findSidecarProcesses(stamp)).map(({ pid }) => pid),
    isProcessAlive,
    logger,
    relaunchApp: (deeplinkUrl) => relaunchInstalledApp(deeplinkUrl, logger),
    showDesktop: (stamp, input) => invokeSidecar(stamp, SIDECAR_MESSAGES.SHOW, input, { timeoutMs: SHOW_TIMEOUT_MS }),
    sleep,
  };
}

/** Start a fresh instance of the app bundle this process runs from. */
function relaunchInstalledApp(deeplinkUrl: string | null, logger: MacLauncherGuardianDeps["logger"]): void {
  const macosDir = dirname(process.execPath);
  const bundle = resolve(macosDir, "..", "..");
  if (basename(macosDir) !== "MacOS" || !bundle.endsWith(".app")) {
    logger.warn(`[open-design launcher] guardian cannot relaunch from ${process.execPath}`);
    return;
  }
  const child = spawn("/usr/bin/open", ["-n", "-a", bundle, ...(deeplinkUrl == null ? [] : [deeplinkUrl])], {
    detached: true,
    stdio: "ignore",
  });
  child.once("error", (error) => {
    logger.warn(`[open-design launcher] guardian could not relaunch the app: ${errorMessage(error)}`);
  });
  child.unref();
}

function launcherFileLogger(logsRoot: string): MacLauncherGuardianDeps["logger"] {
  const logPath = join(logsRoot, "launcher", "guardian.log");
  return {
    warn(message) {
      console.warn(message);
      void mkdir(dirname(logPath), { recursive: true })
        .then(() => appendFile(logPath, `${new Date().toISOString()} ${message}\n`, "utf8"))
        .catch(() => {});
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
