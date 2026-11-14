// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: GitHub runs this action directly, outside Turbo.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  readlink,
  stat,
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
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

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

// The runner names pages <timeline UUID>_<record UUID>_<page>.log. The
// caller must identify the JOB record, not a step record or GITHUB_JOB name.
// Do not guess from page age or widen the glob to include other records.
export function consolePagePattern(prefix: string) {
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

// Official actions/toolkit artifact util.ts uses this scope for backend IDs.
// Runner JobServerQueue -> ResultsServer -> ResultsHttpClient maps JobId directly
// to WorkflowJobRunBackendId. The other scope UUID is a PLAN, not a timeline.
// Decode only runner-injected metadata, not an authentication/authorization check.
export function runtimeJobId(token: string | undefined): string {
  try {
    const parts = token?.split(".");
    if (
      parts?.length !== 3 ||
      parts.some(
        (part) => !/^[A-Za-z0-9_-]+$/.test(part) || part.length % 4 === 1,
      )
    )
      throw new Error();
    const payload = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.from(parts[1], "base64url"),
      ),
    );
    if (typeof payload?.scp !== "string") throw new Error();
    const scopes = payload.scp
      .split(/\s+/)
      .filter((scope: string) => scope.split(":")[0] === "Actions.Results");
    if (scopes.length !== 1) throw new Error();
    const match = new RegExp(`^Actions\\.Results:${uuid}:(${uuid})$`, "i").exec(
      scopes[0],
    );
    if (!match || match[1] === "00000000-0000-0000-0000-000000000000")
      throw new Error();
    return match[1].toLowerCase();
  } catch {
    // Never propagate decoder errors, token text, or the decoded payload.
    throw new Error("Invalid Actions.Results runtime job identity");
  }
}

// procDirectory is a filesystem fixture seam, not an action input. Inspect only
// ancestry and executable/open-file links; never environments or log bodies.
export async function discoverConsolePrefix(
  token: string | undefined,
  procDirectory = "/proc",
) {
  const jobId = runtimeJobId(token);
  try {
    if (process.platform !== "linux") throw new Error();
    let pid = process.ppid;
    const visited = new Set<number>();
    while (pid > 1 && !visited.has(pid)) {
      visited.add(pid);
      const processDirectory = join(procDirectory, String(pid));
      const executable = await readlink(join(processDirectory, "exe"));
      if (
        basename(executable) === "Runner.Worker" &&
        basename(dirname(executable)) === "bin"
      ) {
        if ((await stat(processDirectory)).uid !== process.getuid?.())
          throw new Error();
        const pages = join(dirname(dirname(executable)), "_diag", "pages");
        const pattern = new RegExp(`^(${uuid}_${jobId}_)([1-9][0-9]*)\\.log$`);
        const prefixes = new Set<string>();
        for (const fd of await readdir(join(processDirectory, "fd"))) {
          const fdPath = join(processDirectory, "fd", fd);
          try {
            const target = await readlink(fdPath);
            const match =
              dirname(target) === pages && pattern.exec(basename(target));
            if (match && (await stat(fdPath)).isFile())
              prefixes.add(join(pages, match[1]));
          } catch (error) {
            // Unrelated descriptors can close during enumeration. Nothing else
            // (especially denied access) is evidence of a safe selection.
            if (!hasErrorCode(error, "ENOENT")) throw error;
          }
        }
        if (prefixes.size !== 1) throw new Error();
        const prefix = [...prefixes][0];
        consolePagePattern(prefix); // Keep the manual path/glob boundary too.
        return prefix;
      }
      const fields = await readFile(join(processDirectory, "stat"), "utf8");
      const parent = fields.slice(fields.lastIndexOf(")") + 2).split(" ")[1];
      if (!/^\d+$/.test(parent)) throw new Error();
      pid = Number(parent);
    }
  } catch {
    // Fail closed, including inaccessible procfs/pages and disappearing parents.
  }
  throw new Error(
    "Automatic console discovery requires one job page prefix under the native Runner.Worker ancestor",
  );
}

// Attempt to push earlier bytes through Runner's userspace buffers with padding;
// flushing our stdout/fsync cannot do that. Confirm only in the selected masked job
// stream. This is NOT a Collector read/export acknowledgment or a lossless claim.
export async function drainConsole(prefix: string): Promise<boolean> {
  consolePagePattern(prefix);
  const marker = `factory-otel-drain-${randomUUID()}`;
  console.info(
    `::group::Collector console drain\n${marker}\n${".".repeat(16 * 1024)}\n::endgroup::`,
  );
  const pagePattern = new RegExp(`^${basename(prefix)}([1-9][0-9]*)\\.log$`);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const pages = (await readdir(dirname(prefix), { withFileTypes: true }))
      .flatMap((entry) => {
        const match = entry.isFile() && pagePattern.exec(entry.name);
        return match ? [{ name: entry.name, number: Number(match[1]) }] : [];
      })
      .sort((a, b) => b.number - a.number)
      .slice(0, 2);
    // Bound reads to 64 KiB from each of two pages (padding may cross a rollover).
    // Deleted/undiscovered pages are not recoverable here; no retention watcher.
    for (const page of pages) {
      try {
        const file = await open(join(dirname(prefix), page.name), "r");
        let visible: boolean;
        try {
          const size = (await file.stat()).size;
          const tail = Buffer.alloc(Math.min(size, 64 * 1024));
          const { bytesRead } = await file.read(
            tail,
            0,
            tail.length,
            Math.max(0, size - tail.length),
          );
          visible = tail.subarray(0, bytesRead).includes(marker);
        } finally {
          await file.close();
        }
        if (visible) {
          // Opportunity for filelog's 200ms poll + 500ms partial-line flush and
          // the 1s batch timeout, followed by normal bounded exporter shutdown.
          await delay(2000);
          return true;
        }
      } catch (error) {
        if (!hasErrorCode(error, "ENOENT")) throw error;
      }
    }
    await delay(200);
  }
  return false;
}

async function main() {
  if (process.env.STATE_directory) {
    try {
      if (
        process.env.STATE_consolePrefix &&
        !(await drainConsole(process.env.STATE_consolePrefix))
      )
        console.warn(
          "Console tail marker was not observed; tail capture remains unconfirmed",
        );
    } catch {
      console.warn("Console tail drain could not be confirmed");
    } finally {
      // Later Runner housekeeping is intentionally outside the capture boundary.
      await stopCollector(process.env.STATE_directory);
    }
    // Never replay collector.log: exporter errors can contain captured payloads.
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
  const args = [
    "--config",
    process.env.INPUT_CONFIG || join(actionDirectory, "config.yaml"),
  ];
  const env = { ...process.env };
  const prefix = process.env["INPUT_JOB-LOG-PREFIX"];
  let consolePrefix: string | undefined;
  if (prefix) {
    if (process.env.INPUT_CONFIG)
      throw new Error("job-log-prefix requires the built-in Collector config");
    consolePrefix =
      prefix === "auto"
        ? await discoverConsolePrefix(process.env.ACTIONS_RUNTIME_TOKEN)
        : prefix;
    env.FACTORY_CI_CONSOLE_PAGES = consolePagePattern(consolePrefix);
    args.push(
      "--set",
      "service::pipelines::logs::receivers=[otlp,filelog/runner_console]",
    );
    console.warn(
      "Console capture stops during action post; bounded tail drain is best-effort, undiscovered deleted pages and later Runner housekeeping are not covered",
    );
  }
  const binary = await installCollector(directory);
  await startCollector({
    binary,
    args,
    directory,
    env,
    healthUrl: "http://127.0.0.1:13133/",
  });
  // Only a validated nonsecret path, and only after startup succeeded. A failed
  // startup retains directory cleanup but must not emit post drain padding.
  if (consolePrefix)
    await appendFile(GITHUB_STATE, `consolePrefix=${consolePrefix}\n`);
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
