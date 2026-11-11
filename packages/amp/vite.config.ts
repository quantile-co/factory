import { dts } from "rolldown-plugin-dts";
import { defineConfig } from "vite";

export default defineConfig(({ command, mode }) => {
  // Inline shared helpers in Amp's standalone plugin, never sibling chunks.
  const entry: Record<string, string> =
    mode === "telemetry"
      ? { telemetry: "src/telemetry.ts" }
      : { index: "src/index.ts", plugin: "src/plugin.ts" };
  return {
    oxc: { exclude: [/\.js$/, /\.d\.[cm]?ts$/] },
    plugins:
      command === "build" && mode !== "telemetry"
        ? [dts({ generator: "tsgo", tsconfig: "tsconfig.json" })]
        : [],
    build: {
      target: "node24",
      minify: false,
      emptyOutDir: mode !== "telemetry",
      lib: {
        entry,
        formats: ["es"],
        fileName: (_format, name) => `${name}.js`,
      },
      rolldownOptions: { platform: "node", external: [/^node:/] },
    },
  };
});
