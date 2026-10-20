import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("supports multiple GCP projects sharing GitHub identities without a GitHub provider", () => {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const work = mkdtempSync(join(tmpdir(), "gcp-consumer-"));
  try {
    writeFileSync(
      join(work, "main.tf"),
      ["dev", "non_prod"]
        .map(
          (name) => `
module "${name}" {
  source = ${JSON.stringify(moduleDir)}
  project_prefix = "fixture-${name.replaceAll("_", "-")}"
  folder_id = "123456789"
  maintainers = ["operator@example.com"]
  billing_account = "AAAAAA-BBBBBB-CCCCCC"
  wif_pool = "projects/123456789/locations/global/workloadIdentityPools/fixture"
  repository_id = "123456789"
  repository_maintainer_ids = { fixture-operator = "987654321" }
}
`,
        )
        .join("\n"),
    );
    // Init may prune unrelated providers from this temporary copy of the root lockfile.
    copyFileSync(
      resolve(moduleDir, "../../../infrastructure/.terraform.lock.hcl"),
      join(work, ".terraform.lock.hcl"),
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
    const providers = execFileSync("tofu", [`-chdir=${work}`, "providers"], {
      env,
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(providers).not.toContain("integrations/github");
    expect(providers.toLowerCase()).not.toContain("mastercard/restapi");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 120_000);

it("rejects incomplete or exempted storage audit logging", () => {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const work = mkdtempSync(join(tmpdir(), "gcp-audit-policy-"));
  try {
    const source = readFileSync(join(moduleDir, "main.tf"), "utf8");
    const file = join(work, "main.tf");
    const check = (text: string) => {
      writeFileSync(file, text);
      const result = spawnSync(
        "conftest",
        [
          "test",
          "--policy",
          moduleDir,
          "--namespace",
          "terraform.project.gcp",
          file,
        ],
        { encoding: "utf8", timeout: 20_000 },
      );
      if (result.error) throw result.error;
      return { status: result.status, output: result.stdout + result.stderr };
    };
    const valid = check(source);
    expect(valid.status, valid.output).toBe(0);
    for (const replacement of [
      'log_type = "ADMIN_READ"',
      'log_type = "DATA_READ"\n    exempted_members = ["user:operator@example.com"]',
    ]) {
      const invalid = check(
        source.replace('log_type = "DATA_READ"', replacement),
      );
      expect(invalid.status, invalid.output).toBe(1);
      expect(invalid.output).toContain("Storage audit logs must cover");
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
