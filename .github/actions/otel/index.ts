// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: GitHub runs this action directly, outside Turbo.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// Official release assets; changing the version requires reviewing both hashes.
export const release = {
  version: "0.155.0",
  x64: "229cfddeb0621d2a011bfd1c8894335479e46349b93a0cfbccbe653443a3ec95",
  arm64: "f2fac079d5b761a729e49ba5db319cab92affc558406dc42e3c1c08e0827e14f",
};
const actionDirectory = dirname(fileURLToPath(import.meta.url));

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export function verifyArchive(bytes: Uint8Array, digest: string) {
  if (createHash("sha256").update(bytes).digest("hex") !== digest) {
    throw new Error("Collector archive checksum mismatch");
  }
}

export async function installCollector(directory: string, env = process.env) {
  const arch = process.arch;
  if (process.platform !== "linux" || (arch !== "x64" && arch !== "arm64")) {
    throw new Error("The otel action supports Linux x64 and arm64 runners");
  }
  const architecture = arch === "x64" ? "amd64" : "arm64";
  const asset = `otelcol-contrib_${release.version}_linux_${architecture}.tar.gz`;
  const cache = join(
    env.RUNNER_TOOL_CACHE || directory,
    "factory-otel",
    release.version,
  );
  await mkdir(cache, { recursive: true });
  const archive = join(cache, asset);
  let bytes: Uint8Array;
  try {
    bytes = await readFile(archive);
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) throw error;
    const response = await fetch(
      `https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${release.version}/${asset}`,
      { signal: AbortSignal.timeout(120_000) },
    );
    if (!response.ok)
      throw new Error(`Collector download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    verifyArchive(bytes, release[arch]);
    await writeFile(archive, bytes, { mode: 0o600 });
  }
  // Verify cached archives too; never trust an extracted executable from a cache.
  verifyArchive(bytes, release[arch]);
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

// A persisted Linux start-time identifies the process across action phases and
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
      process.kill(-pid, value); // Detached process group includes the supervisor and Collector.
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

// The runner names pages <timeline UUID>_<record UUID>_<page>.log. The
// caller must identify the JOB record, not a step record or GITHUB_JOB name.
// No discovery integration yet: verify runner metadata before supplying this.
// Do not guess from page age or widen the glob to include other records.
export function consolePagePattern(prefix: string) {
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  if (
    !isAbsolute(prefix) ||
    !dirname(prefix).endsWith("/_diag/pages") ||
    /[\0\r\n*?[\]{}\\$]/.test(prefix) ||
    !new RegExp(`^${uuid}_${uuid}_$`).test(basename(prefix))
  ) {
    throw new Error(
      "Expected an absolute _diag/pages/<timeline UUID>_<job record UUID>_ prefix",
    );
  }
  return `${prefix}*.log`;
}

export async function renew(
  directory: string,
  audience: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
) {
  if (!env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)
    throw new Error("GitHub job requires id-token: write");
  const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Invalid GitHub OIDC request URL");
  url.searchParams.set("audience", audience);
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
    redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
  });
  if (!response.ok) throw new Error("GitHub OIDC request failed");
  const { value } = await response.json();
  if (typeof value !== "string" || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(value))
    throw new Error("Missing GitHub job token");
  const { aud, exp } = JSON.parse(
    Buffer.from(value.split(".")[1], "base64url").toString(),
  );
  if (
    aud !== audience ||
    !Number.isSafeInteger(exp) ||
    exp * 1000 <= Date.now() + 30_000
  )
    throw new Error("Unusable GitHub job token");
  const file = join(directory, "identity");
  await writeFile(file + ".next", value, { mode: 0o600 });
  await rename(file + ".next", file);
  return Math.max(1000, exp * 1000 - Date.now() - 60_000);
}

async function supervise(directory: string, binary: string, args: string[]) {
  const audience = process.env.QUANTILE_OTLP_ENDPOINT;
  if (!audience) throw new Error("Missing Collector audience");
  const controller = new AbortController();
  let child: ReturnType<typeof spawn> | undefined;
  const stop = () => {
    controller.abort();
    child?.kill("SIGTERM");
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    let wait = await renew(directory, audience, process.env, controller.signal);
    controller.signal.throwIfAborted();
    const env = {
      ...process.env,
      FACTORY_OTEL_IDENTITY_FILE: join(directory, "identity"),
    };
    delete (env as NodeJS.ProcessEnv).ACTIONS_ID_TOKEN_REQUEST_URL;
    delete (env as NodeJS.ProcessEnv).ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    child = spawn(binary, args, { env, stdio: "inherit" });
    const exited = once(child, "exit").finally(() => controller.abort());
    const refresh = async () => {
      while (!controller.signal.aborted) {
        try {
          await delay(wait, undefined, { signal: controller.signal });
          wait = await renew(
            directory,
            audience,
            process.env,
            controller.signal,
          );
        } catch {
          if (!controller.signal.aborted) wait = 5000;
        }
      }
    };
    const [[code]] = await Promise.all([exited, refresh()]);
    if (code !== 0 && code !== null) process.exitCode = 1;
  } finally {
    controller.abort();
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    await Promise.all(
      ["identity", "identity.next"].map((name) =>
        rm(join(directory, name), { force: true }),
      ),
    );
  }
}

async function main() {
  if (process.argv[2] === "supervise") {
    const [directory, binary, ...args] = process.argv.slice(3);
    try {
      await supervise(directory, binary, args);
    } catch {
      throw new Error("Collector identity or process unavailable");
    }
    return;
  }
  if (process.env.STATE_directory) {
    // Action posts (even the runner's JOB_COMPLETED hook) precede final job
    // logging and page flush. Keep bounded cleanup until a runner-owned drain
    // primitive is qualified; escaping orphan cleanup is not a completeness fix.
    await stopCollector(process.env.STATE_directory);
    // Never replay collector.log into the captured stream: exporter errors can
    // contain payloads, and replay while capturing would feed diagnostics back.
    return;
  }
  const endpoint = process.env.QUANTILE_OTLP_ENDPOINT;
  if (!endpoint) {
    console.info("Collector disabled: endpoint not supplied");
    return;
  }
  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Expected a credential-free HTTPS OTLP base URL");
  }
  const { RUNNER_TEMP, GITHUB_STATE, GITHUB_OUTPUT } = process.env;
  if (!RUNNER_TEMP || !GITHUB_STATE || !GITHUB_OUTPUT)
    throw new Error("GitHub Actions runtime paths are required");
  const directory = await mkdtemp(join(RUNNER_TEMP, "factory-otel-"));
  // Register cleanup before doing fallible setup. Only a path, never credentials.
  await appendFile(GITHUB_STATE, `directory=${directory}\n`);
  await appendFile(
    GITHUB_OUTPUT,
    `log-file=${join(directory, "collector.log")}\n`,
  );
  const args = [
    "--config",
    process.env.INPUT_CONFIG || join(actionDirectory, "config.yaml"),
  ];
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    QUANTILE_OTLP_ENDPOINT: url.origin,
  };
  const prefix = process.env["INPUT_JOB-LOG-PREFIX"];
  if (prefix) {
    if (process.env.INPUT_CONFIG)
      throw new Error("job-log-prefix requires the built-in Collector config");
    env.FACTORY_CI_CONSOLE_PAGES = consolePagePattern(prefix);
    args.push(
      "--set",
      "service::pipelines::logs::receivers=[otlp,filelog/runner_console]",
    );
    console.warn(
      "Console capture stops during action post; buffered tail, undiscovered deleted pages and final runner output are not covered",
    );
  }
  const binary = await installCollector(directory);
  await startCollector({
    binary: process.execPath,
    args: [
      fileURLToPath(import.meta.url),
      "supervise",
      directory,
      binary,
      ...args,
    ],
    directory,
    env,
    healthUrl: "http://127.0.0.1:13133/",
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    // Do not print subprocess environments or raw exporter responses.
    const message =
      error instanceof Error ? error.message : "Unexpected Collector failure";
    console.error(
      `::error::OTel action failed: ${message.replace(/[\r\n]/g, " ")}`,
    );
    process.exitCode = 1;
  });
}
