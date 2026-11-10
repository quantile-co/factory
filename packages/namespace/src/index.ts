import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  accessSync,
  appendFileSync,
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

type Environment = NodeJS.ProcessEnv;
interface Context {
  env: Environment;
  signal?: AbortSignal;
}
interface Proxy {
  pid: number;
  binary: string;
  url: string;
}
interface State extends Proxy {
  purpose: "factory-namespace/nixcache";
  publicKey: string;
}

function childEnvironment(env: Environment): Environment {
  const result = { ...env };
  delete result.NIX_CACHE_PRIVATE_KEY;
  return result;
}

function run(
  program: string,
  args: string[],
  context: Context,
  input?: string,
): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    if (context.signal?.aborted) {
      reject(new Error("Namespace cache command cancelled"));
      return;
    }
    const grouped = process.platform !== "win32";
    const child = spawn(program, args, {
      env: childEnvironment(context.env),
      detached: grouped,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    const output: Buffer[] = [];
    let failed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        process.kill(grouped ? -child.pid : child.pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    };
    const cancel = () => {
      kill("SIGTERM");
      timer = setTimeout(() => kill("SIGKILL"), 5_000);
      timer.unref();
    };
    context.signal?.addEventListener("abort", cancel, { once: true });
    child.stdout?.on("data", (value: Buffer) => output.push(value));
    child.stderr?.resume();
    child.on("error", () => {
      failed = true;
    });
    child.stdin?.on("error", () => {
      failed = true;
    });
    if (input !== undefined) child.stdin?.end(input);
    child.on("close", (code) => {
      context.signal?.removeEventListener("abort", cancel);
      if (timer) clearTimeout(timer);
      if (context.signal?.aborted) {
        kill("SIGKILL");
        reject(new Error("Namespace cache command cancelled"));
      } else if (failed || code !== 0) {
        // Native diagnostics may contain credentials; do not forward them to CI logs.
        reject(
          new Error(
            `${program} failed${code === null ? "" : ` (exit ${code})`}`,
          ),
        );
      } else resolveOutput(Buffer.concat(output).toString("utf8").trim());
    });
  });
}

function required(env: Environment, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
function executable(env: Environment, name: string): string {
  for (const directory of (env.PATH ?? "").split(":")) {
    if (!directory) continue;
    const path = resolve(directory, name);
    try {
      accessSync(path, constants.X_OK);
      return realpathSync(path);
    } catch {
      /* Try the next directory. */
    }
  }
  throw new Error(`Missing ${name} executable`);
}
function regularFile(path: string): boolean {
  return lstatSync(path, { throwIfNoEntry: false })?.isFile() === true;
}
async function ready(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/nix-cache-info`, {
      signal: AbortSignal.timeout(2_000),
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}
async function owned(proxy: Proxy, env: Environment): Promise<boolean> {
  if (
    !Number.isSafeInteger(proxy.pid) ||
    proxy.pid <= 1 ||
    !isAbsolute(proxy.binary)
  )
    return false;
  try {
    const command = await run(
      "ps",
      ["-ww", "-p", String(proxy.pid), "-o", "command="],
      { env },
    );
    const url = new URL(proxy.url);
    return ` ${command} `.includes(
      ` ${proxy.binary} -foreground -listen 127.0.0.1:${url.port || "80"} `,
    );
  } catch {
    return false;
  }
}
async function stop(proxy: Proxy, env: Environment): Promise<void> {
  if (!(await owned(proxy, env))) return;
  process.kill(proxy.pid, "SIGTERM");
  for (let i = 0; i < 30; i++) {
    if (!(await owned(proxy, env))) return;
    await delay(100);
  }
  if (await owned(proxy, env)) process.kill(proxy.pid, "SIGKILL");
}
async function start(
  directory: string,
  port: number,
  mode: "persist" | "local-only",
  context: Context,
): Promise<Proxy> {
  const binary = executable(context.env, "nixcache");
  const url = `http://127.0.0.1:${port}`;
  if (await ready(url))
    throw new Error(`Unmanaged proxy already listening at ${url}`);
  const cache =
    mode === "persist" && context.env.NSC_CACHE_PATH
      ? join(context.env.NSC_CACHE_PATH, "nixcache")
      : join(directory, "archives");
  const log = join(directory, "proxy.log");
  const fd = openSync(log, "a", 0o600);
  const child = spawn(
    binary,
    [
      "-foreground",
      "-listen",
      `127.0.0.1:${port}`,
      "-cache_dir",
      cache,
      `-cache-upstream=${mode}`,
    ],
    {
      env: childEnvironment(context.env),
      detached: true,
      stdio: ["ignore", fd, fd],
    },
  );
  try {
    await new Promise<void>((resolveSpawn, reject) => {
      child.once("spawn", resolveSpawn);
      child.once("error", () => reject(new Error("Unable to start nixcache")));
    });
  } finally {
    closeSync(fd);
  }
  child.unref();
  if (!child.pid) throw new Error("No nixcache process ID");
  const proxy = { pid: child.pid, binary, url };
  try {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      context.signal?.throwIfAborted();
      if (!(await owned(proxy, context.env))) break;
      if (await ready(url)) return proxy;
      await delay(100, undefined, { signal: context.signal });
    }
    throw new Error(`Nix cache did not become ready; inspect ${log}`);
  } catch (error) {
    await stop(proxy, context.env);
    throw error;
  }
}

async function configuration(
  proxy: Proxy,
  publicKey: string,
  context: Context,
): Promise<string> {
  const original = context.env.NIX_CONFIG ?? "";
  const settings = async (name: string) =>
    (await run("nix", ["config", "show", name], context))
      .split(/\s+/)
      .filter(Boolean);
  const substituters = await settings("substituters");
  const keys = await settings("trusted-public-keys");
  const missingURL = !substituters.includes(proxy.url);
  const missingKey = !!publicKey && !keys.includes(publicKey);
  if (!missingURL && !missingKey) return original;
  const trusted =
    JSON.parse(await run("nix", ["store", "info", "--json"], context))
      .trusted === true;
  if (
    !trusted &&
    (missingKey ||
      !(await settings("trusted-substituters")).includes(proxy.url))
  )
    throw new Error(
      "Ask your Nix administrator to allow the loopback substituter and public signing key",
    );
  let config = `${original}\nsubstituters = ${[...(missingURL ? [proxy.url] : []), ...substituters].join(" ")}`;
  if (missingKey)
    config += `\ntrusted-public-keys = ${[publicKey, ...keys].join(" ")}`;
  if (trusted) config += "\nrequire-sigs = true";
  return config;
}

async function localConfig(
  workspace: string,
  publicKey: string,
  port: number,
  context: Context,
): Promise<string> {
  const original = context.env.NIX_CONFIG ?? "";
  if (context.env.CI) return original;
  try {
    try {
      await run("nsc", ["auth", "check-login"], context);
    } catch {
      throw new Error(`Run nsc login for ${workspace}, then reload the shell`);
    }
    const identity = JSON.parse(
      await run("nsc", ["workspace", "describe", "--output", "json"], context),
    );
    if (identity.name !== workspace)
      throw new Error(
        `Select Namespace workspace ${workspace}, then reload the shell`,
      );
    if (
      typeof identity.tenant_id !== "string" ||
      !/^[A-Za-z0-9_-]+$/.test(identity.tenant_id)
    )
      throw new Error("Invalid Namespace workspace identity");
    const home = context.env.HOME || homedir();
    const cache =
      context.env.XDG_CACHE_HOME ||
      (process.platform === "darwin"
        ? join(home, "Library/Caches")
        : join(home, ".cache"));
    const directory = join(cache, "nixcache", identity.tenant_id, String(port));
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!lstatSync(directory).isDirectory())
      throw new Error("Cache path is not a directory");
    const lock = join(directory, "start.lock");
    let locked = false;
    for (let i = 0; i < 100; i++) {
      try {
        mkdirSync(lock, { mode: 0o700 });
        locked = true;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      await delay(100, undefined, { signal: context.signal });
    }
    if (!locked) throw new Error(`Cache startup is locked at ${lock}`);
    let proxy: Proxy;
    try {
      const record = join(directory, "proxy");
      const match = regularFile(record)
        ? /^([1-9][0-9]*) (.+)\n?$/.exec(readFileSync(record, "utf8"))
        : null;
      const existing = match
        ? {
            pid: Number(match[1]),
            binary: match[2],
            url: `http://127.0.0.1:${port}`,
          }
        : undefined;
      if (existing && (await owned(existing, context.env))) {
        if (
          existing.binary !== executable(context.env, "nixcache") ||
          !(await ready(existing.url))
        )
          throw new Error(
            `Managed proxy ${existing.pid} needs attention; inspect ${directory}`,
          );
        proxy = existing;
      } else {
        if (existsSync(record) && !regularFile(record))
          throw new Error("Cache record is not a regular file");
        proxy = await start(directory, port, "local-only", context);
        writeFileSync(record, `${proxy.pid} ${proxy.binary}\n`, {
          mode: 0o600,
        });
      }
    } finally {
      rmdirSync(lock);
    }
    return await configuration(proxy, publicKey, context);
  } catch (error) {
    console.error(
      `Namespace Nix cache: ${error instanceof Error ? error.message : "setup failed"}. Configuration unchanged.`,
    );
    return original;
  }
}

function state(
  env: Environment,
): { directory: string; record: State } | undefined {
  if (!env.NIXCACHE_STATE) return undefined;
  const scratch = resolve(required(env, "RUNNER_TEMP"));
  const directory = resolve(env.NIXCACHE_STATE);
  if (
    !isAbsolute(env.NIXCACHE_STATE) ||
    dirname(directory) !== scratch ||
    !basename(directory).startsWith("namespace-nixcache-")
  )
    throw new Error("Invalid cache scratch path");
  if (!existsSync(directory)) return undefined;
  if (
    !lstatSync(directory).isDirectory() ||
    !regularFile(join(directory, "state.json"))
  )
    throw new Error("Cache scratch is not owned by this helper");
  const record = JSON.parse(
    readFileSync(join(directory, "state.json"), "utf8"),
  ) as State;
  if (
    record.purpose !== "factory-namespace/nixcache" ||
    !Number.isSafeInteger(record.pid) ||
    record.pid < 0 ||
    typeof record.binary !== "string" ||
    !isAbsolute(record.binary) ||
    typeof record.url !== "string" ||
    !/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(record.url) ||
    typeof record.publicKey !== "string"
  )
    throw new Error("Invalid cache scratch record");
  return { directory, record };
}
function environmentFile(path: string, name: string, value: string): void {
  if (!isAbsolute(path)) throw new Error("Environment file must be absolute");
  const delimiter = `NIXCACHE_${randomBytes(16).toString("hex")}`;
  appendFileSync(path, `${name}<<${delimiter}\n${value}\n${delimiter}\n`, {
    mode: 0o600,
  });
}
async function ciStart(port: number, context: Context): Promise<void> {
  const scratch = required(context.env, "RUNNER_TEMP");
  const envFile = required(context.env, "GITHUB_ENV");
  const publicKey = required(context.env, "NIX_CACHE_PUBLIC_KEY").trim();
  if (!isAbsolute(scratch)) throw new Error("Runner scratch must be absolute");
  const directory = mkdtempSync(join(scratch, "namespace-nixcache-"));
  let record: State = {
    purpose: "factory-namespace/nixcache",
    pid: 0,
    binary: executable(context.env, "nixcache"),
    url: `http://127.0.0.1:${port}`,
    publicKey,
  };
  try {
    writeFileSync(join(directory, "state.json"), JSON.stringify(record), {
      mode: 0o600,
      flag: "wx",
    });
    environmentFile(envFile, "NIXCACHE_STATE", directory);
    record = {
      ...record,
      ...(await start(directory, port, "persist", context)),
    };
    writeFileSync(join(directory, "state.json"), JSON.stringify(record), {
      mode: 0o600,
    });
    environmentFile(
      envFile,
      "NIX_CONFIG",
      await configuration(record, publicKey, context),
    );
  } catch (error) {
    await stop(record, context.env);
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
async function ciFinish(context: Context): Promise<void> {
  const current = state(context.env);
  if (
    !current ||
    !(await owned(current.record, context.env)) ||
    !(await ready(current.record.url))
  )
    throw new Error("No managed Namespace cache is running");
  const privateKey = required(context.env, "NIX_CACHE_PRIVATE_KEY").trim();
  const publicKey = required(context.env, "NIX_CACHE_PUBLIC_KEY").trim();
  if (publicKey !== current.record.publicKey)
    throw new Error("Signing key differs from cache setup");
  if (
    (await run(
      "nix",
      ["key", "convert-secret-to-public"],
      context,
      `${privateKey}\n`,
    )) !== publicKey
  )
    throw new Error("Nix cache signing keys do not match");
  const paths = await run("nix", ["path-info", "--all"], context);
  if (!paths) return;
  const key = join(current.directory, "secret.key");
  let created = false;
  try {
    writeFileSync(key, `${privateKey}\n`, { mode: 0o600, flag: "wx" });
    created = true;
    const destination = new URL(current.record.url);
    destination.searchParams.set("secret-key", key);
    await run(
      "nix",
      ["copy", "--stdin", "--to", destination.href],
      context,
      `${paths}\n`,
    );
  } finally {
    if (created) rmSync(key, { force: true });
  }
}
async function ciCleanup(context: Context): Promise<void> {
  const current = state(context.env);
  if (!current) return;
  await stop(current.record, context.env);
  rmSync(current.directory, { recursive: true, force: true });
}

export async function namespaceCli(
  args: string[],
  environment: Environment = process.env,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const [command, action, ...rest] = args;
  if (command !== "nixcache")
    throw new Error(
      "Usage: factory-namespace nixcache proxy|publish|cleanup|local-config",
    );
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      workspace: { type: "string" },
      "public-key": { type: "string", default: "" },
      port: { type: "string", default: "18765" },
    },
  });
  if (positionals.length) throw new Error("Unexpected cache arguments");
  const port = Number(values.port);
  if (
    !/^[0-9]+$/.test(values.port) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new Error("Invalid loopback port");
  const context = { env: environment, signal };
  if (action === "local-config") {
    if (!values.workspace) throw new Error("Missing --workspace");
    return localConfig(values.workspace, values["public-key"], port, context);
  }
  if (action === "cleanup") {
    await ciCleanup(context);
    return;
  }
  if (environment.GITHUB_REF !== "refs/heads/main")
    throw new Error("CI cache writes require main");
  if (action === "proxy") await ciStart(port, context);
  else if (action === "publish") await ciFinish(context);
  else throw new Error("Expected proxy, publish, cleanup or local-config");
}

export async function main(): Promise<void> {
  const abort = new AbortController();
  const cancel = () => abort.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    const output = await namespaceCli(
      process.argv.slice(2),
      process.env,
      abort.signal,
    );
    if (output !== undefined) process.stdout.write(output);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Namespace cache command failed",
    );
    process.exitCode = abort.signal.aborted ? 130 : 1;
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}

if (
  process.argv[1] &&
  pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url
)
  await main();
