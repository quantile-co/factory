import { randomUUID } from "node:crypto";
import { type Attributes, SpanStatusCode, trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

/** Create a local provider; the host decides whether to register it globally. */
export function createTracing(
  serviceName: string,
  attributes: Attributes = {},
) {
  // The upstream HTTP exporter merges ambient headers. Only the collector may
  // authenticate upstream; never forward inherited credentials to the listener.
  if (
    process.env.OTEL_EXPORTER_OTLP_HEADERS ||
    process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS
  )
    throw new Error("Local trace export does not accept exporter headers");
  return new NodeTracerProvider({
    resource: resourceFromAttributes({
      ...attributes,
      "service.name": serviceName,
      "service.instance.id": randomUUID(),
    }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: "http://127.0.0.1:4318/v1/traces",
          timeoutMillis: 1000,
        }),
        { exportTimeoutMillis: 1500 },
      ),
    ],
  });
}

/** Record just the operation and its outcome, never task arguments or errors. */
export function withSpan<T>(name: string, task: () => Promise<T>): Promise<T> {
  const result: Promise<T> = trace
    .getTracer("factory")
    .startActiveSpan(name, async (span) => {
      try {
        return await task();
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });
  return result;
}
