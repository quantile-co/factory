import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { registerLatest, resolveLatestParent } from "./latest.ts";

type Alias = Parameters<ExtensionAPI["registerVirtualModel"]>[0];
type RouteRequest = Parameters<Alias["route"]>[0];
type PhysicalModel = NonNullable<RouteRequest["previous"]>["model"];

function model(provider: string, id: string): PhysicalModel {
  return {
    provider,
    id,
    api:
      provider === "openai-codex"
        ? "openai-codex-responses"
        : "openai-responses",
  } as PhysicalModel;
}

function setup(models: PhysicalModel[]) {
  const registerVirtualModel = vi.fn<ExtensionAPI["registerVirtualModel"]>();
  registerLatest({
    registerVirtualModel,
    on: vi.fn(),
  } as unknown as ExtensionAPI);
  const ctx = {
    modelRegistry: { getAvailable: () => models },
  } as unknown as ExtensionContext;

  return (provider: string, id = "gpt-6-sol-latest") => {
    const alias = registerVirtualModel.mock.calls
      .map(([definition]) => definition)
      .find(
        (definition) =>
          definition.provider === provider && definition.id === id,
      );
    if (!alias) throw new Error(`Missing alias: ${provider}/${id}`);
    return (request: Partial<RouteRequest> = {}) =>
      alias.route(
        {
          reason: "user",
          thinkingLevel: "high",
          messages: [],
          ...request,
        } as RouteRequest,
        ctx,
      );
  };
}

const codex = "openai-codex";
const langfuse = "langfuse-openai";

beforeEach(() => vi.stubEnv("LANGFUSE_GATEWAY_KEY", "placeholder"));
afterEach(() => vi.unstubAllEnvs());

it("registers only provider-specific aliases, even without the Gateway key", () => {
  vi.stubEnv("LANGFUSE_GATEWAY_KEY", undefined);
  const registerVirtualModel = vi.fn<ExtensionAPI["registerVirtualModel"]>();
  registerLatest({
    registerVirtualModel,
    on: vi.fn(),
  } as unknown as ExtensionAPI);
  expect(
    registerVirtualModel.mock.calls.map(([alias]) => [
      alias.provider,
      alias.id,
    ]),
  ).toEqual(
    [codex, langfuse].flatMap((provider) =>
      ["sol", "astra", "luna"].map((family) => [
        provider,
        `gpt-6-${family}-latest`,
      ]),
    ),
  );
});

it("resolves child inheritance only within the selected provider", () => {
  const gatewaySol = model(langfuse, "openai:gpt-6.2-sol");
  const codexSol = model(codex, "gpt-6.4-sol");
  const models = [codexSol, model(langfuse, "openai:gpt-6.1-sol"), gatewaySol];
  const parent = {
    provider: langfuse,
    api: "pi-virtual",
    id: "gpt-6-sol-latest",
  };
  expect(resolveLatestParent(parent, models)).toBe(gatewaySol);
  expect(resolveLatestParent(parent, [codexSol])).toBe(parent);
});

it("fails with an actionable error when the Gateway key is missing", () => {
  vi.stubEnv("LANGFUSE_GATEWAY_KEY", undefined);
  const codexSol = model(codex, "gpt-6.2-sol");
  const route = setup([codexSol]);
  expect(() => route(langfuse)()).toThrow("LANGFUSE_GATEWAY_KEY is not set");
  expect(route(codex)()).toMatchObject({ model: codexSol });
});

it("resolves both providers independently and compares minors numerically", () => {
  const codexSol = model(codex, "gpt-6.20-sol");
  const gatewaySol = model(langfuse, "openai:gpt-6.10-sol");
  const gatewayLuna = model(langfuse, "openai:gpt-6-luna");
  const gatewayAstra = model(langfuse, "openai:gpt-6.2-astra");
  const route = setup([
    codexSol,
    gatewaySol,
    gatewayLuna,
    gatewayAstra,
    model(langfuse, "openai:gpt-6.2-sol"),
    model(langfuse, "openai:gpt-6.99-sol-preview"),
  ]);
  expect(route(codex)()).toEqual({ model: codexSol, thinkingLevel: "high" });
  expect(route(langfuse)()).toEqual({
    model: gatewaySol,
    thinkingLevel: "high",
  });
  expect(route(langfuse, "gpt-6-luna-latest")()).toMatchObject({
    model: gatewayLuna,
  });
  expect(route(langfuse, "gpt-6-astra-latest")()).toMatchObject({
    model: gatewayAstra,
  });
});

it("keeps same-provider continuations sticky and ignores a retry from another provider", () => {
  const previous = model(langfuse, "openai:gpt-6-sol");
  const newest = model(langfuse, "openai:gpt-6.2-sol");
  const route = setup([previous, newest])(langfuse);
  expect(
    route({
      reason: "continuation",
      previous: { model: previous, thinkingLevel: "low" },
    }),
  ).toEqual({ model: previous, thinkingLevel: "low" });
  expect(
    route({
      reason: "retry",
      failed: {
        model: model(codex, "gpt-6.3-sol"),
        thinkingLevel: "low",
      } as RouteRequest["failed"],
    }),
  ).toEqual({ model: newest, thinkingLevel: "high" });
});

it("fails rather than falling back to Codex when no Langfuse model qualifies", () => {
  const route = setup([model(codex, "gpt-6.2-sol")])(langfuse);
  expect(() => route()).toThrow("No GPT-6 Sol available on langfuse-openai");
});
