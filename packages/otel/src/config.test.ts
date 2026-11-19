import { expect, it } from "vitest";
import { collectorEndpoint } from "./config.ts";

it("requires only the origin and normalizes a trailing slash", () => {
  expect(collectorEndpoint({})).toBeUndefined();
  expect(
    collectorEndpoint({
      QUANTILE_OTLP_ENDPOINT: "https://collector.invalid:8443/",
    }),
  ).toBe("https://collector.invalid:8443");
});

it.each([
  "http://sensitive.invalid",
  "https://user:sensitive@host.invalid",
  "https://host.invalid/v1/traces",
  "https://host.invalid/?sensitive",
])("rejects invalid origins without echoing the input", (endpoint) => {
  expect(() => collectorEndpoint({ QUANTILE_OTLP_ENDPOINT: endpoint })).toThrow(
    "Invalid OTel configuration; supply an HTTPS Collector base endpoint.",
  );
});
