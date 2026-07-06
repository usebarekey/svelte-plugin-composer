export default {
	fmt: {
		ignorePatterns: [".dist/**", "dist/**"],
		tabWidth: 4,
		useTabs: true,
	},
	lint: {
		ignorePatterns: [".dist/**", "dist/**"],
		options: { typeAware: true, typeCheck: true },
	},
	pack: {
		dts: true,
		entry: ["src/mod.ts", "src/vite.ts"],
		format: ["esm"],
		outDir: ".dist",
		sourcemap: true,
	},
};
