import { sveltekit } from "@sveltejs/kit/vite";

const contribution_key = "__svelte_plugin_composer";
const plugin_config_key = "__svelte_plugin_composer_config";
const kit_slot_key = "__svelte_plugin_composer_kit_slot";

const svelte_config_keys = [
  "kit",
  "extensions",
  "preprocess",
  "vitePlugin",
  "compilerOptions",
];

const direct_kit_svelte_keys = [
  "extensions",
  "preprocess",
  "vitePlugin",
  "compilerOptions",
];

const ordered_hook_names = [
  "load",
  "resolveId",
  "transform",
  "transformIndexHtml",
];

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
 * @param {readonly unknown[]} items - Plugin options, nested plugin presets,
 *   config fragments, and composer contributions to flatten and normalize.
 * @param {{ pre_order?: "strip" | "warn" | "preserve"; diagnostics?: boolean }} [options] -
 *   Optional normalization policy. By default pre priority is stripped and
 *   diagnostics are enabled.
 * @returns {unknown[]} A Vite plugin option array ready to pass to
 *   `defineConfig`.
 */
export function compose(items, options = {}) {
  const resolved_options = resolve_options(options);
  const diagnostics = { pre_order: [], configs: [] };
  const context = {
    options: resolved_options,
    diagnostics,
    contributions: [],
    kit_slots: 0,
  };
  const output = [];

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
  const plugins = output.map((item) =>
    is_kit_slot(item)
      ? resolved_options.svelte_config === "external"
        ? sveltekit()
        : sveltekit(direct_config)
      : item
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
 * @param {Record<string, unknown>} [config] - Direct SvelteKit plugin config to
 *   merge before creating the final SvelteKit plugin group.
 * @returns {Record<string, unknown>} A composer contribution consumed by
 *   `compose`.
 */
export function kit(config = {}) {
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
 * @param {Record<string, unknown>} config - Svelte config fragment to merge
 *   into the final SvelteKit setup.
 * @returns {Record<string, unknown>} A composer contribution consumed by
 *   `compose`.
 */
export function svelte(config) {
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
 * ```js
 * export default compose_config([sv(), ts(), kit({ adapter })]);
 * ```
 *
 * @since 0.1.0
 * @param {readonly unknown[]} items - Config helpers, composer contributions,
 *   plugins with attached config, and nested presets to collect.
 * @returns {Record<string, unknown>} A merged Svelte config object.
 */
export function compose_config(items) {
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
 * @param {readonly Record<string, unknown>[]} configs - Config fragments in
 *   contribution order.
 * @returns {Record<string, unknown>} A new merged config object.
 */
export function merge_svelte_configs(configs) {
  let merged = {};

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
 * @param {Record<string, unknown>} config - Merged composer config, potentially
 *   containing a `kit` namespace from `svelte.config.js`-style helpers.
 * @returns {Record<string, unknown>} A cloned config suitable for
 *   `sveltekit(config)`.
 */
export function to_direct_sveltekit_config(config) {
  const direct_config = clone_value(config);
  const kit_config = direct_config.kit;

  delete direct_config.kit;

  if (!is_plain_object(kit_config)) {
    return direct_config;
  }

  return merge_plain_objects(direct_config, kit_config, []);
}

function direct_kit_config_to_svelte_config(config) {
  const svelte_config = {};
  const kit_config = {};

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

function append_item(item, output, context) {
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

  output.push(normalize_plugin_option(item, context));
}

function collect_config_contributions(items) {
  const contributions = [];

  for (const item of items) {
    collect_config_item(item, contributions);
  }

  return contributions;
}

function collect_config_item(item, contributions) {
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

  if (!contribution?.config) {
    return;
  }

  contributions.push({
    kind: "plain",
    source: contribution.source ?? item.name,
    config: contribution.config,
  });
}

function to_svelte_config_contribution(contribution) {
  if (contribution.kind !== "kit") {
    return contribution.config;
  }

  return direct_kit_config_to_svelte_config(contribution.config);
}

function append_contribution(contribution, output, context) {
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

function append_plain_config(config, context) {
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

function append_plugin_config(plugin, context) {
  const contribution = get_plugin_config_contribution(plugin);

  if (!contribution?.config) {
    return;
  }

  const source = contribution.source ?? plugin.name;

  context.contributions.push({
    kind: "plain",
    source,
    config: contribution.config,
  });
  context.diagnostics.configs.push({
    source,
    keys: Object.keys(contribution.config),
  });
}

function normalize_plugin_option(option, context) {
  if (!option) {
    return option;
  }

  if (Array.isArray(option)) {
    return option.map((entry) => normalize_plugin_option(entry, context));
  }

  if (is_promise_like(option)) {
    return option.then((resolved) =>
      normalize_plugin_option(resolved, context)
    );
  }

  if (!is_plugin_object(option)) {
    return option;
  }

  return normalize_plugin(option, context);
}

function normalize_plugin(plugin, context) {
  const enforce = plugin.enforce;
  const policy = context.options.pre_order;
  const next = { ...plugin };
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
    const normalized_hook = normalize_hook(
      hook,
      plugin.name,
      hook_name,
      context,
    );

    if (normalized_hook === hook) {
      continue;
    }

    next[hook_name] = normalized_hook;
    changed = true;
  }

  if (!changed) {
    return plugin;
  }

  return next;
}

function normalize_hook(hook, plugin_name, hook_name, context) {
  const policy = context.options.pre_order;

  if (!is_plain_object(hook)) {
    return hook;
  }

  if (hook.order !== "pre" || policy === "preserve") {
    return hook;
  }

  record_pre_order_change(plugin_name, `${hook_name}.order`, context);

  if (policy !== "strip") {
    return hook;
  }

  const next = { ...hook };

  delete next.order;

  return next;
}

function record_pre_order_change(plugin_name, target, context) {
  const action = context.options.pre_order === "warn" ? "warned" : "stripped";

  context.diagnostics.pre_order.push({
    plugin_name,
    target,
    action,
  });
}

function merge_config_pair(base, contribution) {
  const next = clone_value(base);

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

function merge_plain_objects(base, contribution, path) {
  const next = clone_value(base);

  /**
   * Phase 1 - deep merge plain object keys.
   */
  for (const [key, value] of Object.entries(contribution)) {
    next[key] = merge_value(next[key], value, [...path, key]);
  }

  return next;
}

function merge_value(base, contribution, path) {
  if (is_typescript_config_hook_path(path)) {
    return merge_typescript_config_hooks(base, contribution);
  }

  if (is_plain_object(base) && is_plain_object(contribution)) {
    return merge_plain_objects(base, contribution, path);
  }

  return clone_value(contribution);
}

function merge_typescript_config_hooks(base, contribution) {
  if (typeof base !== "function" || typeof contribution !== "function") {
    return clone_value(contribution);
  }

  return (config) => {
    const first_result = base(config);
    const after_first = is_plain_object(first_result) ? first_result : config;
    const second_result = contribution(after_first);

    return is_plain_object(second_result) ? second_result : after_first;
  };
}

function merge_extensions(base, contribution) {
  const extensions = [
    ...as_string_array(base),
    ...as_string_array(contribution),
  ];

  return [...new Set(extensions)];
}

function merge_preprocess(base, contribution) {
  return [
    ...as_array(base),
    ...as_array(contribution),
  ];
}

function clone_value(value) {
  if (Array.isArray(value)) {
    return value.map((item) => clone_value(item));
  }

  if (!is_plain_object(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, clone_value(item)]),
  );
}

function as_array(value) {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function as_string_array(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item) => typeof item === "string");
}

function is_typescript_config_hook_path(path) {
  const joined_path = path.join(".");

  return joined_path === "kit.typescript.config" ||
    joined_path === "typescript.config";
}

function is_direct_kit_svelte_key(key) {
  return direct_kit_svelte_keys.includes(key);
}

function is_composer_contribution(value) {
  return is_plain_object(value) && value[contribution_key] === true;
}

function is_svelte_config_shape(value) {
  return is_plain_object(value) && !("name" in value) &&
    svelte_config_keys.some((key) => key in value);
}

function is_plugin_object(value) {
  return is_plain_object(value) && typeof value.name === "string";
}

function get_plugin_config_contribution(plugin) {
  const contribution = plugin[plugin_config_key];

  if (!is_plain_object(contribution)) {
    return undefined;
  }

  return contribution;
}

function is_kit_slot(value) {
  return is_plain_object(value) && value[kit_slot_key] === true;
}

function is_plain_object(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

function is_promise_like(value) {
  if ((typeof value !== "object" && typeof value !== "function") || !value) {
    return false;
  }

  return typeof value.then === "function";
}

function resolve_options(options) {
  return {
    pre_order: options.pre_order ?? "strip",
    diagnostics: options.diagnostics ?? true,
    svelte_config: options.svelte_config ?? "direct",
  };
}

function make_diagnostics_plugin(diagnostics) {
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

function make_diagnostics_lines(diagnostics) {
  const config_lines = diagnostics.configs.map((entry) => {
    const keys = entry.keys.length > 0 ? entry.keys.join(", ") : "empty";

    return `svelte-plugin-composer: merged ${entry.source} config (${keys})`;
  });
  const pre_order_lines = diagnostics.pre_order.map((entry) =>
    [
      "svelte-plugin-composer:",
      entry.action,
      `${entry.plugin_name}.${entry.target}`,
    ].join(" ")
  );

  return [...config_lines, ...pre_order_lines];
}
