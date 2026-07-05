import {
  assert,
  assertEquals,
  assertNotEquals,
  assertThrows,
} from "@std/assert";
import type { Plugin, PluginOption } from "vite";
import {
  compose,
  kit,
  merge_svelte_configs,
  svelte,
  to_direct_sveltekit_config,
} from "../src/internal.ts";

Deno.test("compose flattens nested plugins and ignores falsy entries", () => {
  const first: Plugin = { name: "first" };
  const second: Plugin = { name: "second" };
  const output = compose([
    false,
    [first, null, undefined],
    second,
  ] as unknown as PluginOption[], { diagnostics: false });

  assertEquals(plugin_names(output), ["first", "second"]);
});

Deno.test("compose preserves plugin order after normalization", () => {
  const first: Plugin = { name: "first" };
  const second: Plugin = { name: "second" };
  const third: Plugin = { name: "third" };
  const output = compose([[first, second], third], { diagnostics: false });

  assertEquals(plugin_names(output), ["first", "second", "third"]);
});

Deno.test("compose normalizes promised plugin options", async () => {
  const promised = Promise.resolve(
    {
      name: "promised-plugin",
      enforce: "pre",
    } satisfies Plugin,
  );
  const output = compose([promised], { diagnostics: false });
  const plugin = await output[0] as Plugin;

  assertEquals(plugin.name, "promised-plugin");
  assertEquals(plugin.enforce, undefined);
});

Deno.test("compose strips top-level pre priority from user plugins", () => {
  const input: Plugin = { name: "pre-plugin", enforce: "pre" };
  const output = compose([input], { diagnostics: false });
  const plugin = output[0] as Plugin;

  assertEquals(plugin.enforce, undefined);
  assertEquals(input.enforce, "pre");
  assertNotEquals(plugin, input);
});

Deno.test("compose strips transform pre order without losing handler or filter", () => {
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

  assertEquals(transform.order, undefined);
  assertEquals(transform.filter, filter);
  assertEquals(transform.handler, handler);
  assertEquals(original_transform.order, "pre");
});

Deno.test("compose preserves post priority", () => {
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

  assertEquals(plugin.enforce, "post");
  assertEquals(transform.order, "post");
  assertEquals(transform.handler, handler);
});

Deno.test("compose warn mode reports pre priority without stripping it", () => {
  const input: Plugin = { name: "pre-plugin", enforce: "pre" };
  const output = compose([input], {
    pre_order: "warn",
    diagnostics: false,
  });
  const plugin = output[0] as Plugin;

  assertEquals(plugin.enforce, "pre");
});

Deno.test("merge_svelte_configs preserves custom extensions and appends once", () => {
  const merged = merge_svelte_configs([
    { extensions: [".svelte", ".sv"] },
    { extensions: [".sv", ".md"] },
  ]);

  assertEquals(merged.extensions, [".svelte", ".sv", ".md"]);
});

Deno.test("merge_svelte_configs concatenates preprocess arrays", () => {
  const first = { name: "first" };
  const second = { name: "second" };
  const third = { name: "third" };
  const merged = merge_svelte_configs([
    { preprocess: first },
    { preprocess: [second, third] },
  ]);

  assertEquals(merged.preprocess, [first, second, third]);
});

Deno.test("merge_svelte_configs does not mutate original config objects", () => {
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

  assertEquals(original.extensions, [".svelte"]);
  assertEquals(original.compilerOptions, { runes: true });
  assertEquals(merged.extensions, [".svelte", ".sv"]);
  assertEquals(merged.compilerOptions, { runes: true, dev: true });
});

Deno.test("merge_svelte_configs composes kit typescript config hooks in order", () => {
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

  assertEquals(result.include, ["first", "second"]);
});

Deno.test("compose throws a clear error for config contributions without kit", () => {
  assertThrows(
    () =>
      compose([svelte({ extensions: [".sv"] })], {
        diagnostics: false,
      }),
    Error,
    "kit(...)",
  );
});

Deno.test("compose throws a clear error for multiple kit slots", () => {
  assertThrows(
    () =>
      compose([kit(), kit()], {
        diagnostics: false,
      }),
    Error,
    "only contain one kit",
  );
});

Deno.test("compose appends diagnostics by default", () => {
  const output = compose([{ name: "plugin" }]);

  assert(plugin_names(output).includes("svelte-plugin-composer:diagnostics"));
});

function plugin_names(options: readonly PluginOption[]): string[] {
  return options
    .filter((option): option is Plugin => is_plugin(option))
    .map((plugin) => plugin.name);
}

function is_plugin(option: PluginOption): option is Plugin {
  return typeof option === "object" && option !== null &&
    !Array.isArray(option) && "name" in option;
}
