import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "node24",
    minify: false,
    lib: { entry: "cli.ts", formats: ["es"], fileName: () => "cli.js" },
    rolldownOptions: {
      platform: "node",
      external: [/^node:/, /^@quantile-co\//, "commander"],
    },
  },
});
