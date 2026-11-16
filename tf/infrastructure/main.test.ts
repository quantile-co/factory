import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
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

it("opts Factory into central enrollment without changing its deployment identity", () => {
  const source = readFileSync(new URL("./main.tf", import.meta.url), "utf8");
  const gcp = source.match(/module "gcp" \{([\s\S]*?)^\}/m)?.[1];
  expect(gcp).toBeDefined();
  expect(gcp?.match(/source\s*=\s*"([^"]+)"/)?.[1]).toBe(
    "../modules/project/gcp",
  );
  expect(gcp?.match(/metrics_enrollment_member\s*=\s*"([^"]+)"/)?.[1]).toBe(
    "principalSet://iam.googleapis.com/projects/86084514682/locations/global/workloadIdentityPools/github/attribute.main_branch_repository_actor_id/1458437080_218666448",
  );
  expect(gcp).toMatch(/gh_repo_id\s*=\s*module\.gh\.repo_id/);
  expect(gcp).toMatch(/gh_owner_ids\s*=\s*module\.gh\.owner_ids/);
  expect(source).not.toMatch(
    /resource\s+"google_monitoring_monitored_project"/,
  );
});

it("scopes the public-repository scanner exception to its module invocation", () => {
  const sourceDir = dirname(fileURLToPath(import.meta.url));
  const work = mkdtempSync(join(tmpdir(), "infrastructure-scanner-"));
  try {
    for (const relative of [
      "infrastructure",
      "modules/project/github",
      "modules/project/gcp",
      "modules/project/hindsight",
    ]) {
      const from = resolve(sourceDir, "..", relative);
      const to = join(work, relative);
      mkdirSync(to, { recursive: true });
      for (const file of [
        "backend.tf",
        "main.tf",
        "outputs.tf",
        "providers.tf",
        "variables.tf",
        "versions.tf",
      ]) {
        if (existsSync(join(from, file)))
          copyFileSync(join(from, file), join(to, file));
      }
    }
    const scan = () => {
      const report = JSON.parse(
        execFileSync(
          "trivy",
          [
            "repo",
            "--scanners",
            "misconfig",
            "--severity",
            "HIGH,CRITICAL",
            "--exit-code",
            "0",
            "--offline-scan",
            "--skip-db-update",
            "--skip-java-db-update",
            "--skip-check-update",
            "--disable-telemetry",
            "--skip-version-check",
            "--format",
            "json",
            work,
          ],
          { encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
        ),
      ) as {
        Results?: Array<{
          Misconfigurations?: Array<{
            ID: string;
            CauseMetadata?: { Resource?: string };
          }>;
        }>;
      };
      return (
        report.Results?.flatMap((item) => item.Misconfigurations ?? []) ?? []
      );
    };
    const source = join(work, "infrastructure", "main.tf");
    const original = readFileSync(source, "utf8");
    const exception = "# trivy:ignore:AVD-GIT-0001\n";
    expect(scan()).toEqual([]);
    writeFileSync(source, original.replace(exception, ""));
    expect(scan().map((item) => item.ID)).toContain("GIT-0001");
    const githubCall = original.slice(
      original.indexOf(exception),
      original.indexOf('\nmodule "gcp"'),
    );
    writeFileSync(
      source,
      `${original}\n${githubCall.replace('module "gh"', 'module "other"').replace(exception, "")}`,
    );
    expect(
      scan().map((item) => [item.ID, item.CauseMetadata?.Resource]),
    ).toContainEqual(["GIT-0001", "module.other"]);
    writeFileSync(source, original);
    const gcpSource = join(work, "modules", "project", "gcp", "main.tf");
    writeFileSync(
      gcpSource,
      `${readFileSync(gcpSource, "utf8")}
resource "google_storage_bucket" "public" {
  name = "fixture-public"
  location = "US"
}
resource "google_storage_bucket_iam_member" "public" {
  bucket = google_storage_bucket.public.name
  role = "roles/storage.objectViewer"
  member = "allUsers"
}
`,
    );
    expect(scan().map((item) => item.ID)).toContain("GCP-0001");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 120_000);
