import type { Attributes, SpanKind } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace";
import { managedConfig } from "./config.ts";

export type TracingPolicy = {
  serviceName: string;
  spanName: string;
  sample(span: {
    name: string;
    kind: SpanKind;
    attributes: Attributes;
  }): boolean;
  attributes(attributes: Attributes): Record<string, string | number | boolean>;
};
export type Tracing = { flush(): Promise<void> };
const state = globalThis as typeof globalThis & {
  __factoryOtelTracing?: Promise<Tracing | undefined>;
};

// Explicit application-owned policy only. Never attach to Langfuse's provider,
// install auto-instrumentation/propagators or enable ambient OTEL exporters.
export async function initializeTracing(
  policy?: TracingPolicy,
  env = process.env,
): Promise<Tracing | undefined> {
  if (
    !policy ||
    typeof policy.sample !== "function" ||
    typeof policy.attributes !== "function"
  )
    return;
  try {
    const config = managedConfig(env);
    if (!config) return;
    if (
      !/^[\w.-]{1,100}$/.test(policy.serviceName) ||
      !/^[\w .-]{1,80}$/.test(policy.spanName)
    )
      throw new Error();
    const selected = { ...policy };
    state.__factoryOtelTracing ??= (async () => {
      const [
        { trace, context },
        { resourceFromAttributes },
        sdk,
        { OTLPTraceExporter },
        { AsyncLocalStorageContextManager },
      ] = await Promise.all([
        import("@opentelemetry/api"),
        import("@opentelemetry/resources"),
        import("@opentelemetry/sdk-trace"),
        import("@opentelemetry/exporter-trace-otlp-http"),
        import("@opentelemetry/context-async-hooks"),
      ]);
      const resource = resourceFromAttributes({
        "service.name": selected.serviceName,
      });
      // The exporter snapshots fallback headers in its constructor. No async gap
      // after this guard, and no mutation of another integration's environment.
      if (
        process.env.OTEL_EXPORTER_OTLP_HEADERS ||
        process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS
      )
        throw new Error();
      const batch = new sdk.BatchSpanProcessor({
        maxExportBatchSize: 1,
        maxQueueSize: 128,
        exportTimeoutMillis: 2_000,
        exporter: new OTLPTraceExporter({
          url: `${config.endpoint}/v1/traces`,
          headers: { authorization: `Bearer ${config.key}` },
          timeoutMillis: 1_500,
          httpAgentOptions: { keepAlive: true },
          concurrencyLimit: 1,
        }),
      });
      const provider = new sdk.TracerProvider({
        resource,
        sampler: {
          shouldSample: (_context, _id, name, kind, values) => {
            let sample = false;
            try {
              sample =
                selected.sample({ name, kind, attributes: values }) === true;
            } catch {
              /* Fail closed. */
            }
            return {
              decision: sample
                ? sdk.SamplingDecision.RECORD_AND_SAMPLED
                : sdk.SamplingDecision.NOT_RECORD,
            };
          },
          toString: () => "CallerPrivacyPolicy",
        },
        spanLimits: {
          eventCountLimit: 0,
          linkCountLimit: 0,
          attributeCountLimit: 64,
          attributeValueLengthLimit: 512,
        },
        spanProcessors: [
          {
            onStart() {},
            onEnd(span) {
              try {
                const values: Attributes = {};
                for (const [key, value] of Object.entries(
                  selected.attributes(span.attributes),
                ).slice(0, 32)) {
                  if (
                    key.length <= 128 &&
                    ((typeof value === "string" && value.length <= 256) ||
                      typeof value === "boolean" ||
                      (typeof value === "number" && Number.isFinite(value)))
                  )
                    values[key] = value;
                }
                // Construct a fresh allowlisted span BEFORE batching. Raw names,
                // status messages, events, links, scope and discovered resources
                // never enter the exporter queue.
                const { traceId, spanId, traceFlags } = span.spanContext();
                const safe: ReadableSpan = {
                  name: selected.spanName,
                  kind: span.kind,
                  spanContext: () => ({ traceId, spanId, traceFlags }),
                  startTime: span.startTime,
                  endTime: span.endTime,
                  duration: span.duration,
                  ended: span.ended,
                  status: { code: span.status.code },
                  attributes: values,
                  events: [],
                  links: [],
                  resource,
                  instrumentationScope: { name: "factory.otel" },
                  droppedAttributesCount: 0,
                  droppedEventsCount: 0,
                  droppedLinksCount: 0,
                };
                batch.onEnd(safe);
              } catch {
                /* A failed policy drops the span, never the workload. */
              }
            },
            forceFlush: () => batch.forceFlush(),
            shutdown: () => batch.shutdown(),
          },
        ],
      });
      const manager = new AsyncLocalStorageContextManager().enable();
      if (!context.setGlobalContextManager(manager)) {
        manager.disable();
        await provider.shutdown();
        throw new Error();
      }
      if (!trace.setGlobalTracerProvider(provider)) {
        context.disable();
        await provider.shutdown();
        throw new Error();
      }
      return {
        async flush() {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              provider.forceFlush(),
              new Promise<void>((resolve) => {
                timer = setTimeout(resolve, 2_000);
              }),
            ]);
          } catch {
            /* Best effort; no raw provider diagnostics. */
          } finally {
            clearTimeout(timer);
          }
        },
      };
    })().catch(() => {
      console.error("OTel tracing initialization unavailable.");
      return undefined;
    });
    return await state.__factoryOtelTracing;
  } catch {
    console.error(
      "OTel tracing disabled: invalid runtime configuration or privacy policy.",
    );
    return undefined;
  }
}
