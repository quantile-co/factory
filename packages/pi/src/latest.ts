import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const factoryProvider = "factory";
const codexProvider = "openai-codex";
const langfuseProvider = "langfuse-openai";
const families = ["Sol", "Astra", "Luna"] as const;
type Family = (typeof families)[number];

function latest<T extends { id: string }>(
  models: T[],
  family: Family,
  prefix = "",
) {
  const pattern = new RegExp(
    `^${prefix}gpt-6(?:\\.(\\d+))?-${family.toLowerCase()}$`,
  );
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

const aliasId = (family: Family) => `gpt-6-${family.toLowerCase()}-latest`;

export function resolveLatestParent<
  T extends { provider: string; api: string; id: string },
>(parent: T | undefined, models: T[]) {
  if (parent?.api !== "pi-virtual") return parent;
  const physical = models.filter((entry) => entry.api !== "pi-virtual");
  if (parent.provider === factoryProvider && parent.id === aliasId("Sol"))
    return preferredSol(physical) ?? parent;
  if (parent.provider !== codexProvider) return parent;
  const family = families.find((entry) => aliasId(entry) === parent.id);
  return family
    ? (latest(
        physical.filter((entry) => entry.provider === codexProvider),
        family,
      ) ?? parent)
    : parent;
}

const available = (ctx: ExtensionContext, provider: string) =>
  ctx.modelRegistry
    .getAvailable()
    .filter(
      (model) => model.provider === provider && model.api !== "pi-virtual",
    );

function preferredSol<T extends { provider: string; id: string }>(models: T[]) {
  if (process.env.LANGFUSE_GATEWAY_KEY) {
    const gateway = latest(
      models.filter((model) => model.provider === langfuseProvider),
      "Sol",
      "openai:",
    );
    if (gateway) return gateway;
  }
  return latest(
    models.filter((model) => model.provider === codexProvider),
    "Sol",
  );
}

type RouteRequest = Parameters<
  Parameters<ExtensionAPI["registerVirtualModel"]>[0]["route"]
>[0];

function stickyRoute(
  request: RouteRequest,
  provider: string,
  family: Family,
  prefix: string,
) {
  const sticky =
    request.reason === "retry"
      ? request.failed
      : request.reason === "continuation"
        ? request.previous
        : undefined;
  if (
    sticky?.model.provider === provider &&
    sticky.model.api !== "pi-virtual" &&
    latest([sticky.model], family, prefix)
  )
    return {
      model: sticky.model,
      thinkingLevel: sticky.thinkingLevel ?? request.thinkingLevel,
    };
}

function registerDefault(api: ExtensionAPI) {
  api.registerVirtualModel({
    provider: factoryProvider,
    id: aliasId("Sol"),
    name: "GPT-6 Sol (latest, Langfuse first)",
    thinkingLevels: ["low", "medium", "high", "xhigh", "max"],
    route(request, ctx) {
      const models = ctx.modelRegistry
        .getAvailable()
        .filter((model) => model.api !== "pi-virtual");
      const model = preferredSol(models);
      if (!model)
        throw new Error(
          "No GPT-6 Sol available on Langfuse or Codex. Check /model.",
        );
      const prefix = model.provider === langfuseProvider ? "openai:" : "";
      return (
        stickyRoute(request, model.provider, "Sol", prefix) ?? {
          model,
          thinkingLevel: request.thinkingLevel,
        }
      );
    },
  });
}

function registerProviderAliases(
  api: ExtensionAPI,
  provider: string,
  prefix = "",
) {
  for (const family of families) {
    api.registerVirtualModel({
      provider,
      id: aliasId(family),
      name: `GPT-6 ${family} (latest)`,
      thinkingLevels: ["low", "medium", "high", "xhigh", "max"],
      route(request, ctx) {
        const sticky = stickyRoute(request, provider, family, prefix);
        if (sticky) return sticky;
        const model = latest(available(ctx, provider), family, prefix);
        if (!model)
          throw new Error(
            `No GPT-6 ${family} available on ${provider}. Check /model.`,
          );
        return { model, thinkingLevel: request.thinkingLevel };
      },
    });
  }
}

export function registerLatest(api: ExtensionAPI) {
  registerDefault(api);
  registerProviderAliases(api, codexProvider);
  // Without the opt-in key, Pi would expose aliases even on a virtual-only provider.
  if (process.env.LANGFUSE_GATEWAY_KEY)
    registerProviderAliases(api, langfuseProvider, "openai:");

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
    const local = available(ctx, codexProvider);
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
  api.on("model_select", ({ model, source }, ctx) => {
    void updateStatus(ctx);
    if (
      !ctx.hasUI ||
      source === "restore" ||
      !(
        model.provider === factoryProvider ||
        model.provider === codexProvider ||
        model.provider === langfuseProvider
      ) ||
      model.api !== "pi-virtual"
    )
      return;
    const family = families.find((entry) => aliasId(entry) === model.id);
    if (!family) return;
    // Pi writes its own chat status after model_select returns.
    setImmediate(() => {
      if (ctx.model?.provider !== model.provider || ctx.model.id !== model.id)
        return;
      ctx.ui.notify(
        `Selected for your next message: ${family} (latest) • ${api.getThinkingLevel()}. The footer arrow shows which model answered last.`,
        "info",
      );
    });
  });
  api.on("before_agent_start", (_event, ctx) => {
    void updateStatus(ctx);
  });
}
