// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: GitHub runs this action directly, outside Turbo.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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
      process.kill(pid, value);
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

async function main() {
  if (process.env.STATE_directory) {
    try {
      await stopCollector(process.env.STATE_directory);
    } finally {
      const token = randomUUID();
      console.info("::group::Collector diagnostics");
      console.info(`::stop-commands::${token}`);
      try {
        for await (const chunk of createReadStream(
          join(process.env.STATE_directory, "collector.log"),
        )) {
          if (!process.stdout.write(chunk)) await once(process.stdout, "drain");
        }
      } catch (error) {
        if (!hasErrorCode(error, "ENOENT"))
          console.warn("Collector diagnostics could not be read.");
      } finally {
        console.info(`\n::${token}::`);
        console.info("::endgroup::");
      }
    }
    return;
  }
  const endpoint = process.env.CLICKSTACK_OTLP_ENDPOINT;
  const key = process.env.CLICKSTACK_API_KEY;
  if (!endpoint && !key) {
    console.info("Collector disabled: ingestion configuration not supplied");
    return;
  }
  if (!endpoint || !key)
    throw new Error(
      "Both CLICKSTACK_OTLP_ENDPOINT and CLICKSTACK_API_KEY are required",
    );
  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
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
  const binary = await installCollector(directory);
  await startCollector({
    binary,
    args: [
      "--config",
      process.env.INPUT_CONFIG || join(actionDirectory, "config.yaml"),
    ],
    directory,
    env: process.env,
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
