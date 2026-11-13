import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { it } from "vitest";

it("validates the native Amp Collector without CI run metadata", () => {
  execFileSync(
    "otelcol-contrib",
    [
      "validate",
      "--config",
      fileURLToPath(
        new URL("../../etc/otelcol-contrib/config.yaml", import.meta.url),
      ),
    ],
    {
      env: {
        ...process.env,
        CLICKSTACK_OTLP_ENDPOINT: "https://ingest.example.invalid",
        CLICKSTACK_API_KEY: "fixture-only",
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
});
