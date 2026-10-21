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

it("a standalone consumer can use the public module and its own native configuration", () => {
  const work = mkdtempSync(join(tmpdir(), "factory-consumer-"));
  const consumer = join(work, "consumer");
  const home = join(work, "home");
  // Git-aware input includes tracked edits, not ignored credentials or local state.
  const factory = `git+${new URL("../../", import.meta.url).href}`;
  try {
    mkdirSync(home);
    mkdirSync(join(consumer, ".github", "workflows"), { recursive: true });
    const env = {
      HOME: home,
      PATH: process.env.PATH,
      TMPDIR: work,
      SSL_CERT_FILE: process.env.SSL_CERT_FILE,
      NIX_SSL_CERT_FILE: process.env.NIX_SSL_CERT_FILE,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    };
    const run = (command: string, args: string[]) => {
      const result = spawnSync(command, args, {
        cwd: consumer,
        env,
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      if (result.error) throw result.error;
      expect(
        result.status,
        `${command}:\n${result.stdout}\n${result.stderr}`,
      ).toBe(0);
      return result.stdout.trim();
    };

    writeFileSync(
      join(consumer, "flake.nix"),
      `
{
  inputs.factory.url = ${JSON.stringify(factory)};
  outputs = { factory, ... }: {
    packages = builtins.mapAttrs (_: pkgs: {
      default = (pkgs.lib.evalModules {
        modules = [ factory.nixModules.default ];
        specialArgs = { inherit pkgs; };
      }).config.quantile.actionlint.check.package;
    }) factory.inputs.nixpkgs.legacyPackages;
  };
}
`,
    );
    writeFileSync(
      join(consumer, ".github", "actionlint.yaml"),
      `
self-hosted-runner:
  labels: [consumer-runner]
`,
    );
    writeFileSync(
      join(consumer, ".github", "workflows", "check.yaml"),
      `
name: Consumer
on: push
jobs:
  check:
    runs-on: consumer-runner
    steps:
      - run: echo consumer
`,
    );

    // Only this synthetic, credential-free consumer uses a path input.
    const output = run("nix", [
      "--extra-experimental-features",
      "nix-command flakes",
      "build",
      "path:.#default",
      "--no-link",
      "--print-out-paths",
    ]);
    run("git", ["init", "--quiet", "--initial-branch=main"]);
    const checker = join(output, "bin", "check-actionlint");
    run(checker, []);

    const workflow = join(consumer, ".github/workflows/check.yaml");
    const invalid = `name: Consumer\non: push\njobs:\n  check:\n    runs-on: consumer-runner\n    steps:\n      - run: echo $GITHUB_WORKSPACE\n`;
    writeFileSync(workflow, invalid);
    const rejected = spawnSync(checker, [], {
      cwd: consumer,
      env,
      encoding: "utf8",
      timeout: 120_000,
    });
    if (rejected.error) throw rejected.error;
    expect(rejected.status).not.toBe(0);
    expect(rejected.stdout + rejected.stderr).toContain("SC2086");
    expect(readFileSync(workflow, "utf8")).toBe(invalid);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);

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

it("Plan and Apply exchange only an exact GCS generation reference", () => {
  const source = workflow("apply");
  expect(source.match(/^ {6}plan_ref:/gm)).toHaveLength(2);
  expect(source).toContain("required: true");
  expect(source).toMatch(/PLAN_REF:\s+\$\{\{\s*inputs\.plan_ref\s*\}\}/);
  expect(source).toContain("tasks run --show-output apply:infrastructure");
  expect(source).toContain('gcloud storage cp "$source" "$TF_PLAN_FILE"');
  expect(source).toMatch(/plan\.tfplan#\$\{BASH_REMATCH\[3\]\}/);
  expect(workflow("plan")).toContain("gcloud storage cp --recursive");
  for (const name of ["plan", "apply"]) {
    const source = workflow(name);
    expect(source).toContain("--if-generation-match=0");
    expect(source).toContain("if: failure()");
    expect(source).not.toContain("actions/upload-artifact@");
  }
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
