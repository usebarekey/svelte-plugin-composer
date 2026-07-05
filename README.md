# svelte-plugin-composer

Compose a SvelteKit plugin stack without making every plugin fight over setup
order.

`svelte-plugin-composer` lets small helpers contribute SvelteKit config and
keeps plugin stacks predictable by flattening presets, preserving the order you
wrote, and removing user-supplied `pre` priority by default.

## Install

```sh
npm install -D svelte-plugin-composer
```

## Setup

```ts
import adapter from "@sveltejs/adapter-auto";
import { sv } from "svelte-sv-extension";
import { ts } from "svelte-global-typescript";
import { compose_config, kit } from "svelte-plugin-composer";

export default compose_config([
  sv(),
  ts(),
  kit({
    adapter: adapter(),
    compilerOptions: {
      experimental: {
        async: true,
      },
    },
  }),
]);
```

```ts
import { effect } from "svelte-effect-runtime";
import { href } from "svelte-auto-href";
import { sv } from "svelte-sv-extension";
import { ts } from "svelte-global-typescript";
import { compose, kit } from "svelte-plugin-composer";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: compose([
    sv(),
    ts(),
    effect(),
    href(),
    kit(),
  ], {
    svelte_config: "external",
  }),
});
```

`compose_config(...)` creates the Svelte config that editor tooling reads.
`compose([...], { svelte_config: "external" })` keeps Vite plugin order managed
by the composer while letting SvelteKit load that config normally.

## What It Does

- accepts Vite plugins, nested plugin arrays, falsy entries, and Svelte config
  fragments
- collects Svelte config contributions attached to compatible plugins
- merges Svelte config before creating the final SvelteKit plugin group
- appends and dedupes `extensions`
- concatenates `preprocess`
- deep merges `compilerOptions`, `vitePlugin`, `kit`, and custom config objects
- composes `kit.typescript.config` hooks in contribution order
- strips user plugin `enforce: "pre"` and hook `order: "pre"` by default
- leaves SvelteKit internals created by `kit(...)` alone

## API

```ts
import { compose, compose_config, kit, svelte } from "svelte-plugin-composer";
```

The same exports are also available from:

```ts
import {
  compose,
  compose_config,
  kit,
  svelte,
} from "svelte-plugin-composer/vite";
```

### `compose(items, options?)`

Builds the final Vite plugin list.

```ts
compose([plugin_a(), plugin_b(), kit({ adapter })]);
```

Options:

```ts
compose(items, {
  pre_order: "strip",
  diagnostics: true,
  svelte_config: "direct",
});
```

`pre_order` can be:

- `"strip"`: remove user-supplied pre priority
- `"warn"`: keep it, but report what would have been stripped
- `"preserve"`: leave priorities untouched

`svelte_config` can be:

- `"direct"`: pass merged config directly to `sveltekit(...)`
- `"external"`: call `sveltekit()` without config so `svelte.config.js` is used

Use `"external"` when editor/LSP tooling needs the same generated config.

### `compose_config(items)`

Builds the Svelte config object for `svelte.config.js`.

```ts
export default compose_config([
  sv(),
  ts(),
  kit({ adapter }),
]);
```

### `kit(config?)`

Marks the point where the final `sveltekit(merged_config)` plugin group should
appear.

```ts
compose([
  svelte({ extensions: [".svelte", ".sv"] }),
  kit({ adapter }),
]);
```

### `svelte(config)`

Adds a Svelte config fragment without creating a plugin.

```ts
compose([
  svelte({ extensions: [".svelte", ".sv"] }),
  kit({ adapter }),
]);
```

In direct mode, config fragments only work when a `kit(...)` item is present,
because the composer needs one final place to call SvelteKit with the merged
config. In external mode, put the fragments in `compose_config(...)` and use
`kit()` only to mark where SvelteKit should appear in the Vite plugin list.

Do not pass an already-created `sveltekit()` plugin into `compose([...])` when
you want config merging. The composer cannot merge new config into a SvelteKit
plugin that has already been created.

## Notes

Direct SvelteKit plugin config requires SvelteKit 2.62 or newer. Use
`svelte_config: "external"` when you want `svelte.config.js` to remain the
source of truth for editor tooling.

Priority normalization applies to the user plugins passed into `compose([...])`.
SvelteKit's own internal plugins, created by `kit(...)`, are left alone.
