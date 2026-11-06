// @vitest-environment jsdom
//
// Touchpoints render in a shadow root and are told the app theme through
// their host context. The theme is the one stamped on `<html data-theme>`, and
// a mounted touchpoint follows it when the user switches theme.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	currentWebTouchpointTheme,
	ensureWebTouchpointElement,
	readWebTouchpointHostContext,
	type WebTouchpointContext,
} from "../../src/components/touchpoint-component";
import { emitThemeChange } from "../../src/state/theme-preference";

const root = () => document.documentElement;

afterEach(() => {
	root().removeAttribute("data-theme");
	for (const name of ["--bg-elevated", "--text", "--accent", "--accent-contrast"])
		root().style.removeProperty(name);
});

describe("touchpoint theme", () => {
	it("reads the theme stamped on the document", () => {
		root().setAttribute("data-theme", "dark");
		expect(currentWebTouchpointTheme()).toBe("dark");
		root().setAttribute("data-theme", "light");
		expect(currentWebTouchpointTheme()).toBe("light");
	});

	it("fills the bridge vocabulary from app tokens in dark only", () => {
		root().style.setProperty("--bg-elevated", "#0f131a");
		root().style.setProperty("--text", "#dcdcdc");
		root().style.setProperty("--accent", "#a8abed");
		root().style.setProperty("--accent-contrast", "#05080d");

		const dark = readWebTouchpointHostContext("en", "dark").cssVariables;
		expect(dark["--background"]).toBe("#0f131a");
		expect(dark["--foreground"]).toBe("#dcdcdc");
		expect(dark["--primary"]).toBe("#a8abed");
		expect(dark["--primary-foreground"]).toBe("#05080d");

		const light = readWebTouchpointHostContext("en", "light").cssVariables;
		expect(light["--background"]).toBe("");
		expect(light["--primary"]).toBe("");
	});

	it("re-themes a mounted touchpoint when the app theme changes", () => {
		const Element = ensureWebTouchpointElement();
		const element = new Element();
		const context = Object.freeze({
			instanceId: "instance",
			contentVersionId: "content",
			placementKey: "badge",
			locale: "en",
			theme: "light",
			fontFamily: "sans-serif",
			cssVariables: {},
			mode: "production",
		}) as unknown as WebTouchpointContext;
		// The state `mount()` leaves behind for a component without `update`.
		const mounted = element as unknown as {
			generation: number;
			disposed: boolean;
			lastContext: WebTouchpointContext;
			unsubscribeTheme?: () => void;
			followAppTheme(generation: number): void;
		};
		mounted.generation = 1;
		mounted.disposed = false;
		mounted.lastContext = context;
		root().setAttribute("data-theme", "dark");

		mounted.followAppTheme(1);

		expect(element.style.getPropertyValue("--vela-touchpoint-theme")).toBe("dark");
		// The component was not handed a dark context, so the change stays
		// pending for a later mount to replay.
		expect(mounted.lastContext.theme).toBe("light");

		// And back: the host follows a switch back to light too.
		root().setAttribute("data-theme", "light");
		mounted.followAppTheme(1);
		expect(element.style.getPropertyValue("--vela-touchpoint-theme")).toBe("light");
	});

	it("replays a theme change that landed while the component was still mounting", async () => {
		const Element = ensureWebTouchpointElement();
		const element = new Element();
		const update = vi.fn(async () => undefined);
		const context = Object.freeze({
			instanceId: "instance",
			contentVersionId: "content",
			placementKey: "badge",
			locale: "en",
			theme: "light",
			fontFamily: "sans-serif",
			cssVariables: {},
			mode: "production",
		}) as unknown as WebTouchpointContext;
		const mounting = element as unknown as {
			generation: number;
			disposed: boolean;
			lastContext: WebTouchpointContext;
			module?: { update: typeof update };
			instance?: unknown;
			updateQueue?: { schedule(next: WebTouchpointContext): Promise<void> };
			followAppTheme(generation: number): void;
		};
		mounting.generation = 1;
		mounting.disposed = false;
		mounting.lastContext = context;

		// The switch arrives before the component module is adopted.
		root().setAttribute("data-theme", "dark");
		mounting.followAppTheme(1);
		expect(mounting.lastContext.theme).toBe("light");

		// Adoption, then the replay mount() performs right after it.
		const scheduled: WebTouchpointContext[] = [];
		mounting.module = { update };
		mounting.instance = {};
		mounting.updateQueue = {
			schedule: async (next) => {
				scheduled.push(next);
			},
		};
		mounting.followAppTheme(1);
		await Promise.resolve();

		expect(scheduled.map((next) => next.theme)).toEqual(["dark"]);
	});

	it("stops following the theme once disposed", async () => {
		const Element = ensureWebTouchpointElement();
		const element = new Element();
		const mounted = element as unknown as {
			disposed: boolean;
			unsubscribeTheme?: () => void;
			lastContext?: WebTouchpointContext;
		};
		mounted.disposed = false;
		let calls = 0;
		mounted.unsubscribeTheme = () => {
			calls += 1;
		};

		await element.dispose();
		emitThemeChange();

		expect(calls).toBe(1);
		expect(mounted.lastContext).toBeUndefined();
	});
});
