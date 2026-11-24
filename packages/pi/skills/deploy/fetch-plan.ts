import { execFileSync } from "node:child_process";
import { lstat, open, realpath, unlink } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

interface PlanAttempt {
  repository: { full_name: string; id: number };
  head_repository: { id: number };
  id: number;
  run_attempt: number;
  path: string;
  event: string;
  head_branch: string;
  head_sha: string;
  status: string;
  conclusion: string;
}

interface PlanJob {
  name: string;
  head_sha: string;
  run_id: number;
  run_attempt: number;
  status: string;
  conclusion: string;
  steps: {
    name: string;
    status: string;
    conclusion: string;
    started_at: string;
    completed_at: string;
  }[];
}

class ReviewError extends Error {}
function requireMatch(value: boolean, reason: string): asserts value {
  if (!value) throw new ReviewError(reason);
}

function command(program: string, args: string[]) {
  try {
    return execFileSync(program, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    throw new ReviewError(
      `${program} lookup failed; check identity and access`,
    );
  }
}

// The repository's reviewed workflow/task mapping supplies the bucket and layer.
// Only GitHub attempt metadata and the single create-only GCS key are needed.
export async function fetchPlan(
  args: string[],
  run = command,
  request: (url: string, init: RequestInit) => Promise<Response> = fetch,
) {
  const [repo, sha, layer, id, attempt, bucket, dir, summary] = args;
  const decimal = /^[1-9][0-9]*$/;
  requireMatch(
    (args.length === 7 || args.length === 8) &&
      /^[\w.-]+\/[\w.-]+$/.test(repo) &&
      /^[0-9a-f]{40}$/.test(sha) &&
      ["infrastructure", "application"].includes(layer) &&
      decimal.test(id) &&
      decimal.test(attempt) &&
      /^[a-z0-9][a-z0-9._-]+[a-z0-9]$/.test(bucket),
    "Expected REPO SHA LAYER RUN ATTEMPT BUCKET PRIVATE_DIR [SUMMARY_REF]",
  );
  const scratch = await lstat(dir);
  requireMatch(
    /^\/tmp\/factory-review\.[a-zA-Z0-9]+$/.test(dir) &&
      scratch.isDirectory() &&
      scratch.uid === process.getuid?.() &&
      (scratch.mode & 0o777) === 0o700,
    "Use a new private /tmp/factory-review directory",
  );
  const endpoint = `repos/${repo}/actions/runs/${id}/attempts/${attempt}`;
  const api = <T>(path: string) =>
    JSON.parse(run("gh", ["api", "--hostname", "github.com", path])) as T;
  const producer = api<PlanAttempt>(endpoint);
  requireMatch(
    producer.repository?.full_name === repo &&
      Number.isSafeInteger(producer.repository.id) &&
      producer.repository.id > 0 &&
      producer.head_repository?.id === producer.repository.id &&
      String(producer.id) === id &&
      String(producer.run_attempt) === attempt &&
      producer.path === ".github/workflows/plan.yaml" &&
      producer.event === "workflow_dispatch" &&
      producer.head_branch === "main" &&
      producer.head_sha === sha &&
      producer.status === "completed" &&
      producer.conclusion === "success",
    "Not the approved successful Plan attempt",
  );
  const { jobs, total_count }: { jobs: PlanJob[]; total_count: number } = api(
    `${endpoint}/jobs?per_page=100`,
  );
  const active = jobs.filter((job) => job.conclusion !== "skipped");
  const [job] = active;
  requireMatch(
    jobs.length === total_count &&
      active.length === 1 &&
      job.name.split(" / ").at(-1) ===
        (layer === "infrastructure" ? "Infrastructure" : "Application") &&
      String(job.run_id) === id &&
      String(job.run_attempt) === attempt &&
      job.head_sha === sha &&
      job.status === "completed" &&
      job.conclusion === "success",
    "Missing, failed or ambiguous producing layer job",
  );
  const steps = job.steps.filter((step) => step.name === "Plan");
  requireMatch(
    steps.length === 1 &&
      steps[0].status === "completed" &&
      steps[0].conclusion === "success",
    "Missing successful Plan step",
  );

  const key = `plans/${producer.repository.id}/${id}/${attempt}/saved-plan/plan.tfplan`;
  const url = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(key)}`;
  const token = run("gcloud", ["auth", "print-access-token", "--quiet"]);
  async function get(query: string, missing: string) {
    const response = await request(`${url}?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    });
    if (response.status === 404) throw new ReviewError(missing);
    if ([401, 403].includes(response.status))
      throw new ReviewError("Plan reader access denied");
    requireMatch(
      response.status === 200,
      `Object read failed (HTTP ${response.status})`,
    );
    return response;
  }
  const metadata = async () =>
    (
      await get(
        "fields=bucket,name,generation,size,timeCreated",
        "No saved object at the verified key",
      )
    ).json();
  const object = await metadata();
  const created = Date.parse(object.timeCreated);
  // Actions step timestamps have second precision, GCS creation has fractions.
  requireMatch(
    object.bucket === bucket &&
      object.name === key &&
      typeof object.generation === "string" &&
      decimal.test(object.generation) &&
      decimal.test(object.size) &&
      created >= Date.parse(steps[0].started_at) &&
      created < Date.parse(steps[0].completed_at) + 1000,
    "Object identity, generation or creation outside verified Plan step",
  );
  const reference = `${id}/${attempt}/${object.generation}`;
  requireMatch(
    summary === undefined || summary === reference,
    "Plan Summary reference disagrees",
  );
  const media = await get(
    `generation=${object.generation}&alt=media`,
    "Verified generation no longer available",
  );
  requireMatch(
    media.body !== null &&
      media.headers.get("x-goog-generation") === object.generation,
    "Download generation differs from verified metadata",
  );
  const path = join(dir, "plan.tfplan");
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(media.body);
    requireMatch(
      String((await file.stat()).size) === object.size,
      "Incomplete plan download",
    );
    requireMatch(
      (await metadata()).generation === object.generation,
      "Object generation changed during review",
    );
  } catch (error) {
    await unlink(path);
    throw error;
  } finally {
    await file.close();
  }
  return reference;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(await realpath(process.argv[1])).href
) {
  try {
    console.log(await fetchPlan(process.argv.slice(2)));
  } catch (error) {
    // Never echo a child command, API body, plan bytes or credential.
    console.error(
      error instanceof ReviewError
        ? error.message
        : "Private plan lookup failed",
    );
    process.exitCode = 1;
  }
}
