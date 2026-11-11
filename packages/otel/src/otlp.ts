import { randomBytes } from "node:crypto";
import type { ManagedConfig } from "./config.ts";

export type Attributes = Record<string, string | number | boolean>;
export type MetadataSpan = {
  traceId: string;
  spanId: string;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  kind?: number;
  status?: { code: number };
  attributes: {
    key: string;
    value: {
      stringValue?: string;
      intValue?: string;
      doubleValue?: number;
      boolValue?: boolean;
    };
  }[];
};

export function attributes(values: Attributes): MetadataSpan["attributes"] {
  return Object.entries(values)
    .slice(0, 32)
    .flatMap(([key, value]): MetadataSpan["attributes"] => {
      if (key.length > 128) return [];
      if (typeof value === "string" && value.length <= 256)
        return [{ key, value: { stringValue: value } }];
      if (typeof value === "boolean")
        return [{ key, value: { boolValue: value } }];
      if (typeof value === "number" && Number.isFinite(value))
        return [
          {
            key,
            value: Number.isSafeInteger(value)
              ? { intValue: String(value) }
              : { doubleValue: value },
          },
        ];
      return [];
    });
}

export function metadataSpan(
  name: string,
  start: string,
  end: string,
  values: Attributes,
): MetadataSpan {
  return {
    traceId: randomBytes(16).toString("hex"),
    spanId: randomBytes(8).toString("hex"),
    name,
    startTimeUnixNano: start,
    endTimeUnixNano: end,
    attributes: attributes(values),
  };
}

// Callers own the positive metadata policy. This transport has no discovery,
// diagnostics, persistent queue or ambient OTEL_* exporter configuration.
export async function exportSpans(
  config: ManagedConfig,
  resource: Attributes,
  scope: string,
  spans: MetadataSpan[],
  attempts = 1,
): Promise<boolean> {
  if (!spans.length) return true;
  try {
    if (spans.length > 64) return false;
    const body = JSON.stringify({
      resourceSpans: [
        {
          resource: { attributes: attributes(resource) },
          scopeSpans: [{ scope: { name: scope }, spans }],
        },
      ],
    });
    if (Buffer.byteLength(body) > 262_144) return false;
    for (
      let attempt = 0;
      attempt < Math.min(2, Math.max(1, attempts));
      attempt++
    ) {
      try {
        const response = await fetch(`${config.endpoint}/v1/traces`, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(1_500),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.key}`,
          },
          body,
        });
        if (response.ok) {
          let text = "";
          let size = 0;
          const reader = response.body?.getReader();
          const decoder = new TextDecoder();
          while (reader) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 4096) {
              await reader.cancel();
              return false;
            }
            text += decoder.decode(value, { stream: true });
          }
          text += decoder.decode();
          const partial = text ? JSON.parse(text).partialSuccess : undefined;
          // Never retry a partially accepted batch or expose server errorMessage.
          return (
            !partial ||
            (Number(partial.rejectedSpans ?? 0) === 0 && !partial.errorMessage)
          );
        }
        await response.body?.cancel();
        if (response.status !== 429 && response.status < 500) return false;
      } catch {
        /* Bounded retry, no raw errors. */
      }
    }
  } catch {
    /* Invalid metadata must not fail a workload. */
  }
  return false;
}
