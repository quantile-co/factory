import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { fetchPlan } from "../skills/deploy/fetch-plan.ts";

const sha = "a".repeat(40);
const endpoint = "repos/example/service/actions/runs/42/attempts/2";
const producer = {
  repository: { full_name: "example/service", id: 7 },
  head_repository: { id: 7 },
  id: 42,
  run_attempt: 2,
  head_sha: sha,
  path: ".github/workflows/plan.yaml",
  event: "workflow_dispatch",
  head_branch: "main",
  status: "completed",
  conclusion: "success",
};
const step = {
  name: "Plan",
  status: "completed",
  conclusion: "success",
  started_at: "2025-01-01T00:01:00Z",
  completed_at: "2025-01-01T00:01:30Z",
};
const job = {
  name: "Infrastructure",
  run_id: 42,
  run_attempt: 2,
  head_sha: sha,
  steps: [step],
  status: "completed",
  conclusion: "success",
};
const bytes = "local synthetic fixture";
const object = {
  bucket: "fixture-bucket",
  name: "plans/7/42/2/saved-plan/plan.tfplan",
  generation: "90071992547409939",
  size: String(bytes.length),
  timeCreated: "2025-01-01T00:01:30.123Z",
};
const reference = `42/2/${object.generation}`;
const url = `https://storage.googleapis.com/storage/v1/b/${object.bucket}/o/${encodeURIComponent(object.name)}`;
const meta = `${url}?fields=bucket,name,generation,size,timeCreated`;
const media = `${url}?generation=${object.generation}&alt=media`;
let dir: string;
afterEach(async () => {
  if (dir) await rm(dir, { force: true, recursive: true });
});
async function fixture() {
  dir = await mkdtemp("/tmp/factory-review.");
  const runData = structuredClone(producer);
  const jobs = [
    structuredClone(job),
    { ...job, name: "Application", conclusion: "skipped" },
  ];
  const run = vi.fn((cmd, args) => {
    if (cmd === "gh") {
      expect(args.slice(0, -1)).toEqual(["api", "--hostname", "github.com"]);
      if (args.at(-1) === endpoint) return JSON.stringify(runData);
      expect(args.at(-1)).toBe(`${endpoint}/jobs?per_page=100`);
      return JSON.stringify({ total_count: jobs.length, jobs });
    }
    expect([cmd, args]).toEqual([
      "gcloud",
      ["auth", "print-access-token", "--quiet"],
    ]);
    return "fixture-only";
  });
  const data = { ...object };
  const request = vi.fn(async (path, init) => {
    expect(init.redirect).toBe("error");
    expect(init.headers.Authorization).toBe("Bearer fixture-only");
    if (path === meta) return Response.json(data);
    expect(path).toBe(media);
    return new Response(bytes, {
      headers: { "x-goog-generation": data.generation },
    });
  });
  const review = (...summary: string[]) =>
    fetchPlan(
      [
        "example/service",
        sha,
        "infrastructure",
        "42",
        "2",
        object.bucket,
        dir,
        ...summary,
      ],
      run,
      request,
    );
  return { runData, jobs, data, review, request };
}

it.each([[], [reference]])(
  "gets only the pinned bytes, with or without Summary (%s)",
  async (...summary) => {
    const f = await fixture();
    expect(await f.review(...summary)).toBe(reference);
    expect(f.request.mock.calls.map(([path]) => path)).toEqual([
      meta,
      media,
      meta,
    ]);
    expect(await readFile(`${dir}/plan.tfplan`, "utf8")).toBe(bytes);
    expect((await stat(`${dir}/plan.tfplan`)).mode & 0o777).toBe(0o600);
  },
);
it.each([
  { head_sha: "b".repeat(40) },
  { conclusion: "failure" },
  { run_attempt: 1 },
  { id: 43 },
  { path: ".github/workflows/check.yaml" },
  { head_branch: "topic" },
  { head_repository: { id: 8 } },
])("rejects the wrong producer %j before GCS", async (override) => {
  const f = await fixture();
  Object.assign(f.runData, override);
  await expect(f.review()).rejects.toThrow("successful Plan attempt");
  expect(f.request).not.toHaveBeenCalled();
});
it.each([
  { name: "Application" },
  { conclusion: "failure" },
  { run_attempt: 1 },
  { steps: [{ ...step, conclusion: "skipped" }] },
])("rejects wrong job/step %j", async (override) => {
  const f = await fixture();
  Object.assign(f.jobs[0], override);
  await expect(f.review()).rejects.toThrow(/layer job|Plan step/);
  expect(f.request).not.toHaveBeenCalled();
});
it.each([
  [404, "No saved object"],
  [403, "access denied"],
] as const)("distinguishes HTTP %i", async (status, message) => {
  const f = await fixture();
  f.request.mockResolvedValueOnce(new Response(null, { status }));
  await expect(f.review()).rejects.toThrow(message);
  expect(await readdir(dir)).toEqual([]);
});
it.each([
  { timeCreated: "2025-01-01T00:00:00Z" },
  { name: "plans/another" },
  { generation: "not-a-generation" },
])("rejects ambiguous metadata %j", async (override) => {
  const f = await fixture();
  Object.assign(f.data, override);
  await expect(f.review()).rejects.toThrow("Object identity");
  expect(f.request).toHaveBeenCalledTimes(1);
});
it("rejects disagreement with an available Summary before download", async () => {
  const f = await fixture();
  await expect(f.review("42/2/1")).rejects.toThrow("Summary reference");
  expect(f.request).toHaveBeenCalledTimes(1);
});
it("removes private bytes if a concurrent replacement changes the generation", async () => {
  const f = await fixture();
  f.request.mockResolvedValueOnce(Response.json(object));
  f.data.generation = "123";
  f.request.mockResolvedValueOnce(
    new Response(bytes, {
      headers: { "x-goog-generation": object.generation },
    }),
  );
  await expect(f.review()).rejects.toThrow("generation changed");
  expect(await readdir(dir)).toEqual([]);
});
