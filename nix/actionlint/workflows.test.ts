import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

const workflow = (name: string) =>
  readFileSync(
    new URL(`../../.github/workflows/${name}.yaml`, import.meta.url),
    "utf8",
  );

it.each(["check", "test", "plan", "apply"])(
  "%s remains directly runnable and callable by downstream repositories",
  (name) => {
    const source = workflow(name);
    expect(source).toMatch(/^ {2}workflow_call:/m);
    expect(source).toMatch(/^ {2}workflow_dispatch:/m);
    expect(source).toContain("persist-credentials: false");
  },
);

it.each(["plan", "apply"])(
  "%s retains its protected manual gate when invoked through workflow_call",
  (name) => {
    const source = workflow(name);
    expect(source).toContain("github.event_name == 'workflow_dispatch' &&");
    expect(source).toContain("github.ref == 'refs/heads/main' &&");
    expect(source).toContain("github.triggering_actor");
    expect(source).toContain("environment: prod");
    expect(source).toContain("group: factory-production");
    expect(source).toContain("id-token: write");
    expect(source).toContain("CACHIX_AUTH_TOKEN:");
    expect(source).toMatch(/GH_REPO_TOKEN:\n\s+required: true/);
    expect(source).toMatch(
      /GITHUB_TOKEN:\s+\$\{\{ secrets\.GH_REPO_TOKEN \}\}/,
    );
    expect(source).toMatch(
      /REST_API_BEARER:\s+\$\{\{ secrets\.GH_REPO_TOKEN \}\}/,
    );
    expect(source).toContain('"$cli" shell -- "$cli" tasks run');
    expect(source).not.toContain("secrets: inherit");
  },
);

it("Apply still takes a reviewed Plan artifact ID and applies only its fresh saved plan", () => {
  const source = workflow("apply");
  expect(source.match(/^ {6}plan_artifact_id:/gm)).toHaveLength(2);
  expect(source).toContain("required: true");
  expect(source).toMatch(
    /PLAN_ARTIFACT_ID:\s+\$\{\{\s*inputs\.plan_artifact_id\s*\}\}/,
  );
  expect(source).toContain("tasks run --show-output apply:infrastructure");
});

it.each(["test", "plan", "apply"])(
  "%s preserves public caches and private authentication after Cachix configures its user cache",
  (name) => {
    const settings = workflow(name)
      .match(/ {2}NIX_CONFIG: \|\n((?: {4}.+\n)+)/)?.[1]
      .replace(/^ {4}/gm, "");
    expect(settings).toBeTruthy();
    const publicSettings = workflow("check")
      .split("\n")
      .filter((line) => /extra-(substituters|trusted-public-keys) =/.test(line))
      .map((line) => line.trim())
      .join("\n");
    const privateKey = `private.example-1:${"A".repeat(43)}=`;
    const root = mkdtempSync(join(tmpdir(), "workflow-caches-"));
    try {
      mkdirSync(join(root, "system"));
      writeFileSync(
        join(root, "system/nix.conf"),
        `${publicSettings}\nrequire-sigs = true\n`,
      );
      writeFileSync(
        join(root, "user.conf"),
        [
          "substituters = https://cache.nixos.org https://private.example",
          `trusted-public-keys = ${privateKey}`,
          `netrc-file = ${root}/netrc`,
        ].join("\n"),
      );
      const result = spawnSync(
        "nix",
        [
          "config",
          "show",
          "--json",
          "--extra-experimental-features",
          "nix-command",
        ],
        {
          encoding: "utf8",
          timeout: 15_000,
          env: {
            ...process.env,
            NIX_CONF_DIR: join(root, "system"),
            NIX_USER_CONF_FILES: join(root, "user.conf"),
            NIX_CONFIG: settings,
          },
        },
      );
      expect(result.status, result.stderr).toBe(0);
      const config = JSON.parse(result.stdout);
      const urls = publicSettings
        .match(/extra-substituters = (.+)/)?.[1]
        .split(" ");
      const keys = publicSettings
        .match(/extra-trusted-public-keys = (.+)/)?.[1]
        .split(" ");
      expect(config.substituters.value).toEqual(
        expect.arrayContaining([
          "https://cache.nixos.org",
          "https://private.example",
          ...(urls ?? []),
        ]),
      );
      expect(config["trusted-public-keys"].value).toEqual(
        expect.arrayContaining([privateKey, ...(keys ?? [])]),
      );
      expect(config["netrc-file"].value).toBe(`${root}/netrc`);
      expect(config["require-sigs"].value).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

it("Test cannot publish caches from a non-manual or non-main invocation", () => {
  const source = workflow("test");
  expect(source).toContain(
    "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'",
  );
  expect(source).toContain("CACHIX_AUTH_TOKEN:");
  expect(source).toContain('"$cli" shell -- "$cli" tasks run');
});
