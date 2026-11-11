import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { withoutCredentials } from "./src/config.ts";

it("packs an installable CLI/subpaths and loads both standalone Amp plugins without a source tree", () => {
  const temporary = mkdtempSync(join(tmpdir(), "factory-otel-package-"));
  const env = withoutCredentials(process.env);
  try {
    const archive = join(temporary, "factory-otel.tgz");
    execFileSync("pnpm", ["pack", "--out", archive], {
      cwd: fileURLToPath(new URL(".", import.meta.url)),
      env,
      stdio: "pipe",
    });
    const consumer = join(temporary, "consumer");
    mkdirSync(consumer);
    writeFileSync(
      join(consumer, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        scripts: { otel: "factory-otel" },
      }),
    );
    // Temporary directories may select a different filesystem-local pnpm store.
    const store = execFileSync("pnpm", ["store", "path"], {
      env,
      encoding: "utf8",
    }).trim();
    execFileSync(
      "pnpm",
      [
        "add",
        "--offline",
        "--ignore-scripts",
        "--store-dir",
        dirname(store),
        archive,
      ],
      {
        cwd: consumer,
        env,
        stdio: "pipe",
      },
    );
    const run = spawnSync(
      "pnpm",
      ["otel", "--", process.execPath, "-e", "process.exit(23)"],
      { cwd: consumer, env, encoding: "utf8" },
    );
    expect(run.status, run.stdout + run.stderr).toBe(23);
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      for (const path of ['config', 'collector', 'otlp', 'tracing']) await import('@quantile-co/factory-otel/' + path);
      const { initializeTracing } = await import('@quantile-co/factory-otel/tracing');
      if (await initializeTracing() !== undefined) process.exit(1);
    `,
      ],
      { cwd: consumer, env, stdio: "pipe" },
    );
    const standalone = join(temporary, "plugins");
    mkdirSync(standalone);
    writeFileSync(join(standalone, "package.json"), '{"type":"module"}');
    for (const name of ["plugin", "telemetry"])
      copyFileSync(
        new URL(`../amp/dist/${name}.js`, import.meta.url),
        join(standalone, `${name}.js`),
      );
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      for (const name of ['plugin', 'telemetry']) {
        if (typeof (await import('./' + name + '.js')).default !== 'function') process.exit(1);
      }
    `,
      ],
      { cwd: standalone, env, stdio: "pipe" },
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}, 30_000);
