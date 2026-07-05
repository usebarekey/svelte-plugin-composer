import { assertStringIncludes } from "@std/assert";
import { emptyDir, ensureDir } from "@std/fs";
import { dirname, fromFileUrl, join, toFileUrl } from "@std/path";

const root_dir = dirname(fromFileUrl(import.meta.url));
const package_dir = dirname(root_dir);
const fixture_dir = join(root_dir, "fixtures", "kit-app");
const global_ts_dir = join(package_dir, "..", "svelte-global-typescript");
const sv_extension_dir = join(package_dir, "..", "svelte-sv-extension");

Deno.test("compose builds a SvelteKit app with .sv routes and stripped pre transforms", async () => {
  await write_fixture();
  await run_fixture_task("sync");
  await run_fixture_task("build");

  const home_html = await Deno.readTextFile(
    join(fixture_dir, "build", "index.html"),
  );
  const sv_html = await Deno.readTextFile(
    join(fixture_dir, "build", "sv-route.html"),
  );

  assertStringIncludes(home_html, "Composer home");
  assertStringIncludes(home_html, "Imported from .sv");
  assertStringIncludes(sv_html, "SV route");
  assertStringIncludes(sv_html, "Imported from .svelte");
});

async function write_fixture(): Promise<void> {
  await emptyDir(fixture_dir);
  await ensureDir(join(fixture_dir, "src", "lib"));
  await ensureDir(join(fixture_dir, "src", "routes", "sv-route"));

  await Deno.writeTextFile(
    join(fixture_dir, "deno.json"),
    JSON.stringify(
      {
        imports: {
          "@jridgewell/sourcemap-codec":
            "npm:@jridgewell/sourcemap-codec@^1.5.5",
          "@sveltejs/adapter-static": "npm:@sveltejs/adapter-static@^3.0.0",
          "@sveltejs/kit": "npm:@sveltejs/kit@^2.62.0",
          "magic-string": "npm:magic-string@^0.30.21",
          "svelte": "npm:svelte@^5.0.0",
          "svelte-global-typescript": `${
            toFileUrl(join(global_ts_dir, "src", "mod.js"))
          }`,
          "svelte-plugin-composer": `${
            toFileUrl(join(package_dir, "src", "mod.js"))
          }`,
          "svelte-sv-extension": `${
            toFileUrl(join(sv_extension_dir, "src", "mod.js"))
          }`,
          "vite": "npm:vite@^8.0.0",
        },
        nodeModulesDir: "auto",
        tasks: {
          build: "vite build",
          sync: "svelte-kit sync",
        },
      },
      null,
      2,
    ),
  );
  await Deno.writeTextFile(
    join(fixture_dir, "vite.config.ts"),
    `
      import adapter from "@sveltejs/adapter-static";
      import { defineConfig } from "vite";
      import { sv } from "svelte-sv-extension";
      import { ts } from "svelte-global-typescript";
      import { compose, kit } from "svelte-plugin-composer";

      function fake_ser_order_probe() {
        return {
          name: "fake-ser-order-probe",
          transform(code, id) {
            if (!id.endsWith(".svelte") && !id.endsWith(".sv")) {
              return null;
            }

            if (code.includes("let title: string") && !code.includes('lang="ts"')) {
              throw new Error("global TypeScript did not run before the normal-order probe");
            }

            return null;
          },
        };
      }

      export default defineConfig({
        plugins: compose([
          sv(),
          ts(),
          fake_ser_order_probe(),
          kit({
            adapter: adapter({ pages: "build", assets: "build", fallback: undefined }),
          }),
        ], {
          diagnostics: false,
        }),
      });
    `,
  );
  await Deno.writeTextFile(
    join(fixture_dir, "src", "app.html"),
    `
      <!doctype html>
      <html lang="en">
        <head>
          %sveltekit.head%
        </head>
        <body data-sveltekit-preload-data="hover">
          <div style="display: contents">%sveltekit.body%</div>
        </body>
      </html>
    `,
  );
  await Deno.writeTextFile(
    join(fixture_dir, "src", "routes", "+layout.ts"),
    `
      export const prerender = true;
    `,
  );
  await Deno.writeTextFile(
    join(fixture_dir, "src", "lib", "Badge.sv"),
    `
      <script>
        let label: string = "Imported from .sv";
      </script>

      <p>{label}</p>
    `,
  );
  await Deno.writeTextFile(
    join(fixture_dir, "src", "lib", "Panel.svelte"),
    `
      <script>
        let label: string = "Imported from .svelte";
      </script>

      <p>{label}</p>
    `,
  );
  await Deno.writeTextFile(
    join(fixture_dir, "src", "routes", "+page.svelte"),
    `
      <script>
        import Badge from "$lib/Badge.sv";

        let title: string = "Composer home";
      </script>

      <h1>{title}</h1>
      <Badge />
    `,
  );
  await Deno.writeTextFile(
    join(fixture_dir, "src", "routes", "sv-route", "+page.sv"),
    `
      <script>
        import Panel from "$lib/Panel.svelte";

        let title: string = "SV route";
      </script>

      <h1>{title}</h1>
      <Panel />
    `,
  );
}

async function run_fixture_task(task: "sync" | "build"): Promise<void> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["task", task],
    cwd: fixture_dir,
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);

  if (output.success) {
    return;
  }

  throw new Error(
    [
      `Fixture task failed: deno task ${task}`,
      stdout,
      stderr,
    ].join("\n"),
  );
}
