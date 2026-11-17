import keepAwake, { type AmpPlugin as KeepAwakePlugin } from "./keep-awake.ts";
import telemetry, { type TelemetryPlugin } from "./telemetry.ts";

export type AmpPlugin = KeepAwakePlugin & TelemetryPlugin;

// One installed bundle; capabilities retain independent configuration and failures.
export default function plugin(amp: AmpPlugin): void {
  if (process.env.AMP_ORB !== "1") return;
  try {
    keepAwake(amp);
  } catch {
    amp.logger.log("Factory keep-awake initialization unavailable.");
  }
  try {
    telemetry(amp);
  } catch {
    amp.logger.log("Factory telemetry initialization unavailable.");
  }
}
