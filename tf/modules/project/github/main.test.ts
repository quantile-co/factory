import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "vitest";

it("works as an independent GitHub module with caller-owned settings", () => {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const work = mkdtempSync(join(tmpdir(), "github-consumer-"));
  try {
    writeFileSync(
      join(work, "main.tf"),
      `
module "repository" {
  source = ${JSON.stringify(moduleDir)}
  repository_name = "fixture"
  visibility = "private"
  maintainers = ["fixture-operator"]
  required_checks = ["Caller / All"]
  environments = ["preview", "prod"]
}
`,
    );
    // Init may prune unrelated providers from this temporary copy of the root lockfile.
    copyFileSync(
      resolve(moduleDir, "../../../infrastructure/.terraform.lock.hcl"),
      join(work, ".terraform.lock.hcl"),
    );
    mkdirSync(join(work, "tests"));
    writeFileSync(
      join(work, "tests/visibility.tftest.hcl"),
      `
mock_provider "github" {}
mock_provider "restapi" {}

${["private", "public"]
  .map(
    (visibility) => `
run "${visibility}_fork_approval" {
  command = plan
  module {
    source = ${JSON.stringify(moduleDir)}
  }
  variables {
    repository_name = "fixture"
    visibility = "${visibility}"
    maintainers = ["fixture-operator"]
    required_checks = ["Caller / All"]
    environments = ["preview", "prod"]
  }
  assert {
    condition = length(restapi_object.fork_workflow_approval) == ${visibility === "public" ? 1 : 0}
    error_message = "Fork approval must exist only for public repositories."
  }
  assert {
    condition = (
      github_actions_repository_permissions.self.sha_pinning_required &&
      github_actions_repository_permissions.self.allowed_actions == "selected" &&
      github_actions_repository_permissions.self.allowed_actions_config[0].github_owned_allowed &&
      github_actions_repository_permissions.self.allowed_actions_config[0].verified_allowed &&
      contains(github_actions_repository_permissions.self.allowed_actions_config[0].patterns_allowed,
        "quantile-co/factory/.github/workflows/*@*")
    )
    error_message = "Default selected actions must retain pinned Factory workflows."
  }
}
`,
  )
  .join("\n")}
run "caller_action_patterns" {
  command = plan
  module {
    source = ${JSON.stringify(moduleDir)}
  }
  variables {
    repository_name = "fixture"
    visibility = "private"
    maintainers = ["fixture-operator"]
    allowed_action_patterns = ["cachix/install-nix-action@448cde739abec1eaf0646249e3d25bb8d9bc7702"]
  }
  assert {
    condition = (
      github_actions_repository_permissions.self.allowed_actions == "selected" &&
      github_actions_repository_permissions.self.sha_pinning_required &&
      length(github_actions_repository_permissions.self.allowed_actions_config[0].patterns_allowed) == 1 &&
      contains(github_actions_repository_permissions.self.allowed_actions_config[0].patterns_allowed,
        "cachix/install-nix-action@448cde739abec1eaf0646249e3d25bb8d9bc7702")
    )
    error_message = "Caller-selected patterns must replace the defaults without disabling SHA pinning."
  }
}
`,
    );
    mkdirSync(join(work, "providers"));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TF_DATA_DIR: join(work, "data"),
      TF_PLUGIN_CACHE_DIR: join(work, "providers"),
    };
    for (const key of Object.keys(env)) {
      if (
        key === "TF_WORKSPACE" ||
        key.startsWith("TF_CLI_ARGS") ||
        key.startsWith("TF_LOG")
      )
        delete env[key];
    }
    execFileSync(
      "tofu",
      [`-chdir=${work}`, "init", "-backend=false", "-input=false"],
      { env, timeout: 120_000, stdio: "pipe" },
    );
    execFileSync("tofu", [`-chdir=${work}`, "validate", "-no-color"], {
      env,
      timeout: 120_000,
      stdio: "pipe",
    });
    execFileSync("tofu", [`-chdir=${work}`, "test", "-no-color"], {
      env,
      timeout: 120_000,
      stdio: "pipe",
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 120_000);
