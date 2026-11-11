import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import {
  identity,
  orbPeers,
  resume,
  resumeScript,
  setupScript,
} from "./index.ts";
import plugin, { type AmpPlugin } from "./plugin.ts";

const thread = "T-12345678-1234-1234-1234-123456789abc";
it("keys machines by thread, starts labels with org/repo and rejects unsafe input", () => {
  const orb = {
    thread,
    repository: "quantile-co/factory",
    issue: 123,
    title: "Fix cache",
  };
  expect(identity(orb)).toEqual({
    thread,
    hostname: "amp-12345678-1234-1234-1234-123456789abc",
    label: "quantile-co/factory · #123 Fix cache · T-56789abc",
  });
  expect(
    identity({ ...orb, thread: `https://ampcode.com/threads/${thread}` }),
  ).toEqual(identity(orb));
  expect(identity({ thread, project: "Scratch" }).label).toMatch(
    /^Scratch · T-/,
  );
  expect(
    identity({ ...orb, thread: thread.replace("12345678-", "abcdefab-") })
      .hostname,
  ).not.toBe(identity(orb).hostname);
  for (const invalid of [
    { ...orb, thread: "T-$(touch nope)" },
    { ...orb, repository: "just-a-repo" },
    { ...orb, issue: -1 },
    { ...orb, title: "line\nbreak" },
    { ...orb, title: "x".repeat(129) },
    { thread, issue: 123 },
  ])
    expect(() => identity(invalid)).toThrow();
  expect(
    orbPeers({
      Peer: {
        one: { HostName: "orb", Tags: ["tag:amp-orb"], Online: false },
        two: { HostName: "laptop", Online: true },
      },
    }),
  ).toEqual([{ HostName: "orb", Tags: ["tag:amp-orb"], Online: false }]);
});

it("lifecycle scripts parse but refuse execution outside an orb before service commands", async () => {
  for (const script of [
    setupScript,
    resumeScript,
    ...["setup", "resume"].map((hook) =>
      readFileSync(
        new URL(`../../../.agents/${hook}`, import.meta.url),
        "utf8",
      ),
    ),
  ]) {
    expect(spawnSync("bash", ["-n"], { input: script }).status).toBe(0);
    const lint = spawnSync("shellcheck", ["--shell=bash", "-"], {
      input: script,
      encoding: "utf8",
    });
    expect(lint.status, lint.stdout + lint.stderr).toBe(0);
    const result = spawnSync("bash", ["-euo", "pipefail", "-c", script], {
      env: { AMP_ORB: "0" },
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("only for an Amp orb");
  }
  vi.stubEnv("AMP_ORB", "0");
  try {
    await expect(resume({ thread }, "/", "/missing")).rejects.toThrow(
      "only for an Amp orb",
    );
  } finally {
    vi.unstubAllEnvs();
  }
});

it("keeps awake only on explicit commands and serializes rapid toggles", async () => {
  let toggle!: Parameters<AmpPlugin["registerCommand"]>[2];
  let acquired = 0;
  let released = 0;
  const notifications: string[] = [];
  const ctx = {
    ui: {
      notify: async (message: string) => {
        notifications.push(message);
      },
    },
  };
  plugin({
    system: {
      executor: {
        keepAlive: async () => {
          acquired++;
          return {
            unsubscribe: () => {
              released++;
            },
          };
        },
      },
    },
    registerCommand: (_name, _options, handler) => {
      toggle = handler;
    },
  });
  expect(acquired).toBe(0);
  await Promise.all([toggle(ctx), toggle(ctx)]);
  expect(acquired).toBe(1);
  expect(released).toBe(1);
  expect(notifications[0]).toContain("billed");
  await toggle(ctx);
  expect(acquired).toBe(2);
});

it("allows another explicit attempt after a rejected keep-alive lease", async () => {
  let toggle!: Parameters<AmpPlugin["registerCommand"]>[2];
  let attempts = 0;
  plugin({
    system: {
      executor: {
        keepAlive: async () => {
          if (++attempts === 1) throw new Error("not an orb");
          return { unsubscribe: () => {} };
        },
      },
    },
    registerCommand: (_name, _options, handler) => {
      toggle = handler;
    },
  });
  const ctx = { ui: { notify: async () => {} } };
  await expect(toggle(ctx)).rejects.toThrow("not an orb");
  await expect(toggle(ctx)).resolves.toBeUndefined();
});
