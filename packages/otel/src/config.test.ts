import { expect, it } from "vitest";
import { managedConfig } from "./config.ts";

it("rejects partial or unsafe managed configuration without echoing values", () => {
  const credentials = {
    CLICKSTACK_OTLP_ENDPOINT: "https://ingest.example.invalid/",
    CLICKSTACK_API_KEY: "fixture-key",
  };
  expect(managedConfig({})).toBeUndefined();
  expect(managedConfig(credentials)?.endpoint).toBe(
    "https://ingest.example.invalid",
  );
  for (const env of [
    { CLICKSTACK_API_KEY: "sensitive" },
    { CLICKSTACK_OTLP_ENDPOINT: "https://sensitive.invalid" },
    { ...credentials, CLICKSTACK_OTLP_ENDPOINT: "http://sensitive.invalid" },
    {
      ...credentials,
      CLICKSTACK_OTLP_ENDPOINT: "https://user:sensitive@host.invalid",
    },
    {
      ...credentials,
      CLICKSTACK_OTLP_ENDPOINT: "https://host.invalid/v1/traces",
    },
    {
      ...credentials,
      CLICKSTACK_OTLP_ENDPOINT: "https://host.invalid/?sensitive",
    },
    { ...credentials, CLICKSTACK_API_KEY: "Bearer sensitive" },
  ]) {
    try {
      managedConfig(env);
      throw new Error("accepted sensitive input");
    } catch (error) {
      expect(String(error)).not.toContain("sensitive");
    }
  }
});
