import { spawnSync } from "node:child_process";
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const tfDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleDir = join(tfDir, "project");

type Finding = { ID: string; CauseMetadata?: { Resource?: string } };

function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; check?: boolean } = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd, env: options.env, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (options.check !== false && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function temporary<T>(prefix: string, body: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), prefix));
  try { return body(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function copySources(from: string, to: string) {
  mkdirSync(to, { recursive: true });
  const names = from === tfDir
    ? ["backend.tf", "main.tf", "outputs.tf", "providers.tf", "variables.tf", "versions.tf"]
    : ["main.tf", "outputs.tf", "variables.tf", "versions.tf"];
  for (const name of names) copyFileSync(join(from, name), join(to, name));
}

function parse(source: string): Record<string, unknown> {
  return JSON.parse(run("conftest", ["parse", source]).stdout) as Record<string, unknown>;
}

function policyCheck(policyDir: string, namespace: string, document: unknown, valid: boolean) {
  temporary("terraform-policy-", (work) => {
    const source = join(work, "candidate.json");
    writeFileSync(source, JSON.stringify(document));
    const result = run("conftest", [
      "test", "--no-color", "--policy", policyDir, "--namespace", namespace, source,
    ], { check: false });
    if (valid) expect(result.status, result.stdout + result.stderr).toBe(0);
    else {
      expect(result.status, result.stdout + result.stderr).not.toBe(0);
      expect(result.stdout).toContain("must");
    }
  });
}

function mutate(original: Record<string, unknown>, path: string, value: unknown) {
  const document = structuredClone(original);
  const keys = path.split("/");
  let target: unknown = document;
  for (const key of keys.slice(0, -1)) {
    if (Array.isArray(target)) target = target[Number(key)];
    else {
      const object = target as Record<string, unknown>;
      target = object[key] ?? (object[key] = {});
    }
  }
  const last = keys.at(-1)!;
  if (Array.isArray(target)) target[Number(last)] = value;
  else (target as Record<string, unknown>)[last] = value;
  return document;
}

function isolatedEnvironment(dataDir: string, cacheDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, TF_DATA_DIR: dataDir, TF_PLUGIN_CACHE_DIR: cacheDir, TF_IN_AUTOMATION: "1" };
  delete env.TF_WORKSPACE;
  for (const key of Object.keys(env)) {
    if (key.startsWith("TF_CLI_ARGS") || key.startsWith("TF_LOG")) delete env[key];
  }
  return env;
}

function findings(root: string): Finding[] {
  const output = run("trivy", [
    "repo", "--scanners", "misconfig", "--severity", "HIGH,CRITICAL", "--exit-code", "0",
    "--offline-scan", "--skip-db-update", "--skip-java-db-update", "--skip-check-update",
    "--disable-telemetry", "--skip-version-check", "--format", "json", root,
  ]).stdout;
  const report = JSON.parse(output) as { Results?: Array<{ Misconfigurations?: Finding[] }> };
  return report.Results?.flatMap((item) => item.Misconfigurations ?? []) ?? [];
}

describe("Terraform project module", () => {
  it("validates independent consumers without reading production backend metadata", () => temporary(
    "terraform-consumer-", (work) => {
      const library = join(work, "library", "project");
      copySources(moduleDir, library);
      const cache = join(work, "providers");
      mkdirSync(cache);
      const argumentsText = `
  gh_repository_name  = "fixture"
  gh_visibility       = "private"
  gcp_project_prefix  = "fixture"
  gcp_folder_id       = "123456789"
  gcp_billing_account = "AAAAAA-BBBBBB-CCCCCC"
  gcp_wif_pool        = "projects/123456789/locations/global/workloadIdentityPools/fixture"
  gh_maintainers      = ["fixture-operator"]
`;
      for (const [name, overrides] of Object.entries({
        defaults: "",
        overrides: '  gh_required_checks = ["Caller / All"]\n  gh_environments = ["preview", "prod"]\n',
      })) {
        const root = join(work, name);
        mkdirSync(root);
        const source = join(root, "main.tf");
        const original = `module "subject" {\n  source = "../library/project"\n${argumentsText}${overrides}}\n`;
        writeFileSync(source, original);
        copyFileSync(join(tfDir, ".terraform.lock.hcl"), join(root, ".terraform.lock.hcl"));
        const production = join(root, ".terraform");
        mkdirSync(production);
        const sentinel = join(production, "terraform.tfstate");
        writeFileSync(sentinel, "UNEXPECTED_PRODUCTION_BACKEND");
        const env = isolatedEnvironment(join(work, `validation-${name}`), cache);
        run("tofu", [`-chdir=${root}`, "init", "-backend=false", "-input=false", "-lockfile=readonly"], { env });
        run("tofu", [`-chdir=${root}`, "validate", "-no-color"], { env });
        expect(readFileSync(sentinel, "utf8")).toBe("UNEXPECTED_PRODUCTION_BACKEND");
        expect(existsSync(join(root, "terraform.tfstate"))).toBe(false);

        if (name === "defaults") {
          writeFileSync(source, original.replace('  gh_maintainers      = ["fixture-operator"]\n', ""));
          const result = run("tofu", [`-chdir=${root}`, "validate", "-no-color"], { env, check: false });
          expect(result.status).not.toBe(0);
          expect(result.stdout + result.stderr).toContain("Missing required argument");
          writeFileSync(source, original);
        }
      }
    },
  ), 120_000);

  it("keeps provider and backend configuration outside the reusable module", () => {
    for (const name of readdirSync(moduleDir).filter((file) => file.endsWith(".tf"))) {
      const document = parse(join(moduleDir, name));
      expect(document).not.toHaveProperty("provider");
      if (name !== "main.tf") {
        expect(document).not.toHaveProperty("resource");
        expect(document).not.toHaveProperty("data");
      }
      for (const block of (document.terraform ?? []) as Array<Record<string, unknown>>) {
        expect(block).not.toHaveProperty("backend");
      }
    }
    const variables = parse(join(moduleDir, "variables.tf")).variable as Record<string, Array<Record<string, unknown>>>;
    for (const name of ["gcp_wif_pool", "gh_maintainers", "gh_visibility", "gh_repository_name"]) {
      expect(variables[name]?.[0]).not.toHaveProperty("default");
    }
    expect(parse(join(tfDir, "backend.tf"))).toEqual({ terraform: [{ backend: { gcs: [{}] } }] });
  });

  it("rejects mutations to the real root and module policy subjects", () => {
    const cases: Array<[string, string, Record<string, unknown>]> = [
      [tfDir, "terraform.repository", {
        "module/project/0/source": "../outside",
        "module/project/0/gh_repository_name": "another-repo",
        "module/project/0/gcp_project_prefix": "another-project",
        "module/project/0/gh_maintainers": ["implicit-actor"],
        "module/project/0/gh_visibility": "private",
      }],
      [moduleDir, "terraform.project", {
        "resource/github_branch_protection/main/0/enforce_admins": false,
        "resource/github_branch_protection/main/0/require_signed_commits": false,
        "resource/github_branch_protection/main/0/required_status_checks/0/strict": false,
        "resource/github_repository/self/0/lifecycle/0/prevent_destroy": false,
        "resource/github_actions_repository_permissions/self/0/sha_pinning_required": false,
        "resource/restapi_object/fork_workflow_approval/0/destroy_method": "DELETE",
        "resource/github_repository_environment_deployment_policy/main/0/branch_pattern": "*",
        "resource/google_project/state/0/deletion_policy": "DELETE",
        "resource/google_storage_bucket/state/0/public_access_prevention": "inherited",
        "resource/google_storage_bucket/state/0/versioning/0/enabled": false,
        "resource/google_project_iam_member/pipeline_owner/0/role": "roles/viewer",
        "resource/google_project_iam_member/pipeline_owner/0/member": "allUsers",
        "resource/github_repository_ruleset/member_landing": [{}],
      }],
    ];
    for (const [directory, namespace, mutations] of cases) {
      const original = parse(join(directory, "main.tf"));
      policyCheck(directory, namespace, original, true);
      for (const [path, value] of Object.entries(mutations)) {
        policyCheck(directory, namespace, mutate(original, path, value), false);
      }
    }
  }, 120_000);

  it("scopes the public-repository scanner exception to its module invocation", () => temporary(
    "terraform-scanner-", (root) => {
      copySources(tfDir, root);
      const project = join(root, "project");
      copySources(moduleDir, project);
      const source = join(root, "main.tf");
      const original = readFileSync(source, "utf8");
      const exception = "# trivy:ignore:AVD-GIT-0001\n";
      expect(original).toContain(exception);
      expect(findings(root)).toEqual([]);
      writeFileSync(source, original.replace(exception, ""));
      expect(findings(root).map((item) => item.ID)).toContain("GIT-0001");
      writeFileSync(source, original + "\n" + original.replace('module "project"', 'module "other"').replace(exception, ""));
      expect(findings(root).map((item) => [item.ID, item.CauseMetadata?.Resource])).toContainEqual([
        "GIT-0001", "module.other",
      ]);
      writeFileSync(source, original);
      const moduleSource = join(project, "main.tf");
      writeFileSync(moduleSource, readFileSync(moduleSource, "utf8") + `
resource "google_storage_bucket" "public" {
  name = "fixture-public"
  location = "US"
}
resource "google_storage_bucket_iam_member" "public" {
  bucket = google_storage_bucket.public.name
  role = "roles/storage.objectViewer"
  member = "allUsers"
}
`);
      expect(findings(root).map((item) => item.ID)).toContain("GCP-0001");
    },
  ), 120_000);
});
