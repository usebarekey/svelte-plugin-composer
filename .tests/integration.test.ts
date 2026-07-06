import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repo_root = dirname(fileURLToPath(import.meta.url));
const package_root = dirname(repo_root);
const default_global_ts_root = join(package_root, "..", "svelte-global-typescript");
const default_sv_extension_root = join(package_root, "..", "svelte-sv-extension");
const global_ts_root = process.env.GLOBAL_TS_ROOT ?? default_global_ts_root;
const sv_extension_root = process.env.SV_EXTENSION_ROOT ?? default_sv_extension_root;
const vp_bin = process.env.VP_BIN ?? "vp";

describe("SvelteKit integration", () => {
	test("builds a SvelteKit app with .sv routes and stripped pre transforms", async () => {
		const fixture_dir = await mkdtemp(join(tmpdir(), "svelte-plugin-composer-"));

		try {
			await run_vp(global_ts_root, ["pack"]);
			await run_vp(sv_extension_root, ["pack"]);
			await run_vp(package_root, ["pack"]);
			await write_fixture(fixture_dir);
			await run_vp(fixture_dir, ["install"]);
			await run_vp(fixture_dir, ["exec", "svelte-kit", "sync"]);

			const build_result = await run_vp(fixture_dir, ["build"]);

			expect(build_result.output).toContain("built");

			const home_html = await readFile(join(fixture_dir, "build", "index.html"), "utf8");
			const sv_html = await readFile(join(fixture_dir, "build", "sv-route.html"), "utf8");

			expect(home_html).toContain("Composer home");
			expect(home_html).toContain("Imported from .sv");
			expect(sv_html).toContain("SV route");
			expect(sv_html).toContain("Imported from .svelte");
		} finally {
			await rm(fixture_dir, { force: true, recursive: true });
		}
	}, 120_000);
});

async function write_fixture(fixture_dir: string): Promise<void> {
	await write_text(
		fixture_dir,
		"package.json",
		`${JSON.stringify(
			{
				type: "module",
				private: true,
				dependencies: {
					"@jridgewell/sourcemap-codec": "^1.5.5",
					"@sveltejs/adapter-static": "^3.0.0",
					"@sveltejs/kit": "^2.62.0",
					"magic-string": "^0.30.21",
					svelte: "^5.0.0",
					"svelte-global-typescript": `file:${global_ts_root.replace(/\\/g, "/")}`,
					"svelte-plugin-composer": `file:${package_root.replace(/\\/g, "/")}`,
					"svelte-sv-extension": `file:${sv_extension_root.replace(/\\/g, "/")}`,
					vite: "8.1.3",
				},
				devEngines: {
					packageManager: {
						name: "pnpm",
						version: "11.10.0",
						onFail: "download",
					},
				},
			},
			null,
			"\t",
		)}\n`,
	);

	await write_text(
		fixture_dir,
		"svelte.config.js",
		[
			'import adapter from "@sveltejs/adapter-static";',
			'import { sv } from "svelte-sv-extension";',
			'import { ts } from "svelte-global-typescript";',
			'import { compose_config, kit } from "svelte-plugin-composer";',
			"",
			"export default compose_config([",
			"\tsv(),",
			"\tts(),",
			"\tkit({",
			"\t\tadapter: adapter(),",
			"\t}),",
			"]);",
			"",
		].join("\n"),
	);

	await write_text(
		fixture_dir,
		"vite.config.ts",
		[
			'import { sv } from "svelte-sv-extension";',
			'import { ts } from "svelte-global-typescript";',
			'import { compose, kit } from "svelte-plugin-composer";',
			'import { defineConfig } from "vite";',
			"",
			"function fake_ser_order_probe() {",
			"\treturn {",
			'\t\tname: "fake-ser-order-probe",',
			"\t\ttransform(code, id) {",
			'\t\t\tif (!id.endsWith(".svelte") && !id.endsWith(".sv")) {',
			"\t\t\t\treturn null;",
			"\t\t\t}",
			"",
			'\t\t\tif (code.includes("let title: string") && !code.includes(\'lang="ts"\')) {',
			'\t\t\t\tthrow new Error("global TypeScript did not run before the normal-order probe");',
			"\t\t\t}",
			"",
			"\t\t\treturn null;",
			"\t\t},",
			"\t};",
			"}",
			"",
			"export default defineConfig({",
			"\tplugins: compose([",
			"\t\tsv(),",
			"\t\tts(),",
			"\t\tfake_ser_order_probe(),",
			"\t\tkit(),",
			"\t], {",
			"\t\tdiagnostics: false,",
			'\t\tsvelte_config: "external",',
			"\t}),",
			"});",
			"",
		].join("\n"),
	);

	await write_text(
		fixture_dir,
		"tsconfig.json",
		`${JSON.stringify(
			{
				extends: "./.svelte-kit/tsconfig.json",
				compilerOptions: {
					allowJs: true,
					checkJs: true,
					esModuleInterop: true,
					forceConsistentCasingInFileNames: true,
					resolveJsonModule: true,
					skipLibCheck: true,
					sourceMap: true,
					strict: true,
					moduleResolution: "bundler",
				},
			},
			null,
			"\t",
		)}\n`,
	);

	await write_text(
		fixture_dir,
		"src/app.html",
		[
			"<!doctype html>",
			'<html lang="en">',
			"\t<head>",
			'\t\t<meta charset="utf-8" />',
			'\t\t<meta name="viewport" content="width=device-width, initial-scale=1" />',
			"\t\t%sveltekit.head%",
			"\t</head>",
			"\t<body>",
			"\t\t<div>%sveltekit.body%</div>",
			"\t</body>",
			"</html>",
			"",
		].join("\n"),
	);

	await write_text(fixture_dir, "src/routes/+layout.ts", "export const prerender = true;\n");

	await write_text(
		fixture_dir,
		"src/lib/badge.sv",
		[
			"<script>",
			'\tlet label: string = "Imported from .sv";',
			"</script>",
			"",
			"<p>{label}</p>",
			"",
		].join("\n"),
	);

	await write_text(
		fixture_dir,
		"src/lib/panel.svelte",
		[
			"<script>",
			'\tlet label: string = "Imported from .svelte";',
			"</script>",
			"",
			"<p>{label}</p>",
			"",
		].join("\n"),
	);

	await write_text(
		fixture_dir,
		"src/routes/+page.svelte",
		[
			"<script>",
			'\timport Badge from "$lib/badge.sv";',
			"",
			'\tlet title: string = "Composer home";',
			"</script>",
			"",
			"<h1>{title}</h1>",
			"<Badge />",
			"",
		].join("\n"),
	);

	await write_text(
		fixture_dir,
		"src/routes/sv-route/+page.sv",
		[
			"<script>",
			'\timport Panel from "$lib/panel.svelte";',
			"",
			'\tlet title: string = "SV route";',
			"</script>",
			"",
			"<h1>{title}</h1>",
			"<Panel />",
			"",
		].join("\n"),
	);
}

async function write_text(root: string, path: string, content: string): Promise<void> {
	const file_path = join(root, path);

	await mkdir(dirname(file_path), { recursive: true });
	await writeFile(file_path, content);
}

async function run_vp(cwd: string, args: string[]): Promise<{ code: number; output: string }> {
	const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
		const child = spawn(vp_bin, args, {
			cwd,
			env: {
				...process.env,
				NODE_PATH: [join(cwd, "node_modules"), process.env.NODE_PATH]
					.filter(Boolean)
					.join(delimiter),
			},
			stdio: ["ignore", "pipe", "pipe"],
		});

		let output = "";

		child.stdout.on("data", (chunk: Buffer) => {
			output += chunk.toString();
		});

		child.stderr.on("data", (chunk: Buffer) => {
			output += chunk.toString();
		});

		child.on("error", reject);
		child.on("close", (code: number | null) => {
			resolve({ code, output });
		});
	});

	if (result.code !== 0) {
		throw new Error(`vp ${args.join(" ")} failed:\n${result.output}`);
	}

	return {
		code: result.code,
		output: result.output,
	};
}
