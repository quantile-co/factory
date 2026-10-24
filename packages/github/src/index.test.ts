import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import {
  type Action,
  apply,
  CommandFailure,
  plan,
  processRunner,
} from "./index.ts";

it.each([undefined, "tf"])(
  "preserves saved bytes, generation scoping and private failure logs with tfDirectory=%s",
  async (tfDirectory) => {
    const root = mkdtempSync(join(tmpdir(), "factory-workflow-gcs-"));
    try {
      const bin = join(root, "bin");
      mkdirSync(bin);
      function executable(name: string, code: string) {
        const file = join(bin, name);
        writeFileSync(file, `#!${process.execPath}\n${code}`);
        chmodSync(file, 0o755);
      }
      executable(
        "gcloud",
        `
const fs = require("node:fs"), path = require("node:path"), a = process.argv.slice(2), e = process.env;
fs.appendFileSync(e.FAKE_GCLOUD_CALLS, a.join(" ") + "\\n");
fs.mkdirSync(e.FAKE_STORAGE, {recursive:true});
if (a.slice(0,3).join(" ") === "storage cp --recursive") {
  if (!a.includes("--if-generation-match=0")) process.exit(80);
  fs.cpSync(a[3], path.join(e.FAKE_STORAGE,"saved-plan"), {recursive:true});
} else if (a.slice(0,3).join(" ") === "storage objects describe") console.log("42");
else if (a[0] === "storage" && a[1] === "cp" && a[2].endsWith("#42")) fs.copyFileSync(path.join(e.FAKE_STORAGE,"saved-plan/plan.tfplan"),a[3]);
else if (a[0] === "storage" && a[1] === "cp") {
  if (!a.includes("--if-generation-match=0")) process.exit(80);
  fs.copyFileSync(a[2], path.join(e.FAKE_STORAGE,path.basename(a[2])));
} else process.exit(80);
`,
      );
      executable(
        "tofu",
        `
const fs=require("node:fs"),a=process.argv.slice(2),e=process.env;
fs.appendFileSync(e.FAKE_TOFU_CALLS,a.join(" ")+"\\n");console.log("provider-private-diagnostic");
if(a.includes("init")) {
  if(!a.includes("-backend-config=bucket=private-bucket")||!a.includes("-backend-config=prefix=repository/prod"))process.exit(81);
} else if(a.includes("plan")) {
  if(e.FAKE_FAIL_PLAN==="1")process.exit(7);
  fs.writeFileSync(a.find(x=>x.startsWith("-out=")).slice(5),"reviewed saved bytes");
} else if(a.includes("apply")) {
  if(fs.readFileSync(a.at(-1),"utf8")!=="reviewed saved bytes")process.exit(82);
  if(e.FAKE_FAIL_APPLY==="1")process.exit(9);
  fs.writeFileSync(e.FAKE_APPLIED,"applied");
} else process.exit(81);
`,
      );
      const environment = {
        PATH: `${bin}:${dirname(process.execPath)}`,
        FAKE_STORAGE: join(root, "storage"),
        FAKE_GCLOUD_CALLS: join(root, "gcloud-calls"),
        FAKE_TOFU_CALLS: join(root, "tofu-calls"),
        FAKE_APPLIED: join(root, "applied"),
      };
      const options = {
        bucket: "private-bucket",
        repositoryId: "123",
        runId: "456",
        attempt: "1",
        scratchDirectory: root,
        summaryFile: join(root, "summary"),
        planReference: "456/1/42",
      };
      const planFile = join(root, "saved-plan/plan.tfplan");
      const invoke = (
        phase: "plan" | "apply",
        extra: NodeJS.ProcessEnv = {},
        custom?: Action,
      ) => {
        const execute = processRunner({ ...environment, ...extra });
        const action: Action =
          custom ??
          (async ({ planFile, logFile, signal }) => {
            await execute(
              "tofu",
              [
                `-chdir=${tfDirectory ?? "tf/infrastructure"}`,
                "init",
                "-input=false",
                "-lockfile=readonly",
                "-backend-config=bucket=private-bucket",
                "-backend-config=prefix=repository/prod",
              ],
              { logFile, append: true, signal },
            );
            await execute(
              "tofu",
              phase === "plan"
                ? [
                    `-chdir=${tfDirectory ?? "tf/infrastructure"}`,
                    "plan",
                    "-input=false",
                    "-no-color",
                    `-out=${planFile}`,
                  ]
                : [
                    `-chdir=${tfDirectory ?? "tf/infrastructure"}`,
                    "apply",
                    "-input=false",
                    planFile,
                  ],
              { logFile, append: true, signal },
            );
          });
        return phase === "plan"
          ? plan(options, action, execute)
          : apply(options, action, execute);
      };
      await expect(
        invoke("plan", { FAKE_FAIL_PLAN: "1" }),
      ).rejects.toMatchObject({ exitCode: 7 });
      expect(
        readFileSync(join(environment.FAKE_STORAGE, "plan.log"), "utf8"),
      ).toContain("provider-private-diagnostic");
      expect(existsSync(planFile)).toBe(false);
      expect(await invoke("plan")).toBe("456/1/42");
      expect(readFileSync(options.summaryFile, "utf8")).toContain("456/1/42");
      expect(
        readFileSync(
          join(environment.FAKE_STORAGE, "saved-plan/plan.tfplan"),
          "utf8",
        ),
      ).toBe("reviewed saved bytes");
      expect(existsSync(planFile)).toBe(false);
      const beforeInvalid = readFileSync(environment.FAKE_GCLOUD_CALLS, "utf8");
      await expect(
        apply(
          { ...options, planReference: "bad" },
          async () => {
            throw new Error("must not execute");
          },
          processRunner(environment),
        ),
      ).rejects.toThrow("reviewed run/attempt/generation");
      expect(readFileSync(environment.FAKE_GCLOUD_CALLS, "utf8")).toBe(
        beforeInvalid,
      );
      await expect(
        invoke("apply", { FAKE_FAIL_APPLY: "1" }),
      ).rejects.toMatchObject({ exitCode: 9 });
      expect(
        readFileSync(join(environment.FAKE_STORAGE, "apply.log"), "utf8"),
      ).toContain("provider-private-diagnostic");
      expect(existsSync(planFile)).toBe(false);
      expect(existsSync(environment.FAKE_APPLIED)).toBe(false);
      await invoke("apply");
      expect(existsSync(environment.FAKE_APPLIED)).toBe(true);
      expect(existsSync(planFile)).toBe(false);
      expect(readFileSync(environment.FAKE_GCLOUD_CALLS, "utf8")).toContain(
        "plan.tfplan#42",
      );
      const calls = readFileSync(environment.FAKE_TOFU_CALLS, "utf8");
      expect(calls.match(/ plan /g)).toHaveLength(2);
      expect(calls.match(/ apply /g)).toHaveLength(2);
      for (const call of calls.trim().split("\n"))
        expect(call).toMatch(
          new RegExp(
            `^-chdir=${tfDirectory ?? "tf/infrastructure"} (init|plan|apply) `,
          ),
        );
      const custom =
        (phase: "plan" | "apply", fail = false): Action =>
        async ({ planFile, logFile }) => {
          appendFileSync(logFile, "provider-private-diagnostic\n");
          if (fail) throw new CommandFailure(11, "caller failed");
          if (phase === "plan") writeFileSync(planFile, "reviewed saved bytes");
          else
            expect(readFileSync(planFile, "utf8")).toBe("reviewed saved bytes");
        };
      await expect(
        invoke("plan", {}, custom("plan", true)),
      ).rejects.toMatchObject({ exitCode: 11 });
      expect(existsSync(planFile)).toBe(false);
      await invoke("plan", {}, custom("plan"));
      await expect(
        invoke("apply", {}, custom("apply", true)),
      ).rejects.toMatchObject({ exitCode: 11 });
      expect(existsSync(planFile)).toBe(false);
      await invoke("apply", {}, custom("apply"));
      expect(existsSync(planFile)).toBe(false);
      expect(readFileSync(environment.FAKE_TOFU_CALLS, "utf8")).toBe(calls);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

it.each(["env", "flag"])(
  "CLI isolates provider inputs and resolves the %s credential internally",
  (source) => {
    const root = mkdtempSync(join(tmpdir(), "factory-workflow-cli-"));
    try {
      const code = `const fs=require('node:fs');fs.appendFileSync(process.argv[2],JSON.stringify({args:process.argv.slice(3),env:process.env})+'\\n');fs.writeFileSync(process.argv[3],'saved');`;
      const command = join(root, "caller.cjs");
      writeFileSync(command, code);
      const log = join(root, "observed");
      // No real gcloud command is reachable. Its final upload intentionally fails after the caller probe.
      const bin = join(root, "bin");
      mkdirSync(bin);
      writeFileSync(
        join(bin, "gcloud"),
        `#!${process.execPath}\nrequire("node:fs").writeFileSync(require("node:path").join(process.env.HOME,"storage-env"),JSON.stringify(process.env));process.exit(1);\n`,
      );
      chmodSync(join(bin, "gcloud"), 0o755);
      writeFileSync(
        join(bin, "tofu"),
        `#!${process.execPath}
const fs=require("node:fs"),args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({args,env:process.env})+"\\n");
const output=args.find(arg=>arg.startsWith("-out="));
if(output)fs.writeFileSync(output.slice(5),"saved");
`,
      );
      chmodSync(join(bin, "tofu"), 0o755);
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          new URL("../../../apps/github/cli.ts", import.meta.url).pathname,
          "plan",
          "--tf-layer",
          "infrastructure",
          "--gcp-tf-state-bucket",
          "private-bucket",
          "--gcp-wif-pool",
          "approved-pool",
          ...(source === "flag"
            ? ["--gh-repo-token", "fixture-credential"]
            : []),
          ...(source === "env"
            ? ["--", process.execPath, command, log, "{plan}"]
            : []),
        ],
        {
          encoding: "utf8",
          env: {
            PATH: bin,
            HOME: root,
            TF_VAR_unapproved: "must-not-leak",
            TF_BACKEND_PREFIX: "must-not-leak",
            GH_REPO_TOKEN:
              source === "env" ? "fixture-credential" : "overridden-credential",
            GITHUB_TOKEN: "must-not-leak",
            REST_API_BEARER: "must-not-leak",
            GCP_TF_STATE_BUCKET: "ignored-ambient-bucket",
            GCP_WIF_POOL: "ignored-ambient-pool",
            PROJECT_OWNERS: '[{"gh_username":"approved"}]',
            PROJECT_MEMBERS: "[]",
            GITHUB_REPOSITORY: "example/repository",
            GITHUB_REPOSITORY_ID: "123",
            GITHUB_RUN_ID: "456",
            GITHUB_RUN_ATTEMPT: "1",
            GITHUB_STEP_SUMMARY: join(root, "summary"),
            RUNNER_TEMP: root,
          },
        },
      );
      expect(result.status).not.toBe(0);
      expect(result.stdout + result.stderr).not.toContain("fixture-credential");
      const calls = readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const observed = calls.at(-1);
      const planFile = join(root, "saved-plan/plan.tfplan");
      if (source === "env") expect(observed.args).toEqual([planFile]);
      else {
        expect(calls.map((call) => call.args)).toEqual([
          [
            "-chdir=tf/infrastructure",
            "init",
            "-input=false",
            "-lockfile=readonly",
            "-backend-config=bucket=private-bucket",
            "-backend-config=prefix=repository/prod",
          ],
          [
            "-chdir=tf/infrastructure",
            "plan",
            "-input=false",
            "-no-color",
            `-out=${planFile}`,
          ],
        ]);
      }
      expect(observed.env.TF_VAR_unapproved).toBeUndefined();
      expect(observed.env.TF_BACKEND_PREFIX).toBeUndefined();
      expect(observed.env.TF_PLAN_FILE).toBeUndefined();
      expect(observed.env.TF_VAR_project_owners).toBeUndefined();
      expect(observed.env.TF_VAR_project_members).toBeUndefined();
      expect(observed.env.TF_VAR_gcp_wif_pool).toBe("approved-pool");
      expect(observed.env.GITHUB_TOKEN).toBe("fixture-credential");
      expect(observed.env.REST_API_BEARER).toBe("fixture-credential");
      expect(observed.env.GH_REPO).toBe("example/repository");
      const storage = JSON.parse(
        readFileSync(join(root, "storage-env"), "utf8"),
      );
      expect(storage.GH_REPO_TOKEN).toBeUndefined();
      expect(storage.GITHUB_TOKEN).toBeUndefined();
      expect(storage.REST_API_BEARER).toBeUndefined();
      expect(existsSync(join(root, "saved-plan"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

it("cancellation waits for process close and terminates owned wrapper descendants", async () => {
  const root = mkdtempSync(join(tmpdir(), "factory-workflow-cancel-"));
  try {
    const ready = join(root, "ready"),
      closed = join(root, "closed"),
      late = join(root, "late");
    const grandchild = join(root, "grandchild.cjs");
    writeFileSync(
      grandchild,
      `const fs=require("node:fs");process.on("SIGTERM",()=>{});setTimeout(()=>fs.writeFileSync(${JSON.stringify(late)},"escaped"),700);`,
    );
    const child = join(root, "child.cjs");
    writeFileSync(
      child,
      `const fs=require("node:fs"),{spawn}=require("node:child_process");process.on("SIGTERM",()=>setTimeout(()=>{fs.writeFileSync(${JSON.stringify(closed)},"closed");process.exit(7)},250));spawn(process.execPath,[${JSON.stringify(grandchild)}],{stdio:"ignore"});fs.writeFileSync(${JSON.stringify(ready)},"ready");setInterval(()=>{},1000);`,
    );
    const abort = new AbortController();
    let settled = false;
    const running = processRunner({ PATH: dirname(process.execPath) })(
      process.execPath,
      [child],
      { signal: abort.signal, logFile: join(root, "private.log") },
    ).catch((error) => {
      settled = true;
      return error;
    });
    for (let i = 0; i < 100 && !existsSync(ready); i++) await delay(10);
    expect(existsSync(ready)).toBe(true);
    abort.abort();
    await delay(75);
    expect(settled).toBe(false);
    expect(existsSync(closed)).toBe(false);
    expect(await running).toMatchObject({ exitCode: 7 });
    expect(readFileSync(closed, "utf8")).toBe("closed");
    await delay(600);
    expect(existsSync(late)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("rejects preexisting scratch and dangling plan links without touching unowned contents", async () => {
  const root = mkdtempSync(join(tmpdir(), "factory-workflow-scratch-"));
  try {
    const directory = join(root, "saved-plan"),
      outside = join(root, "outside"),
      marker = join(directory, "user-data");
    mkdirSync(directory);
    writeFileSync(marker, "keep");
    symlinkSync(outside, join(directory, "plan.tfplan"));
    const options = {
      bucket: "private-bucket",
      repositoryId: "123",
      runId: "456",
      attempt: "1",
      scratchDirectory: root,
      summaryFile: join(root, "summary"),
    };
    let actionRan = false;
    const calls: string[][] = [];
    const execute = async (_program: string, args: readonly string[]) => {
      calls.push([...args]);
      return "42";
    };
    await expect(
      plan(
        options,
        async ({ planFile }) => {
          actionRan = true;
          writeFileSync(planFile, "must not write");
        },
        execute,
      ),
    ).rejects.toThrow("scratch path already exists");
    expect(actionRan).toBe(false);
    expect(calls).toEqual([]);
    expect(existsSync(outside)).toBe(false);
    expect(readFileSync(marker, "utf8")).toBe("keep");
    expect(lstatSync(join(directory, "plan.tfplan")).isSymbolicLink()).toBe(
      true,
    );
    rmSync(directory, { recursive: true });
    writeFileSync(outside, "unrelated bytes");
    await expect(
      plan(
        options,
        async ({ planFile }) => symlinkSync(outside, planFile),
        execute,
      ),
    ).rejects.toThrow("regular saved plan");
    expect(calls.some((args) => args.includes("--recursive"))).toBe(false);
    expect(readFileSync(outside, "utf8")).toBe("unrelated bytes");
    expect(existsSync(directory)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
