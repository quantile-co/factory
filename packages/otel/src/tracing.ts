import { managedConfig } from "./config.ts";

export type TracingOptions = { serviceName: string };
export type Tracing = { flush(): Promise<void> };
const state = globalThis as typeof globalThis & {
  __factoryOtelTracing?: Promise<Tracing | undefined>;
};

// Application opt-in only. Preserve native SDK spans and do not attach an
// exporter to another integration's provider (including Langfuse).
export async function initializeTracing(
  options?: TracingOptions,
  env = process.env,
): Promise<Tracing | undefined> {
  if (!options) return;
  try {
    const config = managedConfig(env);
    if (!config) return;
    if (!/^[\w.-]{1,100}$/.test(options.serviceName)) throw new Error();
    state.__factoryOtelTracing ??= (async () => {
      const [
        { trace, context },
        {
          detectResources,
          envDetector,
          processDetector,
          hostDetector,
          defaultResource,
          resourceFromAttributes,
        },
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
      // Avoid accidentally mixing another integration's authentication headers.
      // This guard never mutates process-global exporter configuration.
      if (
        process.env.OTEL_EXPORTER_OTLP_HEADERS ||
        process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS
      ) {
        throw new Error();
      }
      const provider = new sdk.TracerProvider({
        resource: defaultResource()
          .merge(
            detectResources({
              detectors: [envDetector, processDetector, hostDetector],
            }),
          )
          .merge(
            resourceFromAttributes({ "service.name": options.serviceName }),
          ),
        spanProcessors: [
          new sdk.BatchSpanProcessor({
            exporter: new OTLPTraceExporter({
              url: `${config.endpoint}/v1/traces`,
              headers: { authorization: `Bearer ${config.key}` },
              timeoutMillis: 10_000,
              httpAgentOptions: { keepAlive: true },
            }),
          }),
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
          try {
            await provider.forceFlush();
          } catch {
            console.error("OTel trace flush failed.");
          }
        },
      };
    })().catch(() => {
      console.error("OTel tracing initialization unavailable.");
      return undefined;
    });
    return await state.__factoryOtelTracing;
  } catch {
    console.error("OTel tracing disabled: invalid runtime configuration.");
    return undefined;
  }
}
