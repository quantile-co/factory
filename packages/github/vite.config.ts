import { dts } from "rolldown-plugin-dts";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  oxc: { exclude: [/\.js$/, /\.d\.[cm]?ts$/] },
  plugins:
    command === "build"
      ? [dts({ generator: "tsgo", tsconfig: "tsconfig.json" })]
      : [],
  build: {
    target: "node24",
    minify: false,
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: (_format, name) => `${name}.js`,
    },
    rolldownOptions: { platform: "node", external: [/^node:/] },
  },
}));
