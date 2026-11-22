import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// Official release assets; changing the version requires reviewing both hashes.
export const release = {
  version: "0.155.0",
  x64: "229cfddeb0621d2a011bfd1c8894335479e46349b93a0cfbccbe653443a3ec95",
  arm64: "f2fac079d5b761a729e49ba5db319cab92affc558406dc42e3c1c08e0827e14f",
};

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export function verifyArchive(bytes: Uint8Array, digest: string) {
  if (createHash("sha256").update(bytes).digest("hex") !== digest) {
    throw new Error("Collector archive checksum mismatch");
  }
}

export async function installCollector(directory: string) {
  const arch = process.arch;
  if (process.platform !== "linux" || (arch !== "x64" && arch !== "arm64")) {
    throw new Error("The runner image supports Linux x64 and arm64 runners");
  }
  const architecture = arch === "x64" ? "amd64" : "arm64";
  const asset = `otelcol-contrib_${release.version}_linux_${architecture}.tar.gz`;
  const archive = join(directory, asset);
  const response = await fetch(
    `https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${release.version}/${asset}`,
    { signal: AbortSignal.timeout(120_000) },
  );
  if (!response.ok)
    throw new Error(`Collector download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  verifyArchive(bytes, release[arch]);
  await writeFile(archive, bytes, { mode: 0o600 });
  execFileSync(
    "tar",
    ["-xzf", archive, "-C", directory, "--no-same-owner", "otelcol-contrib"],
    {
      timeout: 30_000,
      stdio: "pipe",
    },
  );
  const binary = join(directory, "otelcol-contrib");
  await chmod(binary, 0o700);
  return binary;
}

// A persisted Linux start-time identifies the process across runner hooks and
// avoids signalling a reused PID if the Collector died earlier in the job.
export async function processIdentity(pid: number) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return fields[0] === "Z" ? undefined : fields[19];
  } catch (error) {
    if (hasErrorCode(error, "ENOENT") || hasErrorCode(error, "ESRCH"))
      return undefined;
    throw error;
  }
}

export async function stopCollector(directory: string, graceMs = 15_000) {
  let record: { pid?: unknown; started?: unknown } | null;
  try {
    record = JSON.parse(
      await readFile(join(directory, "process.json"), "utf8"),
    );
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return;
    throw error;
  }
  if (
    typeof record?.pid !== "number" ||
    !Number.isSafeInteger(record.pid) ||
    record.pid <= 1 ||
    typeof record.started !== "string" ||
    !/^\d+$/.test(record.started)
  ) {
    throw new Error("Invalid Collector process record");
  }
  const { pid, started } = record;
  const sameProcess = async () => (await processIdentity(pid)) === started;
  async function signal(value: NodeJS.Signals) {
    if (!(await sameProcess())) return;
    try {
      process.kill(-pid, value);
    } catch (error) {
      if (!hasErrorCode(error, "ESRCH")) throw error;
    }
  }
  await signal("SIGTERM");
  const deadline = Date.now() + graceMs;
  while ((await sameProcess()) && Date.now() < deadline) await delay(100);
  if (await sameProcess()) {
    console.warn(
      "Collector exceeded shutdown grace period; forcing termination",
    );
    await signal("SIGKILL");
  }
}

export async function startCollector({
  binary,
  args,
  directory,
  env,
  healthUrl,
  timeoutMs = 30_000,
}: {
  binary: string;
  args: string[];
  directory: string;
  env: NodeJS.ProcessEnv;
  healthUrl: string;
  timeoutMs?: number;
}) {
  const log = await open(join(directory, "collector.log"), "a", 0o600);
  let child: ChildProcess;
  try {
    child = spawn(binary, args, {
      env,
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
    });
    await new Promise<void>((resolveSpawn, reject) => {
      child.once("spawn", resolveSpawn);
      child.once("error", reject);
    });
  } finally {
    await log.close();
  }
  const pid = child.pid;
  if (pid === undefined) throw new Error("Collector did not start");
  let started: string | undefined;
  try {
    started = await processIdentity(pid);
    if (!started) throw new Error("Collector exited during startup");
    await writeFile(
      join(directory, "process.json"),
      JSON.stringify({ pid, started }),
      { mode: 0o600 },
    );
  } catch (error) {
    // Post-job cleanup cannot find a child whose identity was never persisted.
    child.kill("SIGKILL");
    throw error;
  } finally {
    child.unref();
  }
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      if ((await processIdentity(pid)) !== started)
        throw new Error("Collector exited before readiness");
      try {
        const response = await fetch(healthUrl, {
          signal: AbortSignal.timeout(1000),
          redirect: "error",
        });
        await response.body?.cancel();
        if (response.ok) return;
      } catch {
        // The listener may not be available yet. Startup has one bounded deadline.
      }
      await delay(100);
    }
    throw new Error("Collector readiness timed out");
  } catch (error) {
    await stopCollector(directory);
    throw error;
  }
}

const assets = dirname(fileURLToPath(import.meta.url));
const binary = join(assets, "otelcol-contrib");

export async function installRunnerCollector() {
  // Verify the pinned upstream archive at image build time, not during a workflow.
  const build = await mkdtemp(join(tmpdir(), "factory-otel-install-"));
  try {
    await copyFile(await installCollector(build), binary);
    await chmod(binary, 0o755);
  } finally {
    await rm(build, { recursive: true, force: true });
  }
}

export async function startJobCollector(
  env: NodeJS.ProcessEnv,
  directory: string,
  origin: string,
  start = startCollector,
) {
  await mkdir(directory, { mode: 0o700 });
  await start({
    binary,
    directory,
    args: ["--config", join(assets, "config.yaml")],
    env: collectorEnvironment(env, origin),
    healthUrl: "http://127.0.0.1:13133/",
  });
}

// A positive list: the collector needs workload observations, not job credentials.
export function collectorEnvironment(
  env: NodeJS.ProcessEnv,
  origin: string,
): NodeJS.ProcessEnv {
  const keys = [
    "GITHUB_ACTION",
    "GITHUB_ACTION_REPOSITORY",
    "GITHUB_ACTOR",
    "GITHUB_ACTOR_ID",
    "GITHUB_BASE_REF",
    "GITHUB_EVENT_NAME",
    "GITHUB_HEAD_REF",
    "GITHUB_JOB",
    "GITHUB_REF",
    "GITHUB_REF_NAME",
    "GITHUB_REF_PROTECTED",
    "GITHUB_REF_TYPE",
    "GITHUB_REPOSITORY",
    "GITHUB_REPOSITORY_ID",
    "GITHUB_REPOSITORY_OWNER",
    "GITHUB_REPOSITORY_OWNER_ID",
    "GITHUB_RUN_ATTEMPT",
    "GITHUB_RUN_ID",
    "GITHUB_RUN_NUMBER",
    "GITHUB_SERVER_URL",
    "GITHUB_SHA",
    "GITHUB_TRIGGERING_ACTOR",
    "GITHUB_WORKFLOW",
    "GITHUB_WORKFLOW_REF",
    "GITHUB_WORKFLOW_SHA",
    "RUNNER_ARCH",
    "RUNNER_ENVIRONMENT",
    "RUNNER_NAME",
    "RUNNER_OS",
  ];
  return {
    PATH: env.PATH,
    // Preserve the runner's orphan-cleanup backstop without exporting its ID as metadata.
    RUNNER_TRACKING_ID: env.RUNNER_TRACKING_ID,
    SSL_CERT_FILE: env.SSL_CERT_FILE,
    SSL_CERT_DIR: env.SSL_CERT_DIR,
    OTEL_RESOURCE_ATTRIBUTES: env.OTEL_RESOURCE_ATTRIBUTES,
    QUANTILE_OTLP_ENDPOINT: origin,
    QUANTILE_OTELCOL_METADATA: Buffer.from(
      JSON.stringify(
        Object.fromEntries(
          keys.filter((k) => Boolean(env[k])).map((k) => [k, env[k]]),
        ),
      ),
    ).toString("base64"),
  };
}
