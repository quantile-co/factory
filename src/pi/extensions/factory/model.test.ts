import type {
  Api,
  ClassifierApi,
  ClassifierModel,
  ClassifierResult,
  Model,
  Usage,
} from "@earendil-works/pi-ai";
import { afterEach, expect, it, vi } from "vitest";
import { selectChild } from "./model.ts";

type Context = Parameters<typeof selectChild>[1];
const task = "Implement a local widget with small focused behavioral tests.";
function model(id: string): Model<Api> {
  return {
    provider: "openai-codex",
    id,
    name: id,
    api: "openai-codex-responses",
    baseUrl: "https://example.invalid",
    reasoning: true,
    input: ["text"],
    contextWindow: id === "gpt-6.1-sol" ? 500000 : 272000,
    maxTokens: 128000,
    thinkingLevelMap: { xhigh: "xhigh", max: "max" },
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}
const usage: Usage = {
  input: 10,
  output: 1,
  totalTokens: 11,
  cacheRead: 0,
  cacheWrite: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
function result(
  complexity = "routine",
  p = 0.96,
  risk = 0.01,
): ClassifierResult {
  return {
    provider: "typesafe",
    model: "jev-latest",
    api: "typesafe-system-one",
    timestamp: 0,
    stopReason: "stop",
    usage,
    answers: {
      complexity: {
        type: "choice",
        choice: complexity,
        probabilities: { [complexity]: p },
        confidence: 0.8,
      },
      risk: { type: "bool", probability: risk },
    },
  };
}
function context() {
  const available = [
    "gpt-6-luna",
    "gpt-6.1-sol",
    "gpt-6-astra",
    "gpt-6-sol",
    "gpt-5.6-luna",
    "gpt-5.6-terra",
    "gpt-5.6-sol",
  ].map(model);
  const classify = vi.fn(async () => result());
  const ctx: Context = {
    model: available[2],
    thinkingLevel: "high",
    scopedModels: [],
    modelRegistry: {
      getAvailable: () => available,
      getRegisteredProviderIds: () => [],
      getProviderAuthStatus: () => ({ configured: true, source: "stored" }),
      isUsingOAuth: () => true,
      findOfType: () =>
        ({
          provider: "typesafe",
          id: "jev-latest",
        }) as ClassifierModel<ClassifierApi>,
      classify,
    },
  };
  return { ctx, classify, available };
}
afterEach(() => vi.useRealTimers());

it.each(["fork", "fresh"] as const)(
  "deliberately inherits current API state for %s without classification",
  async (contextMode) => {
    const { ctx, classify } = context();
    expect(
      await selectChild({ model: "inherit", context: contextMode, task }, ctx),
    ).toMatchObject({
      provider: "openai-codex",
      model: "gpt-6-astra",
      thinking: "high",
      disposition: "inherit",
      authSource: "stored",
      oauth: true,
    });
    expect(classify).not.toHaveBeenCalled();
  },
);

it.each([
  ["routine", "gpt-6-luna", "high"],
  ["standard", "gpt-6.1-sol", "medium"],
  ["hard", "gpt-6-astra", "high"],
])(
  "auto by default routes %s once with native usage and task-only state",
  async (complexity, id, effort) => {
    const { ctx, classify } = context();
    classify.mockResolvedValue(result(complexity));
    const selection = await selectChild({ context: "fresh", task }, ctx);
    expect(selection).toMatchObject({
      model: id,
      thinking: effort,
      disposition: "auto",
      usage,
    });
    expect(selection.warning).toBeUndefined();
    expect(classify).toHaveBeenCalledExactlyOnceWith(
      { provider: "typesafe", id: "jev-latest" },
      {
        state: { task },
        questions: {
          complexity: expect.objectContaining({ type: "choice" }),
          risk: expect.objectContaining({ type: "bool" }),
        },
      },
      { signal: expect.any(AbortSignal) },
    );
  },
);

it.each([
  ["routine", "gpt-5.6-luna", "high"],
  ["standard", "gpt-6-sol", "medium"],
  ["standard", "gpt-5.6-terra", "medium"],
  ["hard", "gpt-5.6-sol", "high"],
])(
  "includes scoped %s candidate %s without requiring unrelated tiers",
  async (complexity, id, thinking) => {
    const { ctx, classify, available } = context();
    ctx.scopedModels = available
      .filter((entry) => entry.id === id)
      .map((entry) => ({ model: entry }));
    classify.mockResolvedValue(result(complexity));
    expect(await selectChild({ task, context: "fresh" }, ctx)).toMatchObject({
      model: id,
      thinking,
      disposition: "auto",
    });
  },
);

it("keeps deliberate model/thinking choices, even on fallback or outside cycling scope", async () => {
  const { ctx, classify, available } = context();
  ctx.scopedModels = [{ model: available[2] }];
  expect(
    await selectChild(
      { model: "openai-codex/gpt-6.1-sol", thinking: "low" },
      ctx,
    ),
  ).toMatchObject({
    model: "gpt-6.1-sol",
    thinking: "low",
    disposition: "explicit",
  });
  expect(classify).not.toHaveBeenCalled();
  ctx.scopedModels = [];
  classify.mockResolvedValue(result("standard"));
  expect(await selectChild({ thinking: "low", task }, ctx)).toMatchObject({
    model: "gpt-6.1-sol",
    thinking: "low",
  });
  expect(await selectChild({ thinking: "inherit", task }, ctx)).toMatchObject({
    model: "gpt-6.1-sol",
    thinking: "high",
  });
  expect(
    await selectChild(
      { model: "openai-codex/gpt-6.1-sol", thinking: "auto", task },
      ctx,
    ),
  ).toMatchObject({ model: "gpt-6.1-sol", thinking: "medium" });
  classify.mockRejectedValue(new Error("private provider details"));
  expect(
    await selectChild(
      { model: "openai-codex/gpt-6.1-sol", thinking: "auto", task },
      ctx,
    ),
  ).toMatchObject({
    model: "gpt-6.1-sol",
    thinking: "high",
    disposition: "fallback",
  });
});

it("rejects invalid/unavailable exact choices, virtual parents, extension providers and inline keys", async () => {
  const { ctx, classify } = context();
  for (const choice of [
    "gpt-6-luna",
    "openai-codex/missing",
    "openai-codex/gpt-6-luna:high",
    "",
  ])
    await expect(selectChild({ model: choice }, ctx)).rejects.toThrow(
      /physical model/,
    );
  await expect(selectChild({ thinking: "bogus" }, ctx)).rejects.toThrow(
    /Invalid explicit thinking/,
  );
  ctx.model = { ...model("auto"), api: "pi-virtual" };
  await expect(selectChild({ task }, ctx)).rejects.toThrow(
    /virtual inheritance is unsupported/,
  );
  await expect(
    selectChild({ model: "openai-codex/gpt-6-luna" }, ctx),
  ).rejects.toThrow(/router-defined meaning/);
  expect(
    await selectChild(
      { model: "openai-codex/gpt-6-luna", thinking: "high" },
      ctx,
    ),
  ).toMatchObject({ model: "gpt-6-luna", thinking: "high" });
  ctx.model = model("gpt-6-astra");
  ctx.modelRegistry.getRegisteredProviderIds = () => ["openai-codex"];
  await expect(
    selectChild({ model: "openai-codex/gpt-6-luna" }, ctx),
  ).rejects.toThrow(/extension-registered/);
  ctx.modelRegistry.getRegisteredProviderIds = () => [];
  ctx.modelRegistry.getProviderAuthStatus = () => ({
    configured: true,
    source: "runtime",
  });
  await expect(
    selectChild({ model: "openai-codex/gpt-6-luna" }, ctx),
  ).rejects.toThrow(/runtime API-key/);
  expect(classify).not.toHaveBeenCalled();
});

it.each([
  "uncertain",
  "risk",
  "unknown",
  "error",
  "throw",
  "nan",
  "infinity",
  "negative",
])("inherits both settings on classifier %s", async (failure) => {
  const { ctx, classify } = context();
  const response = result(
    failure === "unknown" ? "unknown" : "routine",
    failure === "uncertain" ? 0.6 : 0.96,
    failure === "risk" ? 0.8 : 0.01,
  );
  if (["nan", "infinity", "negative"].includes(failure))
    response.answers.complexity = result(
      "routine",
      { nan: Number.NaN, infinity: Infinity, negative: -1 }[failure],
    ).answers.complexity;
  if (failure === "error") response.stopReason = "error";
  if (failure === "throw")
    classify.mockRejectedValue(new Error("private provider details"));
  else classify.mockResolvedValue(response);
  const selection = await selectChild({ task }, ctx);
  expect(selection).toMatchObject({
    model: "gpt-6-astra",
    thinking: "high",
    disposition: "fallback",
  });
  expect(selection.reason).not.toContain("private provider details");
  if (failure !== "throw") expect(selection.usage).toEqual(usage);
});

it.each([
  "missing",
  "auth",
  "provider",
  "risk",
  "large",
  "code",
  "secrets",
  "small",
])("does no classifier work for %s preflight fallback", async (reason) => {
  const { ctx, classify, available } = context();
  let input = task;
  if (reason === "missing") ctx.modelRegistry.findOfType = () => undefined;
  if (reason === "auth")
    ctx.modelRegistry.getProviderAuthStatus = (provider) => ({
      configured: provider !== "typesafe",
      source: "stored",
    });
  if (reason === "provider") {
    ctx.model = { ...available[2], provider: "openai" };
    available.push(ctx.model);
  }
  if (reason === "risk")
    input = "Change security IAM permissions and migrate production state";
  if (reason === "large") input = "a".repeat(4001);
  if (reason === "code")
    input = `${task}\n\`\`\`typescript\nconst x = 1;\n\`\`\``;
  if (reason === "secrets") input = `${task} api_key=private-value`;
  if (reason === "small") input = "fix it";
  expect(await selectChild({ task: input }, ctx)).toMatchObject({
    model: "gpt-6-astra",
    thinking: "high",
    disposition: "fallback",
  });
  expect(classify).not.toHaveBeenCalled();
});

it("warns on material roster drift, but never expands scope or auto-selects unknown models", async () => {
  const { ctx, available, classify } = context();
  available.push(model("future-model"));
  expect((await selectChild({ task }, ctx)).warning).toContain(
    "unknown [future-model]",
  );
  ctx.scopedModels = [{ model: available[0] }, { model: available[1] }];
  expect(await selectChild({ task, context: "fresh" }, ctx)).toMatchObject({
    model: "gpt-6-luna",
    disposition: "auto",
    warning: expect.stringContaining("uncovered tiers [hard]"),
  });
  classify.mockResolvedValue(result("hard"));
  expect(await selectChild({ task }, ctx)).toMatchObject({
    model: "gpt-6-astra",
    disposition: "fallback",
  });
  ctx.scopedModels = [{ model: available[7] }];
  expect(await selectChild({ task }, ctx)).toMatchObject({
    model: "gpt-6-astra",
    disposition: "fallback",
  });
});

it("does not guess capacity, shrink forks, silently clamp or override scoped effort", async () => {
  const { ctx, available } = context();
  ctx.model = available[1];
  expect(await selectChild({ task }, ctx)).toMatchObject({
    model: "gpt-6.1-sol",
    thinking: "high",
    disposition: "fallback",
  });
  expect(await selectChild({ context: "fresh", task }, ctx)).toMatchObject({
    model: "gpt-6-luna",
    disposition: "auto",
  });
  available[0].contextWindow = Number.NaN;
  expect(await selectChild({ context: "fresh", task }, ctx)).toMatchObject({
    disposition: "fallback",
  });
  available[0].contextWindow = 272000;
  ctx.scopedModels = available.map((entry) => ({
    model: entry,
    thinkingLevel: "low",
  }));
  expect(await selectChild({ context: "fresh", task }, ctx)).toMatchObject({
    disposition: "fallback",
  });
  ctx.scopedModels = [];
  available[0].thinkingLevelMap = { high: null };
  expect(await selectChild({ context: "fresh", task }, ctx)).toMatchObject({
    disposition: "fallback",
  });
  await expect(
    selectChild({ model: "openai-codex/gpt-6-luna", thinking: "high" }, ctx),
  ).rejects.toThrow(/no silent clamping/);
});

it("bounds classifier latency even if a provider ignores abort", async () => {
  vi.useFakeTimers();
  const { ctx, classify } = context();
  classify.mockImplementation(() => new Promise(() => {}));
  const pending = selectChild({ task }, ctx);
  await vi.advanceTimersByTimeAsync(5001);
  expect(await pending).toMatchObject({
    model: "gpt-6-astra",
    thinking: "high",
    disposition: "fallback",
    reason: expect.stringContaining("timeout"),
  });
});

it("cancellation is never swallowed as fallback, and native aborted usage survives", async () => {
  const { ctx, classify } = context();
  const controller = new AbortController();
  classify.mockImplementation(() => new Promise(() => {}));
  const pending = selectChild({ task }, ctx, controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow(/cancelled/);
  await expect(selectChild({}, ctx, controller.signal)).rejects.toThrow(
    /abort/i,
  );
  classify.mockResolvedValue({ ...result(), stopReason: "aborted" });
  await expect(selectChild({ task }, ctx)).rejects.toMatchObject({
    message: expect.stringContaining("cancelled"),
    usage,
  });
});
