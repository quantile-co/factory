import { dts } from "rolldown-plugin-dts";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig(({ command }) => ({
  oxc: { exclude: [/\.js$/, /\.d\.[cm]?ts$/] },
  plugins:
    command === "build"
      ? [
          dts({
            generator: "tsgo",
            tsconfig: "tsconfig.json",
            entry: ["src/index.ts"],
          }),
          viteStaticCopy({
            targets: [
              {
                src: "../../etc/pi/settings.json",
                dest: ".",
                rename: { stripBase: true },
              },
            ],
          }),
        ]
      : [],
  build: {
    target: "node24",
    minify: false,
    license: { fileName: "DEPENDENCY-LICENSES.txt" },
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: (_format, name) => `${name}.js`,
    },
    rolldownOptions: {
      platform: "node",
      external: [/^node:/, /^@earendil-works\//],
    },
  },
}));
