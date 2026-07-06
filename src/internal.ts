import { sveltekit } from "@sveltejs/kit/vite";
import type { Plugin, PluginOption } from "vite";

const contribution_key = "__svelte_plugin_composer";
const plugin_config_key = "__svelte_plugin_composer_config";
const kit_slot_key = "__svelte_plugin_composer_kit_slot";

const adt_discriminator_keys = ["_tag", "kind", "status", "type"] as const;

const svelte_config_keys = [
	"kit",
	"extensions",
	"preprocess",
	"vitePlugin",
	"compilerOptions",
] as const;

const direct_kit_svelte_keys = [
	"extensions",
	"preprocess",
	"vitePlugin",
	"compilerOptions",
] as const;

const ordered_hook_names = ["load", "resolveId", "transform", "transformIndexHtml"] as const;

/**
 * Controls how composer handles user-supplied Vite pre priority.
 *
 * @example
 * ```ts
 * compose([plugin, kit()], { pre_order: "warn" });
 * ```
 *
 * @since 0.1.0
 */
export type PreOrderPolicy = "strip" | "warn" | "preserve";

/**
 * Runtime options for composer normalization and diagnostics.
 *
 * @example
 * ```ts
 * compose([plugin, kit()], { diagnostics: false });
 * ```
 *
 * @since 0.1.0
 */
export interface ComposeOptions {
	/**
	 * Selects whether user-supplied pre priority is stripped, warned about, or
	 * preserved.
	 */
	readonly pre_order?: PreOrderPolicy;

	/**
	 * Enables the small Vite diagnostics plugin that reports merge and priority
	 * decisions.
	 */
	readonly diagnostics?: boolean;

	/**
	 * Selects whether Svelte config fragments are passed directly to
	 * `sveltekit(...)` or loaded from `svelte.config.js`.
	 */
	readonly svelte_config?: "direct" | "external";
}

/**
 * Svelte config fragment accepted by the composer.
 *
 * @example
 * ```ts
 * const config: ComposerSvelteConfig = { extensions: [".svelte", ".sv"] };
 * ```
 *
 * @since 0.1.0
 */
export type ComposerSvelteConfig = Record<string, unknown>;

/**
 * Explicit contribution returned by `svelte(...)` or `kit(...)`.
 *
 * @example
 * ```ts
 * const contribution = kit({ adapter });
 * ```
 *
 * @since 0.1.0
 */
export interface ComposerContribution {
	readonly [contribution_key]: true;
	readonly kind: "svelte" | "kit";
	readonly source: string;
	readonly config: ComposerSvelteConfig;
}

/**
 * Any value that can appear inside `compose([...])`.
 *
 * @example
 * ```ts
 * const items: ComposerItem[] = [plugin(), false, [svelte({})], kit()];
 * ```
 *
 * @since 0.1.0
 */
export type ComposerItem =
	| PluginOption
	| ComposerContribution
	| ComposerSvelteConfig
	| false
	| null
	| undefined
	| readonly ComposerItem[];

interface ResolvedComposeOptions {
	readonly pre_order: PreOrderPolicy;
	readonly diagnostics: boolean;
	readonly svelte_config: "direct" | "external";
}

interface PreOrderDiagnostic {
	readonly plugin_name: string;
	readonly target: string;
	readonly action: "stripped" | "warned";
}

interface ConfigDiagnostic {
	readonly source: string;
	readonly keys: readonly string[];
}

interface DiagnosticsState {
	readonly pre_order: PreOrderDiagnostic[];
	readonly configs: ConfigDiagnostic[];
}

interface CollectedContribution {
	readonly kind: "svelte" | "kit" | "plain";
	readonly source: string;
	readonly config: ComposerSvelteConfig;
}

interface ComposeContext {
	readonly options: ResolvedComposeOptions;
	readonly diagnostics: DiagnosticsState;
	readonly contributions: CollectedContribution[];
	kit_slots: number;
}

interface KitSlot {
	readonly [kit_slot_key]: true;
}

interface PluginConfigContribution {
	readonly source: string;
	readonly config: ComposerSvelteConfig;
}

interface PreOrderedHook {
	readonly order: "pre";
	readonly [key: string]: unknown;
}

type NormalizedHookResult =
	| { readonly _tag: "unchanged"; readonly hook: unknown }
	| { readonly _tag: "changed"; readonly hook: unknown };

type TypescriptConfigHook = (config: Record<string, unknown>) => Record<string, unknown> | void;

/**
 * Composes Vite plugins and Svelte config fragments into one plugin list.
 *
 * @example
 * ```ts
 * export default defineConfig({
 *   plugins: compose([sv(), ts(), kit({ adapter })]),
 * });
 * ```
 *
 * @since 0.1.0
 * @param items - Plugin options, nested plugin presets, config fragments, and
 *   composer contributions to flatten and normalize.
 * @param options - Optional normalization policy. By default pre priority is
 *   stripped and diagnostics are enabled.
 * @returns A Vite plugin option array ready to pass to `defineConfig`.
 */
export function compose(
	items: readonly ComposerItem[],
	options: ComposeOptions = {},
): PluginOption[] {
	const resolved_options = resolve_options(options);
	const diagnostics: DiagnosticsState = { pre_order: [], configs: [] };
	const context: ComposeContext = {
		options: resolved_options,
		diagnostics,
		contributions: [],
		kit_slots: 0,
	};
	const output: Array<PluginOption | KitSlot> = [];

	/**
	 * Phase 1 - flatten user input while collecting config contributions.
	 */
	for (const item of items) {
		append_item(item, output, context);
	}

	if (
		resolved_options.svelte_config === "direct" &&
		context.contributions.length > 0 &&
		context.kit_slots === 0
	) {
		throw new Error(
			[
				"[svelte-plugin-composer] Svelte config contributions were provided,",
				"but no kit(...) item was found.",
				"Add kit({ ... }) to compose([...]) so the composer can pass the",
				"merged config to sveltekit(...).",
			].join(" "),
		);
	}

	/**
	 * Phase 2 - create SvelteKit once at the declared kit(...) position.
	 */
	const merged_config = merge_svelte_configs(
		context.contributions.map((contribution) => contribution.config),
	);
	const direct_config = to_direct_sveltekit_config(merged_config);
	const plugins: PluginOption[] = output.map(
		(item): PluginOption =>
			is_kit_slot(item)
				? make_sveltekit_plugin_option(direct_config, resolved_options)
				: item,
	);

	/**
	 * Phase 3 - append diagnostics without affecting transform order.
	 */
	if (resolved_options.diagnostics) {
		plugins.push(make_diagnostics_plugin(diagnostics));
	}

	return plugins;
}

/**
 * Marks the SvelteKit plugin slot and contributes config to it.
 *
 * @example
 * ```ts
 * compose([kit({ adapter })]);
 * ```
 *
 * @since 0.1.0
 * @param config - Direct SvelteKit plugin config to merge before creating the
 *   final SvelteKit plugin group.
 * @returns A composer contribution consumed by `compose`.
 */
export function kit(config: ComposerSvelteConfig = {}): ComposerContribution {
	return {
		[contribution_key]: true,
		kind: "kit",
		source: "kit",
		config,
	};
}

/**
 * Contributes Svelte config without creating a Vite plugin.
 *
 * @example
 * ```ts
 * compose([svelte({ extensions: [".svelte", ".sv"] }), kit()]);
 * ```
 *
 * @since 0.1.0
 * @param config - Svelte config fragment to merge into the final SvelteKit
 *   setup.
 * @returns A composer contribution consumed by `compose`.
 */
export function svelte(config: ComposerSvelteConfig): ComposerContribution {
	return {
		[contribution_key]: true,
		kind: "svelte",
		source: "svelte",
		config,
	};
}

/**
 * Composes Svelte config fragments for `svelte.config.js`.
 *
 * @example
 * ```ts
 * export default compose_config([sv(), ts(), kit({ adapter })]);
 * ```
 *
 * @since 0.1.0
 * @param items - Config helpers, composer contributions, plugins with attached
 *   config, and nested presets to collect.
 * @returns A merged Svelte config object.
 */
export function compose_config(items: readonly ComposerItem[]): ComposerSvelteConfig {
	const contributions = collect_config_contributions(items);
	const configs = contributions.map(to_svelte_config_contribution);

	return merge_svelte_configs(configs);
}

/**
 * Merges Svelte config fragments using composer semantics.
 *
 * @example
 * ```ts
 * const merged = merge_svelte_configs([
 *   { extensions: [".svelte"] },
 *   { extensions: [".sv"] },
 * ]);
 * ```
 *
 * @since 0.1.0
 * @param configs - Config fragments in contribution order.
 * @returns A new merged config object.
 */
export function merge_svelte_configs(
	configs: readonly ComposerSvelteConfig[],
): ComposerSvelteConfig {
	let merged: ComposerSvelteConfig = {};

	/**
	 * Phase 1 - merge each contribution in declared order.
	 */
	for (const config of configs) {
		merged = merge_config_pair(merged, config);
	}

	return merged;
}

/**
 * Converts `svelte.config.js`-style `kit` nesting into direct `sveltekit(...)`
 * config.
 *
 * @example
 * ```ts
 * const direct = to_direct_sveltekit_config({ kit: { adapter }, extensions });
 * ```
 *
 * @since 0.1.0
 * @param config - Merged composer config, potentially containing a `kit`
 *   namespace from `svelte.config.js`-style helpers.
 * @returns A cloned config suitable for `sveltekit(config)`.
 */
export function to_direct_sveltekit_config(config: ComposerSvelteConfig): ComposerSvelteConfig {
	const direct_config = clone_value(config) as ComposerSvelteConfig;
	const kit_config = direct_config.kit;

	delete direct_config.kit;

	if (!is_plain_object(kit_config)) {
		return direct_config;
	}

	return merge_plain_objects(direct_config, kit_config, []);
}

function direct_kit_config_to_svelte_config(config: ComposerSvelteConfig): ComposerSvelteConfig {
	const svelte_config: ComposerSvelteConfig = {};
	const kit_config: ComposerSvelteConfig = {};

	for (const [key, value] of Object.entries(config)) {
		if (key === "kit" && is_plain_object(value)) {
			Object.assign(kit_config, clone_value(value));

			continue;
		}

		if (is_direct_kit_svelte_key(key)) {
			svelte_config[key] = clone_value(value);

			continue;
		}

		kit_config[key] = clone_value(value);
	}

	if (Object.keys(kit_config).length > 0) {
		svelte_config.kit = kit_config;
	}

	return svelte_config;
}

function make_sveltekit_plugin_option(
	direct_config: ComposerSvelteConfig,
	options: ResolvedComposeOptions,
): PluginOption {
	if (options.svelte_config === "external") {
		return sveltekit() as PluginOption;
	}

	return sveltekit(direct_config) as PluginOption;
}

function append_item(
	item: ComposerItem,
	output: Array<PluginOption | KitSlot>,
	context: ComposeContext,
): void {
	if (!item) {
		return;
	}

	if (Array.isArray(item)) {
		for (const child of item) {
			append_item(child, output, context);
		}

		return;
	}

	if (is_composer_contribution(item)) {
		append_contribution(item, output, context);

		return;
	}

	if (is_svelte_config_shape(item)) {
		append_plain_config(item, context);

		return;
	}

	if (is_plugin_object(item)) {
		append_plugin_config(item, context);
	}

	output.push(normalize_plugin_option(item as PluginOption, context));
}

function collect_config_contributions(items: readonly ComposerItem[]): CollectedContribution[] {
	const contributions: CollectedContribution[] = [];

	for (const item of items) {
		collect_config_item(item, contributions);
	}

	return contributions;
}

function collect_config_item(item: ComposerItem, contributions: CollectedContribution[]): void {
	if (!item) {
		return;
	}

	if (Array.isArray(item)) {
		for (const child of item) {
			collect_config_item(child, contributions);
		}

		return;
	}

	if (is_composer_contribution(item)) {
		contributions.push({
			kind: item.kind,
			source: item.source,
			config: item.config,
		});

		return;
	}

	if (is_svelte_config_shape(item)) {
		contributions.push({
			kind: "plain",
			source: "config",
			config: item,
		});

		return;
	}

	if (!is_plugin_object(item)) {
		return;
	}

	const contribution = get_plugin_config_contribution(item);

	if (!contribution) {
		return;
	}

	contributions.push({
		kind: "plain",
		source: contribution.source,
		config: contribution.config,
	});
}

function to_svelte_config_contribution(contribution: CollectedContribution): ComposerSvelteConfig {
	if (contribution.kind !== "kit") {
		return contribution.config;
	}

	return direct_kit_config_to_svelte_config(contribution.config);
}

function append_contribution(
	contribution: ComposerContribution,
	output: Array<PluginOption | KitSlot>,
	context: ComposeContext,
): void {
	context.contributions.push({
		kind: contribution.kind,
		source: contribution.source,
		config: contribution.config,
	});
	context.diagnostics.configs.push({
		source: contribution.source,
		keys: Object.keys(contribution.config),
	});

	if (contribution.kind !== "kit") {
		return;
	}

	context.kit_slots += 1;

	if (context.kit_slots > 1) {
		throw new Error(
			"[svelte-plugin-composer] compose([...]) can only contain one kit(...) item.",
		);
	}

	output.push({ [kit_slot_key]: true });
}

function append_plain_config(config: ComposerSvelteConfig, context: ComposeContext): void {
	context.contributions.push({
		kind: "plain",
		source: "config",
		config,
	});
	context.diagnostics.configs.push({
		source: "config",
		keys: Object.keys(config),
	});
}

function append_plugin_config(plugin: Plugin, context: ComposeContext): void {
	const contribution = get_plugin_config_contribution(plugin);

	if (!contribution) {
		return;
	}

	context.contributions.push({
		kind: "plain",
		source: contribution.source,
		config: contribution.config,
	});
	context.diagnostics.configs.push({
		source: contribution.source,
		keys: Object.keys(contribution.config),
	});
}

function normalize_plugin_option(option: PluginOption, context: ComposeContext): PluginOption {
	if (!option) {
		return option;
	}

	if (Array.isArray(option)) {
		return option.map((entry) => normalize_plugin_option(entry, context));
	}

	if (is_promise_like(option)) {
		return option.then((resolved) => normalize_plugin_option(resolved, context));
	}

	if (!is_plugin_object(option)) {
		return option;
	}

	return normalize_plugin(option, context);
}

function normalize_plugin(plugin: Plugin, context: ComposeContext): Plugin {
	const enforce = plugin.enforce;
	const policy = context.options.pre_order;
	const next = { ...plugin } as Record<string, unknown>;
	let changed = false;

	/**
	 * Phase 1 - normalize top-level plugin priority.
	 */
	if (enforce === "pre" && policy !== "preserve") {
		record_pre_order_change(plugin.name, "enforce", context);

		if (policy === "strip") {
			delete next.enforce;
			changed = true;
		}
	}

	/**
	 * Phase 2 - normalize hook object priority.
	 */
	for (const hook_name of ordered_hook_names) {
		const hook = next[hook_name];
		const result = normalize_hook(hook, plugin.name, hook_name, context);

		if (result._tag === "unchanged") {
			continue;
		}

		next[hook_name] = result.hook;
		changed = true;
	}

	if (!changed) {
		return plugin;
	}

	return next as unknown as Plugin;
}

function normalize_hook(
	hook: unknown,
	plugin_name: string,
	hook_name: string,
	context: ComposeContext,
): NormalizedHookResult {
	const policy = context.options.pre_order;

	if (!is_pre_ordered_hook(hook) || policy === "preserve") {
		return { _tag: "unchanged", hook };
	}

	record_pre_order_change(plugin_name, `${hook_name}.order`, context);

	if (policy !== "strip") {
		return { _tag: "unchanged", hook };
	}

	const { order: _order, ...next } = hook;

	return { _tag: "changed", hook: next };
}

function record_pre_order_change(
	plugin_name: string,
	target: string,
	context: ComposeContext,
): void {
	const action = context.options.pre_order === "warn" ? "warned" : "stripped";

	context.diagnostics.pre_order.push({
		plugin_name,
		target,
		action,
	});
}

function merge_config_pair(
	base: ComposerSvelteConfig,
	contribution: ComposerSvelteConfig,
): ComposerSvelteConfig {
	const next = clone_value(base) as ComposerSvelteConfig;

	/**
	 * Phase 1 - merge each top-level config key with composer semantics.
	 */
	for (const [key, value] of Object.entries(contribution)) {
		if (key === "extensions") {
			next.extensions = merge_extensions(next.extensions, value);

			continue;
		}

		if (key === "preprocess") {
			next.preprocess = merge_preprocess(next.preprocess, value);

			continue;
		}

		next[key] = merge_value(next[key], value, [key]);
	}

	return next;
}

function merge_plain_objects(
	base: Record<string, unknown>,
	contribution: Record<string, unknown>,
	path: readonly string[],
): Record<string, unknown> {
	const next = clone_value(base) as Record<string, unknown>;

	/**
	 * Phase 1 - deep merge plain object keys.
	 */
	for (const [key, value] of Object.entries(contribution)) {
		next[key] = merge_value(next[key], value, [...path, key]);
	}

	return next;
}

function merge_value(base: unknown, contribution: unknown, path: readonly string[]): unknown {
	if (is_typescript_config_hook_path(path)) {
		return merge_typescript_config_hooks(base, contribution);
	}

	if (is_plain_object(base) && is_plain_object(contribution)) {
		if (is_named_result_shape(base) || is_named_result_shape(contribution)) {
			return clone_value(contribution);
		}

		return merge_plain_objects(base, contribution, path);
	}

	return clone_value(contribution);
}

function merge_typescript_config_hooks(base: unknown, contribution: unknown): unknown {
	if (!is_typescript_config_hook(contribution)) {
		return clone_value(contribution);
	}

	if (!is_typescript_config_hook(base)) {
		return contribution;
	}

	return (config: Record<string, unknown>) => {
		const first_result = base(config);
		const after_first = first_result ?? config;
		const second_result = contribution(after_first);

		return second_result ?? after_first;
	};
}

function merge_extensions(base: unknown, contribution: unknown): string[] {
	const extensions = [...as_string_array(base), ...as_string_array(contribution)];

	return [...new Set(extensions)];
}

function merge_preprocess(base: unknown, contribution: unknown): unknown[] {
	return [...as_array(base), ...as_array(contribution)];
}

function clone_value(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => clone_value(item));
	}

	if (!is_plain_object(value)) {
		return value;
	}

	return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone_value(item)]));
}

function as_array(value: unknown): unknown[] {
	if (value === undefined) {
		return [];
	}

	return Array.isArray(value) ? value : [value];
}

function as_string_array(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.filter((item): item is string => typeof item === "string");
}

function is_typescript_config_hook_path(path: readonly string[]): boolean {
	const joined_path = path.join(".");

	return joined_path === "kit.typescript.config" || joined_path === "typescript.config";
}

function is_direct_kit_svelte_key(key: string): boolean {
	return direct_kit_svelte_keys.includes(key as (typeof direct_kit_svelte_keys)[number]);
}

function is_composer_contribution(value: unknown): value is ComposerContribution {
	return is_plain_object(value) && value[contribution_key] === true;
}

function is_svelte_config_shape(value: unknown): value is ComposerSvelteConfig {
	return (
		is_plain_object(value) &&
		!("name" in value) &&
		svelte_config_keys.some((key) => key in value)
	);
}

function is_plugin_object(value: unknown): value is Plugin {
	return is_plain_object(value) && typeof value.name === "string";
}

function get_plugin_config_contribution(plugin: Plugin): PluginConfigContribution | undefined {
	const contribution = (plugin as unknown as Record<string, unknown>)[plugin_config_key];

	if (!is_plain_object(contribution)) {
		return undefined;
	}

	if (!is_plain_object(contribution.config)) {
		return undefined;
	}

	return {
		source: typeof contribution.source === "string" ? contribution.source : plugin.name,
		config: contribution.config,
	};
}

function is_kit_slot(value: unknown): value is KitSlot {
	return is_plain_object(value) && value[kit_slot_key] === true;
}

function is_plain_object(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const prototype = Object.getPrototypeOf(value);

	return prototype === Object.prototype || prototype === null;
}

function is_named_result_shape(value: Record<string, unknown>): boolean {
	return adt_discriminator_keys.some((key) => typeof value[key] === "string");
}

function is_pre_ordered_hook(value: unknown): value is PreOrderedHook {
	return is_plain_object(value) && value.order === "pre";
}

function is_typescript_config_hook(value: unknown): value is TypescriptConfigHook {
	return typeof value === "function";
}

function is_promise_like<T>(value: unknown): value is PromiseLike<T> {
	if ((typeof value !== "object" && typeof value !== "function") || !value) {
		return false;
	}

	return typeof (value as { then?: unknown }).then === "function";
}

function resolve_options(options: ComposeOptions): ResolvedComposeOptions {
	return {
		pre_order: options.pre_order ?? "strip",
		diagnostics: options.diagnostics ?? true,
		svelte_config: options.svelte_config ?? "direct",
	};
}

function make_diagnostics_plugin(diagnostics: DiagnosticsState): Plugin {
	return {
		name: "svelte-plugin-composer:diagnostics",
		configResolved(config) {
			const lines = make_diagnostics_lines(diagnostics);

			if (lines.length === 0) {
				return;
			}

			config.logger.info(["", ...lines].join("\n"));
		},
	};
}

function make_diagnostics_lines(diagnostics: DiagnosticsState): string[] {
	const config_lines = diagnostics.configs.map((entry) => {
		const keys = entry.keys.length > 0 ? entry.keys.join(", ") : "empty";

		return `svelte-plugin-composer: merged ${entry.source} config (${keys})`;
	});
	const pre_order_lines = diagnostics.pre_order.map((entry) =>
		["svelte-plugin-composer:", entry.action, `${entry.plugin_name}.${entry.target}`].join(" "),
	);

	return [...config_lines, ...pre_order_lines];
}
