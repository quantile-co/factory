import { spawn } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  rmSync,
} from "node:fs";
import { constants } from "node:os";
import { isAbsolute, join } from "node:path";

export interface Execution {
  logFile?: string;
  append?: boolean;
  signal?: AbortSignal;
}
export type Execute = (
  program: string,
  args: readonly string[],
  execution?: Execution,
) => Promise<string>;
export interface ActionInput {
  planFile: string;
  logFile: string;
  signal?: AbortSignal;
}
export type Action = (input: ActionInput) => Promise<void>;
export interface TransportOptions {
  bucket: string;
  repositoryId: string;
  runId: string;
  attempt: string;
  scratchDirectory: string;
  signal?: AbortSignal;
}
export class CommandFailure extends Error {
  constructor(
    public readonly exitCode: number,
    message: string,
  ) {
    super(message);
  }
}

// The caller supplies the process environment. Transport never reads GitHub or TF variables.
export function processRunner(environment: NodeJS.ProcessEnv): Execute {
  return (program, args, options = {}) =>
    new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new CommandFailure(130, "Command cancelled"));
        return;
      }
      const fd = options.logFile
        ? openSync(options.logFile, options.append ? "a" : "w", 0o600)
        : undefined;
      // A separate process group owns descendants of wrappers such as pnpm, too.
      const grouped = process.platform !== "win32";
      const child = spawn(program, [...args], {
        env: environment,
        detached: grouped,
        stdio: ["ignore", fd ?? "pipe", fd ?? "pipe"],
      });
      let cancelled = false;
      let failedToSpawn = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const terminate = (signal: NodeJS.Signals) => {
        if (!child.pid) return;
        try {
          if (grouped) process.kill(-child.pid, signal);
          else child.kill(signal);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      };
      const cancel = () => {
        cancelled = true;
        terminate("SIGTERM");
        killTimer = setTimeout(() => terminate("SIGKILL"), 5_000);
        killTimer.unref();
      };
      options.signal?.addEventListener("abort", cancel, { once: true });
      const output: Buffer[] = [];
      child.stdout?.on("data", (data: Buffer) => output.push(data));
      // Diagnostics from unlogged storage commands are deliberately not forwarded.
      child.stderr?.resume();
      // Spawn/abort errors must not settle transport before the process closes.
      child.on("error", () => {
        failedToSpawn = true;
      });
      child.on("close", (code, signal) => {
        options.signal?.removeEventListener("abort", cancel);
        if (killTimer) clearTimeout(killTimer);
        if (cancelled) terminate("SIGKILL");
        if (fd !== undefined) closeSync(fd);
        const status =
          code && code > 0
            ? code
            : signal
              ? 128 + constants.signals[signal]
              : cancelled
                ? 130
                : failedToSpawn
                  ? 1
                  : 0;
        if (status === 0)
          resolve(Buffer.concat(output).toString("utf8").trim());
        else
          reject(
            new CommandFailure(
              status,
              cancelled ? "Command cancelled" : `${program} failed`,
            ),
          );
      });
    });
}

function validate(options: TransportOptions) {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(options.bucket))
    throw new Error("Invalid state bucket");
  for (const value of [options.repositoryId, options.runId, options.attempt]) {
    if (!/^[1-9][0-9]*$/.test(value))
      throw new Error("Invalid repository/run/attempt ID");
  }
  if (!isAbsolute(options.scratchDirectory))
    throw new Error("Runner scratch directory must be absolute");
}
function privatePaths(options: TransportOptions, phase: string) {
  const directory = join(options.scratchDirectory, "saved-plan");
  // Atomic ownership: never reuse, chmod, upload or remove somebody else's path.
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error("Private scratch path already exists");
    throw error;
  }
  const planFile = join(directory, "plan.tfplan");
  const logFile = join(directory, `${phase}.log`);
  try {
    closeSync(openSync(logFile, "wx", 0o600));
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return { directory, planFile, logFile };
}
function requirePlan(path: string) {
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (!info?.isFile() || info.size === 0)
    throw new Error("No regular saved plan produced");
  chmodSync(path, 0o600);
}
function base(options: TransportOptions) {
  return `gs://${options.bucket}/plans/${options.repositoryId}`;
}
async function failureLog(
  execute: Execute,
  logFile: string,
  destination: string,
) {
  try {
    await execute(
      "gcloud",
      [
        "storage",
        "cp",
        logFile,
        destination,
        "--if-generation-match=0",
        "--quiet",
      ],
      { signal: AbortSignal.timeout(10_000) },
    );
  } catch {
    /* Failure-log upload must not replace the original failure/cancellation. */
  }
}

export async function plan(
  options: TransportOptions & { summaryFile: string },
  action: Action,
  execute: Execute,
): Promise<string> {
  validate(options);
  if (!isAbsolute(options.summaryFile))
    throw new Error("Step summary path must be absolute");
  const paths = privatePaths(options, "plan");
  const destination = `${base(options)}/${options.runId}/${options.attempt}`;
  try {
    await action({ ...paths, signal: options.signal });
    requirePlan(paths.planFile);
    await execute(
      "gcloud",
      [
        "storage",
        "cp",
        "--recursive",
        paths.directory,
        `${destination}/`,
        "--if-generation-match=0",
        "--quiet",
      ],
      { signal: options.signal },
    );
    const generation = await execute(
      "gcloud",
      [
        "storage",
        "objects",
        "describe",
        `${destination}/saved-plan/plan.tfplan`,
        "--raw",
        "--format=value(generation)",
      ],
      { signal: options.signal },
    );
    if (!/^[1-9][0-9]*$/.test(generation))
      throw new Error("Invalid saved-plan generation");
    const reference = `${options.runId}/${options.attempt}/${generation}`;
    appendFileSync(options.summaryFile, `Plan reference: ${reference}\n`, {
      mode: 0o600,
    });
    return reference;
  } catch (error) {
    await failureLog(execute, paths.logFile, `${destination}/plan.log`);
    throw error;
  } finally {
    rmSync(paths.directory, { recursive: true, force: true });
  }
}

export async function apply(
  options: TransportOptions & { planReference: string },
  action: Action,
  execute: Execute,
): Promise<void> {
  validate(options);
  const reference = /^([1-9][0-9]*)\/([1-9][0-9]*)\/([1-9][0-9]*)$/.exec(
    options.planReference,
  );
  if (!reference) throw new Error("Expected reviewed run/attempt/generation");
  const source = `${base(options)}/${reference[1]}/${reference[2]}/saved-plan/plan.tfplan#${reference[3]}`;
  const paths = privatePaths(options, "apply");
  try {
    await execute(
      "gcloud",
      ["storage", "cp", source, paths.planFile, "--quiet"],
      { logFile: paths.logFile, signal: options.signal },
    );
    requirePlan(paths.planFile);
    await action({ ...paths, signal: options.signal });
  } catch (error) {
    await failureLog(
      execute,
      paths.logFile,
      `${base(options)}/apply/${options.runId}/${options.attempt}/apply.log`,
    );
    throw error;
  } finally {
    rmSync(paths.directory, { recursive: true, force: true });
  }
}
