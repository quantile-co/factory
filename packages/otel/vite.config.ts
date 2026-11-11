import { dts } from "rolldown-plugin-dts";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  oxc: { exclude: [/\.js$/, /\.d\.[cm]?ts$/] },
  plugins:
    command === "build"
      ? [
          dts({
            generator: "tsgo",
            tsconfig: "tsconfig.json",
            entry: [
              "src/config.ts",
              "src/collector.ts",
              "src/otlp.ts",
              "src/tracing.ts",
            ],
          }),
        ]
      : [],
  build: {
    target: "node24",
    minify: false,
    lib: {
      entry: {
        config: "src/config.ts",
        collector: "src/collector.ts",
        otlp: "src/otlp.ts",
        tracing: "src/tracing.ts",
        cli: "../../apps/otel/cli.ts",
      },
      formats: ["es"],
      fileName: (_format, name) => `${name}.js`,
    },
    rolldownOptions: {
      platform: "node",
      external: [/^node:/, /^@opentelemetry\//],
    },
  },
}));
