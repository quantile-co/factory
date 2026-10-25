import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

class MigrationFailure extends Error {}

const repository = "quantile-co/factory";
const bucket = "factory-a515-tf-state";
const states = [
  {
    layer: "infrastructure",
    directory: "tf/infrastructure",
    from: "repository/prod",
    to: "factory/prod/infrastructure",
  },
];

const exactJson = JSON as typeof JSON & {
  rawJSON(source: string): unknown;
  isRawJSON(value: unknown): boolean;
};
function parseExact(text: string): unknown {
  return JSON.parse(
    text,
    (_key: string, value: unknown, context?: { source?: string }) => {
      if (typeof value !== "number") return value;
      if (!context?.source)
        throw new MigrationFailure("Lossless JSON parsing is unavailable");
      return exactJson.rawJSON(context.source);
    },
  );
}
function sorted(value: unknown): unknown {
  if (exactJson.isRawJSON(value)) return value;
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sorted(item)]),
    );
  return value;
}

export function stateDigest(bytes: Uint8Array) {
  const state = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (
    state.version !== 4 ||
    typeof state.lineage !== "string" ||
    !state.lineage ||
    !Number.isSafeInteger(state.serial) ||
    state.serial < 0 ||
    !Array.isArray(state.resources) ||
    !state.outputs ||
    typeof state.outputs !== "object"
  )
    throw new MigrationFailure("Invalid state snapshot");
  return createHash("sha256")
    .update(
      JSON.stringify(sorted(parseExact(Buffer.from(bytes).toString("utf8")))),
    )
    .digest("hex");
}

export function verifyTransition(
  before: Uint8Array,
  after: Uint8Array,
  increment = 1,
) {
  const original = JSON.parse(Buffer.from(before).toString("utf8"));
  const originalExact = parseExact(
    Buffer.from(before).toString("utf8"),
  ) as Record<string, unknown>;
  const migrated = JSON.parse(Buffer.from(after).toString("utf8"));
  stateDigest(before);
  stateDigest(after);
  if (
    migrated.serial !== original.serial + increment ||
    stateDigest(
      Buffer.from(
        JSON.stringify({
          ...originalExact,
          serial: exactJson.rawJSON(String(migrated.serial)),
        }),
      ),
    ) !== stateDigest(after)
  )
    throw new MigrationFailure("Unexpected state migration transition");
}

export function migrationAnswer(output: string, backend = "gcs") {
  // OpenTofu 1.13.1 refreshes both states under its native locks before this prompt.
  // The non-empty-destination prompt has the same query but a different description.
  const text = output.replace(/\s+/g, " ");
  return text.includes(
    `No existing state was found in the newly configured "${backend}" backend.`,
  ) &&
    !text.includes("An existing non-empty state already exists") &&
    text.includes("Do you want to copy existing state to the new backend?")
    ? "yes\n"
    : "no\n";
}

export function verifySourceInventory(
  prefix: string,
  sources: string[],
  listing: {
    items?: { name?: string }[];
    prefixes?: string[];
    nextPageToken?: string;
  },
) {
  const nested = sources
    .filter((source) => source.startsWith(`${prefix}/`))
    .map(
      (source) => `${prefix}/${source.slice(prefix.length + 1).split("/")[0]}/`,
    );
  if (
    listing.nextPageToken ||
    !Array.isArray(listing.items) ||
    listing.items.length !== 1 ||
    listing.items[0].name !== `${prefix}/default.tfstate` ||
    (listing.prefixes ?? []).some((value) => !nested.includes(value))
  )
    throw new MigrationFailure("Unexpected source workspace or lock inventory");
}

const outputLimit = 100_000_000;
const interruptGraceMs = 2_000;

export async function runOwned(
  name: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  log?: string,
  interactiveBackend?: string,
  signal?: AbortSignal,
  timeoutMs = 300_000,
): Promise<Buffer> {
  signal?.throwIfAborted();
  if (process.platform === "win32")
    throw new MigrationFailure("POSIX process groups required");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    throw new MigrationFailure("Invalid command timeout");
  const fd =
    log === undefined
      ? undefined
      : openSync(
          log,
          constants.O_WRONLY |
            constants.O_APPEND |
            constants.O_CREAT |
            constants.O_NOFOLLOW,
          0o600,
        );
  try {
    if (fd !== undefined) {
      const info = fstatSync(fd);
      if (!info.isFile() || (info.mode & 0o077) !== 0)
        throw new MigrationFailure(
          "Diagnostics must be a private regular file",
        );
    }
    return await new Promise<Buffer>((resolve, reject) => {
      const child = spawn(name, args, {
        env,
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const captured: Buffer[] = [];
      let size = 0,
        prompt = "",
        answered = false;
      let failure: Error | undefined;
      let closed = false,
        cleanupDone = false,
        stopping = false;
      let escalation: ReturnType<typeof setTimeout> | undefined;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      let status: number | null = null;

      const groupSignal = (value: NodeJS.Signals | 0) => {
        if (!child.pid) return false;
        try {
          process.kill(-child.pid, value);
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH")
            failure ??= new MigrationFailure(
              "Owned process group cleanup failed",
            );
          return false;
        }
      };
      const finish = () => {
        if (!closed || !cleanupDone) return;
        clearTimeout(deadline);
        clearTimeout(escalation);
        signal?.removeEventListener("abort", cancelled);
        if (failure) reject(failure);
        else if (status !== 0)
          reject(
            new MigrationFailure(
              "Owned command failed; inspect private diagnostics",
            ),
          );
        else if (interactiveBackend !== undefined && !answered)
          reject(
            new MigrationFailure("Missing empty-destination confirmation"),
          );
        else resolve(Buffer.concat(captured));
      };
      const cleanup = () => {
        if (stopping) return;
        stopping = true;
        if (!groupSignal("SIGINT")) {
          cleanupDone = true;
          finish();
          return;
        }
        escalation = setTimeout(() => {
          // Kill remaining descendants even if the group leader has already exited.
          groupSignal("SIGKILL");
          cleanupDone = true;
          finish();
        }, interruptGraceMs);
      };
      const stop = (reason: string) => {
        failure ??= new MigrationFailure(reason);
        cleanup();
      };
      const cancelled = () => stop("Owned command interrupted");
      child.once("error", () => stop("Owned command could not start"));
      child.stdin.on("error", () => stop("Owned command stdin failed"));
      child.stdout.on("error", () => stop("Owned command stdout failed"));
      child.stderr.on("error", () => stop("Owned command stderr failed"));
      const receive = (data: Buffer, stdout: boolean) => {
        if (size + data.length > outputLimit) {
          stop("Owned command output limit exceeded");
          return;
        }
        size += data.length;
        if (fd !== undefined) {
          try {
            appendFileSync(fd, data);
          } catch {
            stop("Private diagnostics write failed");
            return;
          }
        }
        if (stdout) captured.push(data);
        if (interactiveBackend === undefined || failure) return;
        prompt = (prompt + data.toString("utf8")).slice(-100_000);
        if (prompt.includes("Enter a value:")) {
          if (answered) {
            stop("Unexpected additional migration confirmation");
            return;
          }
          answered = true;
          const answer = migrationAnswer(prompt, interactiveBackend);
          prompt = "";
          child.stdin.end(answer);
          if (answer !== "yes\n")
            stop("Refused nonempty or unknown migration prompt");
        }
      };
      child.stdout.on("data", (data: Buffer) => receive(data, true));
      child.stderr.on("data", (data: Buffer) => receive(data, false));
      child.once("exit", () => {
        if (groupSignal(0)) {
          failure ??= new MigrationFailure("Owned command left descendants");
          cleanup();
        } else {
          clearTimeout(escalation);
          cleanupDone = true;
        }
        finish();
      });
      child.once("close", (code) => {
        status = code;
        closed = true;
        if (!child.pid || !groupSignal(0)) {
          clearTimeout(escalation);
          cleanupDone = true;
        } else {
          failure ??= new MigrationFailure("Owned command left descendants");
          cleanup();
        }
        finish();
      });
      signal?.addEventListener("abort", cancelled, { once: true });
      deadline = setTimeout(() => stop("Owned command timed out"), timeoutMs);
      if (signal?.aborted) cancelled();
      if (interactiveBackend === undefined) child.stdin.end();
    });
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export async function migrateBackend(
  args: string[],
  env: NodeJS.ProcessEnv,
  log: string,
  backend = "gcs",
  signal?: AbortSignal,
  timeoutMs = 300_000,
) {
  await runOwned("tofu", args, env, log, backend, signal, timeoutMs);
}

async function main(env: NodeJS.ProcessEnv, signal: AbortSignal) {
  process.umask(0o077);
  const required = (key: string) => {
    const value = env[key];
    if (!value) throw new MigrationFailure(`Missing ${key}`);
    return value;
  };
  if (
    env.GITHUB_ACTIONS !== "true" ||
    required("GITHUB_REPOSITORY") !== repository ||
    required("GITHUB_REF") !== "refs/heads/main" ||
    required("GITHUB_EVENT_NAME") !== "workflow_dispatch" ||
    required("GITHUB_WORKFLOW_REF") !==
      `${repository}/.github/workflows/apply.yaml@refs/heads/main` ||
    required("GCP_TF_STATE_BUCKET") !== bucket
  )
    throw new MigrationFailure("Migration workflow identity differs");
  const phase = required("MIGRATION_PHASE");
  if (
    !["preflight", "migrate"].includes(phase) ||
    required("MIGRATION_CONFIRM") !== repository
  )
    throw new MigrationFailure("Migration phase or confirmation differs");
  const runId = required("GITHUB_RUN_ID"),
    attempt = required("GITHUB_RUN_ATTEMPT"),
    repoId = required("GITHUB_REPOSITORY_ID"),
    revision = required("GITHUB_SHA");
  if (
    ![runId, attempt, repoId].every((value) => /^[1-9][0-9]*$/.test(value)) ||
    !/^[0-9a-f]{40}$/.test(revision)
  )
    throw new MigrationFailure("Invalid workflow metadata");
  const scratch = mkdtempSync(
    join(required("RUNNER_TEMP"), "backend-migration-"),
  );
  const log = join(scratch, "migration.log");
  writeFileSync(log, "", { mode: 0o600, flag: "wx" });
  const backupPrefix = `state-backups/${repoId}/${runId}/${attempt}`;
  const providerEnv: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "SSL_CERT_FILE",
    "NIX_SSL_CERT_FILE",
    "CLOUDSDK_CONFIG",
    "CLOUDSDK_CORE_PROJECT",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE",
    "GOOGLE_GHA_CREDS_PATH",
  ])
    if (env[key] !== undefined) providerEnv[key] = env[key];
  providerEnv.TF_IN_AUTOMATION = "true";
  providerEnv.TF_WORKSPACE = "default";
  const command = (name: string, args: string[], localEnv = providerEnv) =>
    runOwned(
      name,
      args,
      localEnv,
      name === "gcloud" ? undefined : log,
      undefined,
      signal,
    );
  const token = (await command("gcloud", ["auth", "print-access-token"]))
    .toString()
    .trim();
  if (!token) throw new MigrationFailure("Missing workflow access token");
  const storage = async (url: string, init: RequestInit = {}) => {
    signal.throwIfAborted();
    const response = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
      signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
      redirect: "error",
    });
    return response;
  };
  const objectUrl = (name: string) =>
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(name)}`;
  const metadata = async (name: string) => {
    const response = await storage(objectUrl(name));
    if (response.status === 404) return undefined;
    if (!response.ok)
      throw new MigrationFailure(
        `Object metadata access failed: HTTP ${response.status}`,
      );
    const data = (await response.json()) as {
      generation: string;
      size: string;
    };
    if (!/^[1-9][0-9]*$/.test(data.generation) || !/^[0-9]+$/.test(data.size))
      throw new MigrationFailure("Invalid object metadata");
    return data;
  };
  const bytes = async (name: string, generation: string) => {
    const response = await storage(
      `${objectUrl(name)}?alt=media&generation=${generation}`,
    );
    if (!response.ok)
      throw new MigrationFailure("Exact-generation object read failed");
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length === 0 || body.length > 100_000_000)
      throw new MigrationFailure("Invalid state size");
    return body;
  };
  const create = async (name: string, body: Buffer) => {
    const response = await storage(
      `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(name)}&ifGenerationMatch=0`,
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(body),
      },
    );
    if (!response.ok)
      throw new MigrationFailure("Create-only backup upload failed");
    const data = (await response.json()) as { generation: string };
    if (!/^[1-9][0-9]*$/.test(data.generation))
      throw new MigrationFailure("Invalid backup generation");
    return data.generation;
  };
  const noDestination = async (prefix: string) => {
    const response = await storage(
      `https://storage.googleapis.com/storage/v1/b/${bucket}/o?prefix=${encodeURIComponent(`${prefix}/`)}&versions=true&maxResults=1`,
    );
    if (!response.ok)
      throw new MigrationFailure("Destination history access failed");
    const data = (await response.json()) as {
      items?: unknown[];
      nextPageToken?: string;
    };
    if ((data.items?.length ?? 0) > 0 || data.nextPageToken)
      throw new MigrationFailure("Destination is not unused");
  };
  const sourceInventory = async (prefix: string) => {
    const response = await storage(
      `https://storage.googleapis.com/storage/v1/b/${bucket}/o?prefix=${encodeURIComponent(`${prefix}/`)}&delimiter=%2F&maxResults=1000`,
    );
    if (!response.ok)
      throw new MigrationFailure("Source inventory access failed");
    const listing = (await response.json()) as {
      items?: { name?: string }[];
      prefixes?: string[];
      nextPageToken?: string;
    };
    verifySourceInventory(
      prefix,
      states.map((state) => state.from),
      listing,
    );
  };
  const workflowGate = async () => {
    const get = async (path: string) => {
      const response = await fetch(
        `https://api.github.com/repos/${repository}/${path}`,
        {
          headers: {
            Authorization: `Bearer ${required("GITHUB_TOKEN")}`,
            Accept: "application/vnd.github+json",
          },
          signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
          redirect: "error",
        },
      );
      if (!response.ok) throw new MigrationFailure("Workflow gate read failed");
      return response.json();
    };
    const ref = await get("git/ref/heads/main");
    if (ref.object?.sha !== revision)
      throw new MigrationFailure("Main changed during migration");
    for (const status of [
      "in_progress",
      "queued",
      "waiting",
      "pending",
      "requested",
    ]) {
      const runs = await get(`actions/runs?status=${status}&per_page=100`);
      if (
        !Array.isArray(runs.workflow_runs) ||
        runs.total_count > 100 ||
        runs.workflow_runs.some(
          (run: { id: number; path: string }) =>
            String(run.id) !== runId &&
            [
              ".github/workflows/plan.yaml",
              ".github/workflows/apply.yaml",
            ].includes(run.path),
        )
      )
        throw new MigrationFailure(
          "Another production writer is active or queued",
        );
    }
  };
  let stage = "preflight";
  try {
    const version = JSON.parse(
      (await command("tofu", ["version", "-json"])).toString(),
    );
    if (version.terraform_version !== "1.13.1")
      throw new MigrationFailure("Unexpected OpenTofu version");
    await workflowGate();
    const bucketResponse = await storage(
      `https://storage.googleapis.com/storage/v1/b/${bucket}`,
    );
    if (!bucketResponse.ok)
      throw new MigrationFailure("Bucket safeguards cannot be verified");
    const bucketData = (await bucketResponse.json()) as {
      versioning?: { enabled?: boolean };
      iamConfiguration?: {
        publicAccessPrevention?: string;
        uniformBucketLevelAccess?: { enabled?: boolean };
      };
    };
    if (
      !bucketData.versioning?.enabled ||
      bucketData.iamConfiguration?.publicAccessPrevention !== "enforced" ||
      !bucketData.iamConfiguration?.uniformBucketLevelAccess?.enabled
    )
      throw new MigrationFailure("Bucket safeguards differ");
    const snapshots = [];
    for (const state of states) {
      const source = `${state.from}/default.tfstate`;
      const original = await metadata(source);
      if (
        !original ||
        Number(original.size) <= 0 ||
        Number(original.size) > outputLimit
      )
        throw new MigrationFailure("Source state is absent or empty");
      if (
        (await metadata(`${state.from}/default.tflock`)) ||
        (await metadata(`${state.to}/default.tflock`))
      )
        throw new MigrationFailure("A state lock is active");
      await noDestination(state.to);
      await sourceInventory(state.from);
      const before = await bytes(source, original.generation);
      stateDigest(before);
      if (JSON.parse(before.toString()).terraform_version !== "1.13.1")
        throw new MigrationFailure("Unexpected source state version");
      snapshots.push({ ...state, source, original, before });
    }
    if (phase === "preflight") {
      for (const state of snapshots) {
        const serial = JSON.parse(state.before.toString()).serial;
        appendFileSync(
          required("GITHUB_STEP_SUMMARY"),
          `${state.layer}: source generation ${state.original.generation}, serial ${serial}, format 4 / OpenTofu 1.13.1; default-only inventory, no locks, unused destination and bucket safeguards verified. No writes.\n`,
        );
      }
      console.log(
        "Read-only preflight passed; no state or backup was written.",
      );
      return;
    }
    for (const state of snapshots) {
      stage = `${state.layer}:backup`;
      await workflowGate();
      await noDestination(state.to);
      if (
        (await metadata(state.source))?.generation !== state.original.generation
      )
        throw new MigrationFailure("Source changed before backup");
      const backup = `${backupPrefix}/${state.layer}.tfstate`;
      const backupGeneration = await create(backup, state.before);
      if (
        !Buffer.from(await bytes(backup, backupGeneration)).equals(state.before)
      )
        throw new MigrationFailure("Backup readback differs");
      const directory = resolve(state.directory);
      const cache = join(scratch, state.layer);
      mkdirSync(cache, { mode: 0o700 });
      const localEnv = {
        ...providerEnv,
        TF_DATA_DIR: join(cache, ".terraform"),
      };
      stage = `${state.layer}:initialize-source`;
      await command(
        "tofu",
        [
          `-chdir=${directory}`,
          "init",
          "-input=false",
          "-lockfile=readonly",
          `-backend-config=bucket=${bucket}`,
          `-backend-config=prefix=${state.from}`,
        ],
        localEnv,
      );
      const before = await command(
        "tofu",
        [`-chdir=${directory}`, "state", "pull"],
        localEnv,
      );
      if (stateDigest(before) !== stateDigest(state.before))
        throw new MigrationFailure(
          "Native source snapshot differs from the backed-up object",
        );
      if (
        (await metadata(state.source))?.generation !== state.original.generation
      )
        throw new MigrationFailure("Source changed before migration");
      await noDestination(state.to);
      stage = `${state.layer}:native-migration`;
      await migrateBackend(
        [
          `-chdir=${directory}`,
          "init",
          "-migrate-state",
          "-input=true",
          "-no-color",
          "-lockfile=readonly",
          `-backend-config=bucket=${bucket}`,
          `-backend-config=prefix=${state.to}`,
        ],
        localEnv,
        log,
        "gcs",
        signal,
      );
      stage = `${state.layer}:verify`;
      const after = await command(
        "tofu",
        [`-chdir=${directory}`, "state", "pull"],
        localEnv,
      );
      verifyTransition(before, after);
      const destination = `${state.to}/default.tfstate`,
        destinationMetadata = await metadata(destination);
      if (!destinationMetadata)
        throw new MigrationFailure("Destination state is absent");
      verifyTransition(
        state.before,
        await bytes(destination, destinationMetadata.generation),
      );
      if (
        (await metadata(state.source))?.generation !== state.original.generation
      )
        throw new MigrationFailure("Source changed during migration");
      if (
        (await metadata(`${state.from}/default.tflock`)) ||
        (await metadata(`${state.to}/default.tflock`))
      )
        throw new MigrationFailure("Native migration left a state lock");
      await workflowGate();
      stage = `${state.layer}:retire-old-object`;
      if (
        (await metadata(`${state.from}/default.tflock`)) ||
        (await metadata(`${state.to}/default.tflock`))
      )
        throw new MigrationFailure("A state lock appeared before retirement");
      if (
        (await metadata(destination))?.generation !==
        destinationMetadata.generation
      )
        throw new MigrationFailure(
          "Destination changed before source retirement",
        );
      const retired = await storage(
        `${objectUrl(state.source)}?ifGenerationMatch=${state.original.generation}`,
        { method: "DELETE" },
      );
      if (retired.status !== 204 || (await metadata(state.source)))
        throw new MigrationFailure("Old state retirement was not verified");
      const serial = JSON.parse(state.before.toString()).serial;
      const result = `${state.layer}: verified same lineage/content at ${state.to}, serial ${serial} -> ${serial + 1}; backup ${backup}#${backupGeneration}; destination generation ${destinationMetadata.generation}.\n`;
      appendFileSync(required("GITHUB_STEP_SUMMARY"), result);
      console.log(
        `${state.layer}: native migration and exact state verification passed.`,
      );
    }
  } catch (error) {
    if (phase === "migrate" && !signal.aborted) {
      try {
        await create(`${backupPrefix}/migration.log`, readFileSync(log));
      } catch {
        /* State backups already uploaded remain protected. */
      }
    }
    throw new MigrationFailure(
      `Stopped at ${stage}: ${error instanceof MigrationFailure ? error.message : "unexpected runtime failure"}; inspect private state backups and diagnostics under gs://${bucket}/${backupPrefix}/. Do not retry automatically.`,
    );
  }
}

if (import.meta.main) {
  const abort = new AbortController();
  const interrupt = () =>
    abort.abort(new MigrationFailure("Migration interrupted"));
  const terminate = () =>
    abort.abort(new MigrationFailure("Migration terminated"));
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  try {
    await main(process.env, abort.signal);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "State migration failed",
    );
    process.exitCode = abort.signal.aborted ? 130 : 1;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
  }
}
