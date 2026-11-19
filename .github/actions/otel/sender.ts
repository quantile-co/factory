// Job-local supervisor for the pinned upstream Collector. Only this process
// needs the GitHub request credential; the exporter watches the private ID file.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

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
  const audience = process.env.QUANTILE_OTLP_ENDPOINT!;
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
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [directory, binary, ...args] = process.argv.slice(2);
  supervise(directory, binary, args).catch(() => {
    console.error("Collector identity or process unavailable");
    process.exitCode = 1;
  });
}
