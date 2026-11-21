import type {
  ExtensionAPI,
  ProviderConfig,
} from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { registerGateway } from "./gateway.ts";

const setup = () => {
  const registerProvider =
    vi.fn<(name: string, config: ProviderConfig) => void>();
  registerGateway({ registerProvider } as unknown as ExtensionAPI);
  return registerProvider;
};

afterEach(() => vi.unstubAllEnvs());

it("bundles priced physical models and only references the key by environment variable", () => {
  vi.stubEnv("LANGFUSE_GATEWAY_KEY", "test-key-not-embedded");
  vi.stubEnv("LANGFUSE_GATEWAY_HOST", "https://gateway.example.test/");
  const registerProvider = setup();
  expect(registerProvider).toHaveBeenCalledOnce();
  const registration = registerProvider.mock.calls[0];
  if (!registration) throw new Error("Missing Gateway registration");
  const [provider, config] = registration;
  expect(provider).toBe("langfuse-openai");
  expect(config).toMatchObject({
    baseUrl: "https://gateway.example.test/openai/v1",
    apiKey: "$LANGFUSE_GATEWAY_KEY",
    api: "openai-responses",
  });
  expect(config.models).toHaveLength(10);
  expect(
    config.models?.every(
      (model) => model.id.startsWith("openai:") && model.cost.input > 0,
    ),
  ).toBe(true);
  expect(
    config.models?.find((model) => model.id === "openai:gpt-6.2-sol")?.cost,
  ).toEqual({
    input: 2,
    output: 10,
    cacheRead: 0.1,
    cacheWrite: 2.5,
    tiers: [
      {
        inputTokensAbove: 272000,
        input: 4,
        output: 15,
        cacheRead: 0.2,
        cacheWrite: 5,
      },
    ],
  });
});

it("leaves the virtual-only provider selectable when the key is missing", () => {
  vi.stubEnv("LANGFUSE_GATEWAY_KEY", undefined);
  expect(setup()).not.toHaveBeenCalled();
});
