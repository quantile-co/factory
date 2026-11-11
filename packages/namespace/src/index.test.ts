import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { namespaceCli, withNixCache } from "./index.ts";

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "factory-namespace-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  const port = address.port;
  await new Promise<void>((done) => server.close(() => done()));
  const executable = (name: string, code: string) => {
    const path = join(bin, name);
    writeFileSync(path, `#!${process.execPath}\n${code}`);
    chmodSync(path, 0o755);
  };
  executable(
    "nixcache",
    `
if (process.env.NIX_CACHE_PRIVATE_KEY) process.exit(80);
const args = process.argv.slice(2), [host, port] = args[args.indexOf("-listen") + 1].split(":");
require("node:http").createServer((request, response) => response.end("StoreDir: /nix/store\\n")).listen(Number(port), host);
`,
  );
  executable(
    "nix",
    `
const fs = require("node:fs"), args = process.argv.slice(2);
if (process.env.NIX_CACHE_PRIVATE_KEY) process.exit(80);
if (args[0] === "key") {
  if (fs.readFileSync(0, "utf8") !== "fixture-private\\n") process.exit(81);
  console.log("fixture:public");
} else if (args[0] === "path-info") console.log("/nix/store/restored\\n/nix/store/built");
else if (args[0] === "copy") {
  const key = new URL(args[3]).searchParams.get("secret-key");
  if (fs.readFileSync(key, "utf8") !== "fixture-private\\n") process.exit(82);
  if ((fs.statSync(key).mode & 0o777) !== 0o600) process.exit(83);
  if (fs.readFileSync(0, "utf8") !== "/nix/store/restored\\n/nix/store/built\\n") process.exit(84);
  fs.writeFileSync(process.env.TEST_KEY_PATH, key);
  process.exit(Number(process.env.TEST_FAIL || "0"));
} else process.exit(85);
`,
  );
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    CI: "",
    XDG_CACHE_HOME: root,
    TEST_WORKSPACE: "private-workspace",
    TEST_ALLOWED: `http://127.0.0.1:${port}`,
    NIX_CONFIG:
      "substituters = https://quantile-co.cachix.org\ntrusted-public-keys = fixture:public upstream:public",
    RUNNER_TEMP: root,
    GITHUB_ENV: join(root, "environment"),
    GITHUB_REF: "refs/heads/main",
    NIX_CACHE_PUBLIC_KEY: "fixture:public",
    TEST_KEY_PATH: join(root, "key-path"),
  };
  return { root, port, env };
}

it("does not start a cache for other backends and keeps signing secrets out of task environments", async () => {
  const task = vi.fn(async (env: NodeJS.ProcessEnv) => {
    expect(env.NIX_CACHE_PRIVATE_KEY).toBeUndefined();
    expect(env.NIX_CONFIG).toBe("existing config");
    return "done";
  });
  expect(
    await withNixCache(task, {
      NIX_CONFIG: "existing config",
      NIX_CACHE_PRIVATE_KEY: "private",
    }),
  ).toBe("done");
  expect(task).toHaveBeenCalledOnce();
});

it("wraps the task, publishes restored paths, and always removes the key and stops its proxy", async () => {
  const f = await fixture();
  const env = {
    ...f.env,
    NIX_CACHE_PROVIDER: "namespace",
    NIX_CACHE_PORT: String(f.port),
    NIX_CACHE_PRIVATE_KEY: "fixture-private",
  };
  let directory = "";
  try {
    await expect(
      namespaceCli(["nixcache", "proxy"], {
        ...env,
        GITHUB_REF: "refs/heads/topic",
      }),
    ).rejects.toThrow("require main");
    for (const failure of ["task", "17", "0"]) {
      rmSync(env.TEST_KEY_PATH, { force: true });
      const result = withNixCache(
        async (taskEnv) => {
          expect(taskEnv.NIX_CACHE_PRIVATE_KEY).toBeUndefined();
          expect(taskEnv.NIX_CONFIG).toContain(
            "https://quantile-co.cachix.org",
          );
          expect(taskEnv.NIX_CONFIG).toContain(
            `extra-substituters = http://127.0.0.1:${f.port}`,
          );
          directory = taskEnv.NIXCACHE_STATE as string;
          if (failure === "task") throw new Error("Task failed");
          return "done";
        },
        { ...env, TEST_FAIL: failure === "17" ? "17" : "0" },
      );
      if (failure === "0") expect(await result).toBe("done");
      else
        await expect(result).rejects.toThrow(
          failure === "task" ? "Task failed" : "exit 17",
        );
      expect(existsSync(directory)).toBe(false);
      if (failure === "task") expect(existsSync(env.TEST_KEY_PATH)).toBe(false);
      else
        expect(existsSync(readFileSync(env.TEST_KEY_PATH, "utf8"))).toBe(false);
    }
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
