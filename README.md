<h1 align="center">svelte-plugin-composer</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/svelte-plugin-composer">npm</a>
  •
  <a href="https://docs.barekey.dev/plugin-composer">docs</a>
</p>

---

Keep SvelteKit plugins and configuration in one predictable stack.

```sh
pnpm add -D svelte-plugin-composer
```

```ts
import adapter from "@sveltejs/adapter-auto";
import { sv } from "svelte-sv-extension";
import { ts } from "svelte-global-typescript";
import { compose, kit } from "svelte-plugin-composer";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: compose([
		sv(),
		ts(),
		kit({ adapter: adapter() }),
	]),
});
```

The composer flattens plugin presets, preserves their declared order, merges
their Svelte configuration, and creates SvelteKit once at the `kit()` position.
By default it removes user plugin `enforce: "pre"` and `order: "pre"` from
`load`, `resolveId`, `transform`, and `transformIndexHtml` hooks while leaving
SvelteKit's own internals alone.

Use `compose_config()` with external-config mode when editor tooling also needs
the merged configuration.

Visit the **[docs](https://docs.barekey.dev/plugin-composer)** for merge rules,
external configuration, ordering policy, diagnostics, and API reference.
