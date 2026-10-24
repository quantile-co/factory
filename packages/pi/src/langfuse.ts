import type { ClassifierResult } from "@earendil-works/pi-ai";
import { startObservation } from "@langfuse/tracing";

/** Reuse the plugin's public SDK provider; never create an exporter or resolve credentials. */
export function traceClassifier(options: {
  sessionId: string;
  toolCallId: string;
}):
  | ((result: ClassifierResult | undefined, failure?: string) => void)
  | undefined {
  const traceId = process.env.LANGFUSE_PI_PARENT_TRACE_ID;
  const spanId = process.env.LANGFUSE_PI_PARENT_SPAN_ID;
  // Inherited or withdrawn context is not this session's active turn.
  if (
    process.env.LANGFUSE_PI_PARENT_SESSION_ID !== options.sessionId ||
    !traceId?.match(/^[a-f0-9]{32}$/) ||
    !spanId?.match(/^[a-f0-9]{16}$/) ||
    /^0+$/.test(traceId) ||
    /^0+$/.test(spanId)
  )
    return undefined;

  try {
    const generation = startObservation(
      "Factory child classification",
      {
        model: "typesafe/jev-latest",
        metadata: {
          provider: "typesafe",
          tool_call_id: options.toolCallId,
          cost_source: "unknown",
        },
      },
      {
        asType: "generation",
        parentSpanContext: { traceId, spanId, traceFlags: 1 },
      },
    );
    if (!generation.otelSpan.isRecording()) {
      generation.end();
      return undefined;
    }
    return (result, failure) => {
      try {
        const usage = result?.usage;
        const status = failure ?? result?.stopReason ?? "error";
        generation.update({
          ...(result ? { model: `${result.provider}/${result.model}` } : {}),
          // Only classifier labels/probabilities, not task text or provider error bodies.
          output: result?.answers,
          usageDetails: usage
            ? { input: usage.input, output: usage.output }
            : undefined,
          costDetails:
            usage && usage.cost.total > 0
              ? { total: usage.cost.total }
              : undefined,
          metadata: {
            stop_reason: status,
            cost_source:
              usage && usage.cost.total > 0 ? "pi-catalog" : "unknown",
          },
          ...(status !== "stop"
            ? { level: "WARNING", statusMessage: `Classifier ${status}` }
            : {}),
        });
      } catch {
        // Export is best-effort; native accounting still records this usage once.
      } finally {
        try {
          generation.end();
        } catch {}
      }
    };
  } catch {
    // Inactive/failed tracing keeps the ordinary native tool-usage path.
    return undefined;
  }
}
