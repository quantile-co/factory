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
            CLICKSTACK_OTLP_ENDPOINT: "https://ingest.example.invalid",
            CLICKSTACK_API_KEY: "fixture-only",
            OTEL_LOG_DIRECTORY: state,
            OTEL_CURSOR_DIRECTORY: state,
            OTEL_AGENT_PLATFORM: "amp-orb",
            OTEL_AGENT_THREAD_ID: "fixture-thread",
            OTEL_AGENT_INSTANCE_ID: "fixture-instance",
            OTEL_AGENT_REPOSITORY: "quantile-co/factory",
            OTEL_AGENT_RUN_ID: "",
            OTEL_AGENT_RUN_ATTEMPT: "",
          },
          stdio: "pipe",
        },
      );
    }
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});
