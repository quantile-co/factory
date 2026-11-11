import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

// Standalone native plugin: Node built-ins only, no package/runtime imports.
const run = promisify(execFile);
const pollMs = 5_000;
const graceMs = 120_000;
type Mode = "auto" | "on" | "off";
type Lease = { unsubscribe(): void };
type Context = { ui: { notify(message: string): Promise<void> } };
export type AmpPlugin = {
  system: {
    executor: {
      kind: "local" | "remote" | "unknown";
      keepAlive(): Promise<Lease>;
    };
  };
  logger: { log(message: string): void };
  registerCommand(
    name: string,
    options: { title: string; category: string; description: string },
    handler: (ctx: Context) => Promise<void>,
  ): unknown;
};

async function piWorking(): Promise<boolean> {
  const env = { ...process.env };
  delete env.HERDR_SOCKET_PATH;
  delete env.HERDR_CLIENT_SOCKET_PATH;
  // Read locally, NOT through amp.$ or an Amp tool: observation must not count
  // as agent work and refresh Amp's idle clock. No server startup or fallback.
  const { stdout } = await run(
    join(homedir(), ".local/bin/herdr"),
    ["--session", "orb", "agent", "list"],
    { env, timeout: 3_000, maxBuffer: 1_048_576, encoding: "utf8" },
  );
  const result = JSON.parse(stdout).result;
  if (result?.type !== "agent_list" || !Array.isArray(result.agents))
    throw new Error("Unexpected Herdr agent inventory.");
  return result.agents.some(
    (agent: { agent: string; agent_status: string }) =>
      agent.agent === "pi" && agent.agent_status === "working",
  );
}

export default function plugin(amp: AmpPlugin): void {
  // Executor kind describes UI location, not whether this is an orb.
  // keepAlive itself rejects outside an Amp-managed orb.
  if (process.env.AMP_ORB !== "1") return;
  let mode: Mode = "auto";
  let lease: Lease | undefined;
  let lastWorking: number | undefined;
  let unavailable = false;
  let polling = false;
  let pending = Promise.resolve();

  function serial(action: () => Promise<void>): Promise<void> {
    const next = pending.then(action);
    pending = next.catch(() => {
      amp.logger.log(
        "Factory keep-awake operation failed; check orb connectivity.",
      );
    });
    return next;
  }

  async function reconcile(): Promise<void> {
    const now = Date.now();
    const wanted =
      mode === "on" ||
      (mode === "auto" &&
        lastWorking !== undefined &&
        now - lastWorking < graceMs);
    if (wanted && !lease) {
      lease = await amp.system.executor.keepAlive();
      amp.logger.log(
        `Factory keep-awake acquired (${mode}); runtime is billed.`,
      );
    }
    if (!wanted && lease) {
      lease.unsubscribe();
      lease = undefined;
      amp.logger.log(
        "Factory keep-awake released; normal idle timeouts apply.",
      );
    }
  }

  async function poll(): Promise<void> {
    if (polling) return;
    polling = true;
    try {
      // Serialize reads with controls so a late sample cannot undo Off/re-arm.
      await serial(async () => {
        if (mode === "auto") {
          try {
            const working = await piWorking();
            unavailable = false;
            if (working) lastWorking = Date.now();
          } catch {
            // Missing activity never refreshes lastWorking.
            if (!unavailable)
              amp.logger.log(
                "Herdr activity unavailable; Auto will release after its idle grace period.",
              );
            unavailable = true;
          }
        }
        await reconcile();
      });
    } catch {
      // serial logs once per failed operation; the next bounded poll may recover.
    } finally {
      polling = false;
    }
  }

  for (const selected of ["auto", "on", "off"] as const) {
    amp.registerCommand(
      `factory-orb-awake-${selected}`,
      {
        title: `Keep awake: ${selected}`,
        category: "Factory orb",
        description:
          selected === "auto"
            ? "Follow Pi activity in Herdr's orb session; 2-minute idle grace, no working-time limit. Billed runtime."
            : selected === "on"
              ? "Explicit billed hold until Off, Auto or plugin exit; best effort, not a wake command."
              : "Release the lease and allow normal Amp idle pausing.",
      },
      (ctx) =>
        serial(async () => {
          mode = selected;
          // Moving a live manual hold to Auto gives observation time to take over.
          lastWorking = selected === "auto" && lease ? Date.now() : undefined;
          await reconcile();
          await ctx.ui.notify(
            `Factory keep-awake: ${mode}. ${mode === "off" ? "Normal Amp idle timeouts apply." : "Awake runtime is billed; manual pauses and provider limits still apply."}`,
          );
        }),
    );
  }
  amp.logger.log("Factory keep-awake ready (auto); no working-time limit.");
  const timer = setInterval(() => void poll(), pollMs);
  timer.unref();
  void poll();
}
