import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("packs SDK subpaths without a legacy CLI and loads both standalone Amp plugins without a source tree", () => {
  const temporary = mkdtempSync(join(tmpdir(), "factory-otel-package-"));
  const env = { ...process.env };
  delete env.CLICKSTACK_OTLP_ENDPOINT;
  delete env.CLICKSTACK_API_KEY;
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
        // Frozen workspace installs need not cache registry metadata.
        "--prefer-offline",
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
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      for (const path of ['config', 'otlp', 'tracing']) await import('@quantile-co/factory-otel/' + path);
      for (const path of ['collector', 'cli']) {
        try {
          await import('@quantile-co/factory-otel/' + path);
          throw new Error('Retired subpath remains exported');
        } catch (error) {
          if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
        }
      }
      const { initializeTracing } = await import('@quantile-co/factory-otel/tracing');
      if (await initializeTracing() !== undefined) process.exit(1);
    `,
      ],
      { cwd: consumer, env, stdio: "pipe" },
    );
    const manifest = JSON.parse(
      readFileSync(
        join(consumer, "node_modules/@quantile-co/factory-otel/package.json"),
        "utf8",
      ),
    );
    expect(manifest.bin).toBeUndefined();
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
