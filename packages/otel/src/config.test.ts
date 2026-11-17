import { expect, it } from "vitest";
import { collectorEndpoint, managedConfig } from "./config.ts";

it("rejects partial or unsafe managed configuration without echoing values", () => {
  const credentials = {
    QUANTILE_OTLP_ENDPOINT: "https://ingest.example.invalid/",
    QUANTILE_OTLP_INGEST_TOKEN: "fixture-key",
  };
  expect(managedConfig({})).toBeUndefined();
  expect(
    collectorEndpoint({
      QUANTILE_OTLP_ENDPOINT: credentials.QUANTILE_OTLP_ENDPOINT,
    }),
  ).toBe("https://ingest.example.invalid");
  expect(managedConfig(credentials)?.endpoint).toBe(
    "https://ingest.example.invalid",
  );
  for (const env of [
    { QUANTILE_OTLP_INGEST_TOKEN: "sensitive" },
    { QUANTILE_OTLP_ENDPOINT: "https://sensitive.invalid" },
    { ...credentials, QUANTILE_OTLP_ENDPOINT: "http://sensitive.invalid" },
    {
      ...credentials,
      QUANTILE_OTLP_ENDPOINT: "https://user:sensitive@host.invalid",
    },
    {
      ...credentials,
      QUANTILE_OTLP_ENDPOINT: "https://host.invalid/v1/traces",
    },
    {
      ...credentials,
      QUANTILE_OTLP_ENDPOINT: "https://host.invalid/?sensitive",
    },
    { ...credentials, QUANTILE_OTLP_INGEST_TOKEN: "Bearer sensitive" },
  ]) {
    try {
      managedConfig(env);
      throw new Error("accepted sensitive input");
    } catch (error) {
      expect(String(error)).not.toContain("sensitive");
    }
  }
});
