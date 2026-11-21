import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import models from "./langfuse-models.json";

export const langfuseProvider = "langfuse-openai";
export const langfusePrefix = "openai:";
export const gatewayKeyVariable = "LANGFUSE_GATEWAY_KEY";
export const hasGatewayKey = () => Boolean(process.env[gatewayKeyVariable]);
export const gatewayBaseUrl = () => {
  const host =
    process.env.LANGFUSE_GATEWAY_HOST ||
    "https://gateway.us.cloud.langfuse.com";
  return `${host.replace(/\/+$/, "")}/openai/v1`;
};
export const isBundledGatewayModel = (model: {
  id: string;
  provider: string;
  api: string;
  baseUrl: string;
}) =>
  model.provider === langfuseProvider &&
  model.api === "openai-responses" &&
  model.baseUrl === gatewayBaseUrl() &&
  models.some(({ id }) => id === model.id);

export function registerGateway(api: ExtensionAPI) {
  // Leave a virtual-only provider without auth so Pi retains the alias at
  // startup and can explain the missing key instead of picking another provider.
  if (!hasGatewayKey()) return;

  api.registerProvider(langfuseProvider, {
    name: "Langfuse AI Gateway (OpenAI)",
    baseUrl: gatewayBaseUrl(),
    api: "openai-responses",
    apiKey: `$${gatewayKeyVariable}`,
    // Estimates are a snapshot of Pi's OpenAI Codex catalog, not gateway charges.
    // https://pi.dev/api/models/providers/openai-codex
    models: models.map((model) => ({
      ...model,
      reasoning: true,
      input: ["text", "image"],
    })),
  });
}
