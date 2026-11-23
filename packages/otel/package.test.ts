import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "vitest";

it("loads the published OTel package from an isolated consumer", () => {
  const temporary = mkdtempSync(join(tmpdir(), "factory-otel-package-"));
  const env = { ...process.env };
  delete env.QUANTILE_OTLP_ENDPOINT;
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
      await import('@quantile-co/factory-otel');
      const { collectorEndpoint } = await import('@quantile-co/factory-otel/config');
      if (collectorEndpoint({}) !== undefined) process.exit(1);
    `,
      ],
      { cwd: consumer, env, stdio: "pipe" },
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}, 30_000);
