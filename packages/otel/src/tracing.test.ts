import { context, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { type ReadableSpan, TracerProvider } from "@opentelemetry/sdk-trace";
import {
  afterEach,
  beforeEach,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import { initializeTracing, type TracingPolicy } from "./tracing.ts";

const transport = vi.hoisted(() => ({
  spans: [] as ReadableSpan[],
  constructor: vi.fn(),
}));
vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: class {
    constructor(options: unknown) {
      transport.constructor(options);
    }
    export(spans: ReadableSpan[], done: (result: { code: number }) => void) {
      transport.spans.push(...spans);
      done({ code: 0 });
    }
    async shutdown() {}
  },
}));
const policy: TracingPolicy = {
  serviceName: "fixture-app",
  spanName: "Application request",
  sample: ({ kind, attributes }) =>
    kind === SpanKind.SERVER && attributes.operation === "approved",
  attributes: (attributes): Record<string, string> =>
    attributes.result === "ok" ? { result: "ok" } : {},
};
let registration: MockInstance<typeof trace.setGlobalTracerProvider>;
beforeEach(() => {
  vi.stubEnv("CLICKSTACK_OTLP_ENDPOINT", "https://ingest.example.invalid");
  vi.stubEnv("CLICKSTACK_API_KEY", "fixture-key");
  registration = vi.spyOn(trace, "setGlobalTracerProvider");
  transport.spans.length = 0;
});
afterEach(async () => {
  for (const [provider] of registration.mock.calls)
    await (provider as TracerProvider).shutdown();
  trace.disable();
  context.disable();
  delete (globalThis as { __factoryOtelTracing?: unknown })
    .__factoryOtelTracing;
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

it("requires an explicit policy and rejects ambiguous ambient headers without changing them", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await initializeTracing()).toBeUndefined();
  vi.stubEnv("OTEL_EXPORTER_OTLP_HEADERS", "authorization=PRIVATE_KEY");
  expect(await initializeTracing(policy)).toBeUndefined();
  expect(process.env.OTEL_EXPORTER_OTLP_HEADERS).toBe(
    "authorization=PRIVATE_KEY",
  );
  expect(transport.constructor).not.toHaveBeenCalled();
  expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE_KEY");
});

it("initializes once and batches only fresh caller-approved spans through the official exporter", async () => {
  vi.stubEnv("OTEL_RESOURCE_ATTRIBUTES", "secret=PRIVATE_RESOURCE");
  vi.stubEnv("OTEL_SERVICE_NAME", "PRIVATE_SERVICE");
  vi.stubEnv(
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "https://unrelated.example.invalid",
  );
  const [first, second] = await Promise.all([
    initializeTracing(policy),
    initializeTracing(policy),
  ]);
  expect(first).toBe(second);
  expect(registration).toHaveBeenCalledTimes(1);
  expect(transport.constructor).toHaveBeenCalledExactlyOnceWith({
    url: "https://ingest.example.invalid/v1/traces",
    headers: { authorization: "Bearer fixture-key" },
    timeoutMillis: 1500,
    concurrencyLimit: 1,
    httpAgentOptions: { keepAlive: true },
  });
  const tracer = trace.getTracer("PRIVATE_SCOPE", "PRIVATE_VERSION");
  const span = tracer.startSpan("PRIVATE_NAME", {
    kind: SpanKind.SERVER,
    attributes: {
      operation: "approved",
      url: "PRIVATE_URL",
      cookie: "PRIVATE_COOKIE",
    },
    links: [
      {
        context: {
          traceId: "1".repeat(32),
          spanId: "2".repeat(16),
          traceFlags: 1,
        },
      },
    ],
  });
  span.setAttribute("result", "ok");
  span.setStatus({ code: SpanStatusCode.ERROR, message: "PRIVATE_STATUS" });
  span.addEvent("PRIVATE_EVENT");
  span.recordException(new Error("PRIVATE_ERROR"));
  span.end();
  tracer.startSpan("PRIVATE_UNSAMPLED").end();
  await first?.flush();
  expect(transport.spans).toHaveLength(1);
  const safe = transport.spans[0];
  expect(safe.name).toBe("Application request");
  expect(safe.attributes).toEqual({ result: "ok" });
  expect(safe.status).toEqual({ code: SpanStatusCode.ERROR });
  expect(safe.resource.attributes).toEqual({ "service.name": "fixture-app" });
  expect(safe.events).toEqual([]);
  expect(safe.links).toEqual([]);
  expect(JSON.stringify(safe)).not.toContain("PRIVATE_");
});

it("leaves an existing provider untouched instead of attaching another integration's exporter", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  trace.setGlobalTracerProvider(new TracerProvider());
  const existing = trace.getTracer("existing");
  expect(await initializeTracing(policy)).toBeUndefined();
  expect(trace.getTracer("existing")).toBe(existing);
});
