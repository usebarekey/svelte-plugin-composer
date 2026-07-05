# svelte-plugin-composer

Compose a SvelteKit plugin stack without making every plugin fight over setup
order.

`svelte-plugin-composer` lets small helpers contribute SvelteKit config, then
turns those fragments into one final `sveltekit(...)` call. It also keeps plugin
stacks predictable by flattening presets, preserving the order you wrote, and
removing user-supplied `pre` priority by default.

## Install

```sh
npm install -D svelte-plugin-composer
```

## Setup

```ts
import adapter from "@sveltejs/adapter-auto";
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
    kit({
      adapter: adapter(),
      compilerOptions: {
        experimental: {
          async: true,
        },
      },
    }),
  ]),
});
```

`kit(...)` owns the final SvelteKit plugin call. Put config helpers and normal
Vite plugins in `compose([...])`, then add one `kit(...)` item where the
generated SvelteKit plugin group should appear.

## What It Does

- accepts Vite plugins, nested plugin arrays, falsy entries, and Svelte config
  fragments
- merges Svelte config before creating the final SvelteKit plugin group
- appends and dedupes `extensions`
- concatenates `preprocess`
- deep merges `compilerOptions`, `vitePlugin`, `kit`, and custom config objects
- composes `kit.typescript.config` hooks in contribution order
- strips user plugin `enforce: "pre"` and hook `order: "pre"` by default
- leaves SvelteKit internals created by `kit(...)` alone

## API

```ts
import { compose, kit, svelte } from "svelte-plugin-composer";
```

The same exports are also available from:

```ts
import { compose, kit, svelte } from "svelte-plugin-composer/vite";
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
});
```

`pre_order` can be:

- `"strip"`: remove user-supplied pre priority
- `"warn"`: keep it, but report what would have been stripped
- `"preserve"`: leave priorities untouched

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

Config fragments only work when a `kit(...)` item is present, because the
composer needs one final place to call SvelteKit with the merged config.

Do not pass an already-created `sveltekit()` plugin into `compose([...])` when
you want config merging. The composer cannot merge new config into a SvelteKit
plugin that has already been created.

## Notes

Direct SvelteKit plugin config requires SvelteKit 2.62 or newer. If your project
still uses `svelte.config.js`, keep using SvelteKit's normal setup until you can
move the config into `kit(...)`.

Priority normalization applies to the user plugins passed into `compose([...])`.
SvelteKit's own internal plugins, created by `kit(...)`, are left alone.
