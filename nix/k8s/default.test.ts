import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("validates selected Kubernetes manifests using only local schemas and ignores host kubectl plugins", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-k8s-"));
  const repo = join(work, "repo");
  try {
    mkdirSync(join(repo, "k8s"), { recursive: true });
    mkdirSync(join(repo, "schemas"));
    const manifest = join(repo, "k8s/config with spaces.yaml");
    const valid =
      "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: fixture\ndata:\n  message: hello\n";
    writeFileSync(manifest, valid);
    writeFileSync(
      join(repo, "unrelated.yaml"),
      "this: is not a Kubernetes manifest\n",
    );
    writeFileSync(
      join(repo, "schemas/configmap-v1.json"),
      JSON.stringify({
        type: "object",
        required: ["apiVersion", "kind", "metadata", "data"],
        additionalProperties: false,
        properties: {
          apiVersion: { enum: ["v1"] },
          kind: { enum: ["ConfigMap"] },
          metadata: {
            type: "object",
            required: ["name"],
            properties: { name: { type: "string" } },
          },
          data: { type: "object", additionalProperties: { type: "string" } },
        },
      }),
    );
    const outside = join(work, "outside.yaml");
    writeFileSync(outside, "not a Kubernetes manifest\n");
    symlinkSync(outside, join(repo, "k8s/linked.yaml"));
    const config = join(repo, ".pre-commit-config.yaml");
    copyFileSync(
      new URL("../../etc/git/.pre-commit-config.yaml", import.meta.url),
      config,
    );
    writeFileSync(
      config,
      readFileSync(config, "utf8").replace(
        "        entry: check-k8s\n        language: system\n        stages: [manual]",
        "        entry: check-k8s\n        language: system\n        stages: [pre-push]",
      ),
    );
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      KUBECONFIG: "/dev/null",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    };
    const run = (command: string, args: string[] = [], extraEnv = {}) => {
      const result = spawnSync(command, args, {
        cwd: repo,
        env: { ...env, ...extraEnv },
        encoding: "utf8",
        timeout: 75_000,
      });
      if (result.error) throw result.error;
      return { status: result.status, output: result.stdout + result.stderr };
    };
    expect(
      run("git", ["init", "--quiet", "--initial-branch=main"]).status,
    ).toBe(0);
    expect(run("git", ["add", "."]).status).toBe(0);
    const build = (expr: string) => {
      const full = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
        pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
        k8s = (pkgs.lib.evalModules {
          modules = [ f.nixModules.k8s ]; specialArgs = { inherit pkgs; };
        }).config.quantile.k8s;
      in ${expr}`;
      const result = spawnSync(
        "nix",
        [
          "--extra-experimental-features",
          "nix-command flakes",
          "build",
          "--no-link",
          "--print-out-paths",
          "--impure",
          "--expr",
          full,
        ],
        { encoding: "utf8", timeout: 120_000 },
      );
      if (result.error) throw result.error;
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim().split("\n")[0];
    };
    const checker = join(build("k8s.check.package"), "bin");
    const prek = join(build("pkgs.prek"), "bin/prek");
    const check = () =>
      run(
        prek,
        [
          "--config",
          ".pre-commit-config.yaml",
          "run",
          "quantile-kubeconform",
          "--all-files",
          "--stage",
          "pre-push",
        ],
        {
          PATH: `${checker}:${env.PATH}`,
        },
      );
    const missing = check();
    expect(missing.status).not.toBe(0);
    expect(missing.output).toContain(
      "requires explicit local schema locations",
    );
    writeFileSync(
      config,
      readFileSync(config, "utf8").replace(
        "        # args: [-schema-location, LOCAL_SCHEMA_TEMPLATE].",
        "        args: [-schema-location, 'schemas/{{.ResourceKind}}{{.KindSuffix}}.json']\n        # args: [-schema-location, LOCAL_SCHEMA_TEMPLATE].",
      ),
    );
    expect(check().status).toBe(0);
    for (const [text, diagnostic] of [
      [valid.replace("message: hello", "message: 42"), "Invalid: 1"],
      [`${valid}unknownField: true\n`, "Invalid: 1"],
      [valid.replace("ConfigMap", "UnknownResource"), "could not find schema"],
    ]) {
      writeFileSync(manifest, text);
      const rejected = check();
      expect(rejected.status).not.toBe(0);
      expect(rejected.output).toContain(diagnostic);
      expect(readFileSync(manifest, "utf8")).toBe(text);
    }
    writeFileSync(manifest, valid);
    const jsonManifest = join(repo, "k8s/config.json");
    writeFileSync(
      jsonManifest,
      '{"apiVersion":"v1","kind":"ConfigMap","metadata":{"name":"fixture"},"data":{"message":42}}',
    );
    expect(run("git", ["add", "k8s/config.json"]).status).toBe(0);
    const badJson = check();
    expect(badJson.status).not.toBe(0);
    expect(badJson.output).toContain("Invalid: 1");
    rmSync(jsonManifest);
    expect(run("git", ["rm", "--cached", "k8s/config.json"]).status).toBe(0);
    expect(check().status).toBe(0);
    const remote = run(join(checker, "check-k8s"), [
      "-schema-location",
      "https://schemas.example.invalid",
      "k8s/config with spaces.yaml",
    ]);
    expect(remote.status).not.toBe(0);
    expect(remote.output).toContain("requires explicit local schema locations");
    const skip = run(join(checker, "check-k8s"), [
      "-ignore-missing-schemas",
      "k8s/config with spaces.yaml",
    ]);
    expect(skip.status).not.toBe(0);
    expect(skip.output).toContain("Unsupported kubeconform option");
    expect(existsSync(join(repo, ".git/hooks/pre-push"))).toBe(false);

    const pluginDir = join(work, "home/.krew/bin");
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, "kubectl-fixture-probe"),
      '#!/bin/sh\nprintf "unexpected-host-plugin\\n"\n',
      { mode: 0o700 },
    );
    const kubectl = join(build("k8s.kubectl.safePackage"), "bin/kubectl");
    expect(run(kubectl, ["version", "--client"]).status).toBe(0);
    const plugin = run(kubectl, ["fixture-probe"], {
      PATH: `${pluginDir}:${env.PATH}`,
    });
    expect(plugin.status).not.toBe(0);
    expect(plugin.output).toContain("unknown command");
    expect(plugin.output).not.toContain("unexpected-host-plugin");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 240_000);
