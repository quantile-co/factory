import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "vitest";

it("validates native Amp Collector base and optional overlays", () => {
  const state = mkdtempSync(join(tmpdir(), "factory-amp-cursors-"));
  try {
    for (const overlays of [[], ["journald", "docker"]]) {
      execFileSync(
        "otelcol-contrib",
        [
          "validate",
          ...["config", ...overlays].flatMap((name) => [
            "--config",
            fileURLToPath(
              new URL(
                `../../etc/otelcol-contrib/${name}.yaml`,
                import.meta.url,
              ),
            ),
          ]),
        ],
        {
          env: {
            ...process.env,
            QUANTILE_OTLP_ENDPOINT: "https://ingest.example.invalid",
            QUANTILE_OTELCOL_TOKEN_FILE: join(state, "token"),
            QUANTILE_OTELCOL_LOG_DIRECTORY: state,
            QUANTILE_OTELCOL_CURSOR_DIRECTORY: state,
          },
          stdio: "pipe",
        },
      );
    }
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});
