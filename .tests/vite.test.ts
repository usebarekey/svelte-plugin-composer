import { describe, expect, test } from "vitest";
import type { Plugin, PluginOption } from "vite";
import {
	compose,
	compose_config,
	kit,
	merge_svelte_configs,
	svelte,
	to_direct_sveltekit_config,
} from "../src/internal";

describe("compose", () => {
	test("flattens nested plugins and ignores falsy entries", () => {
		const first: Plugin = { name: "first" };
		const second: Plugin = { name: "second" };
		const output = compose(
			[false, [first, null, undefined], second] as unknown as PluginOption[],
			{ diagnostics: false },
		);

		expect(plugin_names(output)).toEqual(["first", "second"]);
	});

	test("preserves plugin order after normalization", () => {
		const first: Plugin = { name: "first" };
		const second: Plugin = { name: "second" };
		const third: Plugin = { name: "third" };
		const output = compose([[first, second], third], { diagnostics: false });

		expect(plugin_names(output)).toEqual(["first", "second", "third"]);
	});

	test("normalizes promised plugin options", async () => {
		const promised = Promise.resolve({
			name: "promised-plugin",
			enforce: "pre",
		} satisfies Plugin);
		const output = compose([promised], { diagnostics: false });
		const plugin = (await output[0]) as Plugin;

		expect(plugin.name).toBe("promised-plugin");
		expect(plugin.enforce).toBeUndefined();
	});

	test("strips top-level pre priority from user plugins", () => {
		const input: Plugin = { name: "pre-plugin", enforce: "pre" };
		const output = compose([input], { diagnostics: false });
		const plugin = output[0] as Plugin;

		expect(plugin.enforce).toBeUndefined();
		expect(input.enforce).toBe("pre");
		expect(plugin).not.toBe(input);
	});

	test("strips transform pre order without losing handler or filter", () => {
		const filter = { id: /\.svelte$/ };
		const handler = () => null;
		const input: Plugin = {
			name: "hook-plugin",
			transform: {
				order: "pre",
				filter,
				handler,
			} as unknown as Plugin["transform"],
		};
		const output = compose([input], { diagnostics: false });
		const plugin = output[0] as Plugin;
		const transform = plugin.transform as {
			order?: string;
			filter?: unknown;
			handler?: unknown;
		};
		const original_transform = input.transform as {
			order?: string;
		};

		expect(transform.order).toBeUndefined();
		expect(transform.filter).toBe(filter);
		expect(transform.handler).toBe(handler);
		expect(original_transform.order).toBe("pre");
	});

	test("strips pre priority from SvelteKit plugin groups", () => {
		const output = compose([kit()], {
			diagnostics: false,
			svelte_config: "external",
		});
		const pre_plugins = flatten_plugins(output)
			.filter((plugin) => plugin.enforce === "pre")
			.map((plugin) => plugin.name);

		expect(pre_plugins).toEqual([]);
	});

	test("preserves post priority", () => {
		const handler = () => null;
		const input: Plugin = {
			name: "post-plugin",
			enforce: "post",
			transform: {
				order: "post",
				handler,
			} as unknown as Plugin["transform"],
		};
		const output = compose([input], { diagnostics: false });
		const plugin = output[0] as Plugin;
		const transform = plugin.transform as {
			order?: string;
			handler?: unknown;
		};

		expect(plugin.enforce).toBe("post");
		expect(transform.order).toBe("post");
		expect(transform.handler).toBe(handler);
	});

	test("warn mode reports pre priority without stripping it", () => {
		const input: Plugin = { name: "pre-plugin", enforce: "pre" };
		const output = compose([input], {
			pre_order: "warn",
			diagnostics: false,
		});
		const plugin = output[0] as Plugin;

		expect(plugin.enforce).toBe("pre");
	});

	test("throws a clear error for config contributions without kit", () => {
		expect(() =>
			compose([svelte({ extensions: [".sv"] })], {
				diagnostics: false,
			}),
		).toThrow("kit(...)");
	});

	test("collects Svelte config attached to plugin objects", () => {
		const plugin = { name: "config-plugin" } as Plugin;

		Object.defineProperty(plugin, "__svelte_plugin_composer_config", {
			value: {
				source: "config-plugin",
				config: {
					preprocess: [{ markup: () => undefined }],
				},
			},
		});

		expect(() =>
			compose([plugin], {
				diagnostics: false,
			}),
		).toThrow("kit(...)");
	});

	test("external config mode accepts config without direct Kit config", () => {
		const output = compose([svelte({ extensions: [".sv"] })], {
			diagnostics: false,
			svelte_config: "external",
		});

		expect(output).toEqual([]);
	});

	test("throws a clear error for multiple kit slots", () => {
		expect(() =>
			compose([kit(), kit()], {
				diagnostics: false,
			}),
		).toThrow("only contain one kit");
	});

	test("appends diagnostics by default", () => {
		const output = compose([{ name: "plugin" }]);

		expect(plugin_names(output)).toContain("svelte-plugin-composer:diagnostics");
	});
});

describe("merge_svelte_configs", () => {
	test("preserves custom extensions and appends once", () => {
		const merged = merge_svelte_configs([
			{ extensions: [".svelte", ".sv"] },
			{ extensions: [".sv", ".md"] },
		]);

		expect(merged.extensions).toEqual([".svelte", ".sv", ".md"]);
	});

	test("concatenates preprocess arrays", () => {
		const first = { name: "first" };
		const second = { name: "second" };
		const third = { name: "third" };
		const merged = merge_svelte_configs([
			{ preprocess: first },
			{ preprocess: [second, third] },
		]);

		expect(merged.preprocess).toEqual([first, second, third]);
	});

	test("does not mutate original config objects", () => {
		const original = {
			extensions: [".svelte"],
			compilerOptions: {
				runes: true,
			},
		};
		const merged = merge_svelte_configs([
			original,
			{
				extensions: [".sv"],
				compilerOptions: {
					dev: true,
				},
			},
		]);

		expect(original.extensions).toEqual([".svelte"]);
		expect(original.compilerOptions).toEqual({ runes: true });
		expect(merged.extensions).toEqual([".svelte", ".sv"]);
		expect(merged.compilerOptions).toEqual({ runes: true, dev: true });
	});

	test("composes kit typescript config hooks in order", () => {
		const first = (config: Record<string, unknown>) => {
			const include = config.include as string[];

			return {
				...config,
				include: [...include, "first"],
			};
		};
		const second = (config: Record<string, unknown>) => {
			const include = config.include as string[];

			include.push("second");
		};
		const merged = merge_svelte_configs([
			{ kit: { typescript: { config: first } } },
			{ kit: { typescript: { config: second } } },
		]);
		const direct = to_direct_sveltekit_config(merged);
		const typescript = direct.typescript as Record<string, unknown>;
		const config_hook = typescript.config as (
			config: Record<string, unknown>,
		) => Record<string, unknown>;
		const result = config_hook({ include: [] });

		expect(result.include).toEqual(["first", "second"]);
	});

	test("composes top-level typescript config hooks in order", () => {
		const first = (config: Record<string, unknown>) => {
			const include = config.include as string[];

			return {
				...config,
				include: [...include, "first"],
			};
		};
		const second = (config: Record<string, unknown>) => {
			const include = config.include as string[];

			include.push("second");
		};
		const merged = merge_svelte_configs([
			{ typescript: { config: first } },
			{ typescript: { config: second } },
		]);
		const typescript = merged.typescript as Record<string, unknown>;
		const config_hook = typescript.config as (
			config: Record<string, unknown>,
		) => Record<string, unknown>;
		const result = config_hook({ include: [] });

		expect(result.include).toEqual(["first", "second"]);
	});

	test("replaces ADT-like config objects instead of cross-merging variants", () => {
		const merged = merge_svelte_configs([
			{
				kit: {
					adapter: {
						_tag: "StaticAdapter",
						pages: "old-build",
					},
				},
			},
			{
				kit: {
					adapter: {
						_tag: "AutoAdapter",
						fallback: "200.html",
					},
				},
			},
		]);

		expect(merged.kit).toEqual({
			adapter: {
				_tag: "AutoAdapter",
				fallback: "200.html",
			},
		});
	});
});

describe("compose_config", () => {
	test("nests direct kit options for svelte config", () => {
		const preprocessor = { markup: () => undefined };
		const plugin = { name: "config-plugin" } as Plugin;

		Object.defineProperty(plugin, "__svelte_plugin_composer_config", {
			value: {
				source: "config-plugin",
				config: {
					preprocess: [preprocessor],
				},
			},
		});

		const config = compose_config([
			svelte({ extensions: [".svelte", ".sv"] }),
			plugin,
			kit({
				adapter: "adapter",
				compilerOptions: {
					experimental: {
						async: true,
					},
				},
			}),
		]);

		expect(config.extensions).toEqual([".svelte", ".sv"]);
		expect(config.preprocess).toEqual([preprocessor]);
		expect(config.compilerOptions).toEqual({
			experimental: {
				async: true,
			},
		});
		expect(config.kit).toEqual({
			adapter: "adapter",
		});
	});
});

function plugin_names(options: readonly PluginOption[]): string[] {
	return options
		.filter((option): option is Plugin => is_plugin(option))
		.map((plugin) => plugin.name);
}

function flatten_plugins(options: readonly PluginOption[]): Plugin[] {
	const plugins: Plugin[] = [];

	for (const option of options) {
		collect_plugin(option, plugins);
	}

	return plugins;
}

function collect_plugin(option: PluginOption, plugins: Plugin[]): void {
	if (!option) {
		return;
	}

	if (Array.isArray(option)) {
		for (const child of option) {
			collect_plugin(child, plugins);
		}

		return;
	}

	if (!is_plugin(option)) {
		return;
	}

	plugins.push(option);
}

function is_plugin(option: PluginOption): option is Plugin {
	return (
		typeof option === "object" && option !== null && !Array.isArray(option) && "name" in option
	);
}
