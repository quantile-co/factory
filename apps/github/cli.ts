#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Action,
  apply,
  CommandFailure,
  plan,
  processRunner,
  type TransportOptions,
} from "@quantile-co/factory-github";
import { Command, Option } from "commander";

const deployments = {
  infrastructure: {
    directory: "tf/infrastructure",
    backendPrefix: "factory/prod/infrastructure",
  },
};

interface Options {
  gcpTfStateBucket: string;
  gcpWifPool?: string;
  ghRepoToken?: string;
  ghPlanRef?: string;
  tfLayer: keyof typeof deployments;
}
function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
// Do not inherit ambient TF_VAR_* or backend configuration. Credentials stay out of Nix.
const environment: NodeJS.ProcessEnv = {};
for (const name of [
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SYSTEMROOT",
  "USERPROFILE",
  "SSL_CERT_FILE",
  "NIX_SSL_CERT_FILE",
  "CLOUDSDK_CONFIG",
  "CLOUDSDK_CORE_PROJECT",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE",
  "GOOGLE_GHA_CREDS_PATH",
  "CLOUDSDK_AUTH_ACCESS_TOKEN",
]) {
  if (process.env[name] !== undefined) environment[name] = process.env[name];
}
const abort = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => abort.abort());
const program = new Command()
  .name("factory-github")
  .description(
    "Repository artifacts and saved-plan transport; use approved workflows.",
  );
program
  .command("build")
  .addOption(
    new Option("--tf-layer <layer>", "Repository artifact layer")
      .choices(["application"])
      .makeOptionMandatory(),
  )
  .addOption(
    new Option("--npm-token <token>", "Stage-only credential; prefer NPM_TOKEN")
      .env("NPM_TOKEN")
      .makeOptionMandatory(),
  )
  .action((options: { npmToken: string }) => {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    }).trim();
    const buildEnvironment = { ...process.env };
    delete buildEnvironment.NPM_TOKEN;
    delete buildEnvironment.NPM_CONFIG_USERCONFIG;
    delete buildEnvironment.npm_config_userconfig;
    const run = (task: string, env: NodeJS.ProcessEnv) => {
      const result = spawnSync("pnpm", ["run", task], {
        cwd: root,
        env,
        stdio: "inherit",
      });
      if (result.error) throw result.error;
      if (result.status !== 0)
        throw new CommandFailure(result.status ?? 1, `${task} failed`);
    };
    run("npm:pack", buildEnvironment);
    execFileSync("git", ["diff", "--exit-code", "HEAD"], {
      cwd: root,
      env: buildEnvironment,
      stdio: "inherit",
    });
    const directory = mkdtempSync(join(tmpdir(), "factory-npm-"));
    try {
      const config = join(directory, "npmrc");
      writeFileSync(
        config,
        `//registry.npmjs.org/:_authToken=\${NPM_TOKEN}\n`,
        {
          mode: 0o600,
        },
      );
      run("npm:stage", {
        ...buildEnvironment,
        NPM_TOKEN: options.npmToken,
        NPM_CONFIG_USERCONFIG: config,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
for (const phase of ["plan", "apply"] as const) {
  const command = program
    .command(phase)
    .argument(
      "[command...]",
      "Optional caller command; {plan} arguments receive the exact saved-plan path",
    )
    .addOption(
      new Option(
        "--gcp-tf-state-bucket <name>",
        "State and saved-plan bucket",
      ).makeOptionMandatory(),
    )
    .addOption(
      new Option("--gcp-wif-pool <name>", "Trusted workload identity pool"),
    )
    .addOption(
      new Option(
        "--gh-repo-token <token>",
        "Repository credential; prefer GH_REPO_TOKEN",
      ).env("GH_REPO_TOKEN"),
    )
    .addOption(
      new Option("--tf-layer <layer>", "Repository deployment layer")
        .choices(Object.keys(deployments))
        .makeOptionMandatory(),
    );
  if (phase === "apply")
    command.addOption(
      new Option(
        "--gh-plan-ref <run/attempt/generation>",
        "Reviewed saved plan",
      ).makeOptionMandatory(),
    );
  command.action(async (custom: string[], options: Options) => {
    const deployment = deployments[options.tfLayer];
    const transport: TransportOptions = {
      bucket: options.gcpTfStateBucket,
      repositoryId: requiredEnvironment("GITHUB_REPOSITORY_ID"),
      runId: requiredEnvironment("GITHUB_RUN_ID"),
      attempt: requiredEnvironment("GITHUB_RUN_ATTEMPT"),
      scratchDirectory: requiredEnvironment("RUNNER_TEMP"),
      signal: abort.signal,
    };
    const vars: NodeJS.ProcessEnv = {
      ...environment,
      TF_IN_AUTOMATION: "true",
      TF_INPUT: "0",
      GH_REPO: requiredEnvironment("GITHUB_REPOSITORY"),
    };
    if (options.ghRepoToken !== undefined) {
      vars.GITHUB_TOKEN = options.ghRepoToken;
      vars.REST_API_BEARER = options.ghRepoToken;
    }
    if (options.gcpWifPool !== undefined)
      vars.TF_VAR_gcp_wif_pool = options.gcpWifPool;
    const provider = processRunner(vars);
    const action: Action = async ({ planFile, logFile, signal }) => {
      if (custom.length) {
        await provider(
          custom[0],
          custom.slice(1).map((value) => value.replaceAll("{plan}", planFile)),
          { logFile, append: true, signal },
        );
        return;
      }
      await provider(
        "tofu",
        [
          `-chdir=${deployment.directory}`,
          "init",
          "-input=false",
          "-lockfile=readonly",
          `-backend-config=bucket=${options.gcpTfStateBucket}`,
          `-backend-config=prefix=${deployment.backendPrefix}`,
        ],
        { logFile, append: true, signal },
      );
      await provider(
        "tofu",
        phase === "plan"
          ? [
              `-chdir=${deployment.directory}`,
              "plan",
              "-input=false",
              "-no-color",
              `-out=${planFile}`,
            ]
          : [
              `-chdir=${deployment.directory}`,
              "apply",
              "-input=false",
              planFile,
            ],
        { logFile, append: true, signal },
      );
      if (phase === "apply") {
        const objects = JSON.parse(
          await storage(
            "gcloud",
            [
              "storage",
              "ls",
              "--all-versions",
              "--json",
              `gs://${options.gcpTfStateBucket}/**`,
            ],
            { logFile, append: true, signal },
          ),
        ) as {
          url: string;
          metadata?: { name: string; generation: string; timeDeleted?: string };
        }[];
        for (const { url, metadata: object } of objects) {
          if (
            !object ||
            !(
              object.name.startsWith("state-backups/") ||
              ([
                "repository/prod/default.tfstate",
                "factory/prod/infrastructure/default.tfstate",
              ].includes(object.name) &&
                object.timeDeleted)
            )
          )
            continue;
          if (
            !/^[1-9][0-9]*$/.test(object.generation) ||
            url !==
              `gs://${options.gcpTfStateBucket}/${object.name}#${object.generation}`
          )
            throw new Error("Expected exact-generation cleanup object");
          await storage("gcloud", ["storage", "rm", url], {
            logFile,
            append: true,
            signal,
          });
        }
      }
    };
    const storage = processRunner(environment);
    if (phase === "plan") {
      await plan(
        {
          ...transport,
          summaryFile: requiredEnvironment("GITHUB_STEP_SUMMARY"),
        },
        action,
        storage,
      );
    } else {
      if (!options.ghPlanRef) throw new Error("Missing GH_PLAN_REF");
      await apply(
        { ...transport, planReference: options.ghPlanRef },
        action,
        storage,
      );
    }
  });
}
try {
  await program.parseAsync();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = error instanceof CommandFailure ? error.exitCode : 1;
}
