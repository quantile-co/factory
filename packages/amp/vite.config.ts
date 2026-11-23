import { builtinModules } from "node:module";
import { dts } from "rolldown-plugin-dts";
import { defineConfig } from "vite";

export default defineConfig(({ command, mode }) => {
  // Inline shared helpers in Amp's standalone plugin, never sibling chunks.
  const entry: Record<string, string> =
    mode === "plugin" ? { plugin: "src/plugin.ts" } : { index: "src/index.ts" };
  return {
    resolve: { conditions: ["node", "module"], mainFields: ["module", "main"] },
    oxc: { exclude: [/\.js$/, /\.d\.[cm]?ts$/] },
    plugins:
      command === "build" && mode !== "plugin"
        ? [dts({ generator: "tsgo", tsconfig: "tsconfig.json" })]
        : [],
    build: {
      target: "node24",
      minify: false,
      emptyOutDir: mode !== "plugin",
      lib: {
        entry,
        formats: ["es"],
        fileName: (_format, name) => `${name}.js`,
      },
      rolldownOptions: {
        platform: "node",
        external: [/^node:/, ...builtinModules],
      },
    },
  };
});
