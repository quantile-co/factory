import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const provider = "openai-codex";
const families = ["Sol", "Astra", "Luna"] as const;
type Family = (typeof families)[number];

function latest<T extends { id: string }>(models: T[], family: Family) {
  const pattern = new RegExp(`^gpt-6(?:\\.(\\d+))?-${family.toLowerCase()}$`);
  let best: T | undefined;
  let minor = -1;
  for (const model of models) {
    const match = pattern.exec(model.id);
    if (match && Number(match[1] ?? 0) > minor) {
      minor = Number(match[1] ?? 0);
      best = model;
    }
  }
  return best;
}

const available = (ctx: ExtensionContext) =>
  ctx.modelRegistry
    .getAvailable()
    .filter(
      (model) => model.provider === provider && model.api !== "pi-virtual",
    );

export function registerLatest(api: ExtensionAPI) {
  for (const family of families) {
    api.registerVirtualModel({
      provider,
      id: `gpt-6-${family.toLowerCase()}-latest`,
      name: `GPT-6 ${family} (latest)`,
      thinkingLevels: ["low", "medium", "high", "xhigh", "max"],
      route(request, ctx) {
        const sticky =
          request.reason === "retry"
            ? request.failed
            : request.reason === "continuation"
              ? request.previous
              : undefined;
        if (
          sticky?.model.provider === provider &&
          latest([sticky.model], family)
        )
          return {
            model: sticky.model,
            thinkingLevel: sticky.thinkingLevel ?? request.thinkingLevel,
          };
        const model = latest(available(ctx), family);
        if (!model)
          throw new Error(`No GPT-6 ${family} available. Check /model.`);
        return { model, thinkingLevel: request.thinkingLevel };
      },
    });
  }

  // Check Pi's public catalog without mutating the registry or delaying startup.
  let remote: { id: string }[] = [];
  let checked = 0;
  async function updateStatus(ctx: ExtensionContext) {
    if (!ctx.hasUI || process.env.PI_OFFLINE) return;
    if (Date.now() - checked > 4 * 60 * 60 * 1000) {
      checked = Date.now();
      try {
        const response = await fetch(
          "https://pi.dev/api/models/providers/openai-codex",
          {
            signal: AbortSignal.timeout(4000),
          },
        );
        if (response.ok) {
          const catalog = await response.json();
          remote = Object.values(catalog.models ?? catalog).filter(
            (entry): entry is { id: string } =>
              typeof entry === "object" &&
              entry !== null &&
              "id" in entry &&
              typeof entry.id === "string",
          );
        }
      } catch {
        // Offline or unreachable: never interrupt a session for an update hint.
      }
    }
    const local = available(ctx);
    const outdated =
      local.length &&
      families.some((family) => {
        const newest = latest(remote, family);
        return newest && latest([...local, newest], family) === newest;
      });
    ctx.ui.setStatus(
      "factory-model-updates",
      outdated ? ctx.ui.theme.fg("accent", "New models available.") : undefined,
    );
  }
  api.on("session_start", (_event, ctx) => {
    void updateStatus(ctx);
  });
  api.on("model_select", (_event, ctx) => {
    void updateStatus(ctx);
  });
  api.on("before_agent_start", (_event, ctx) => {
    void updateStatus(ctx);
  });
}
