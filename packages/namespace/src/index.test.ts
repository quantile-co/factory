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
import { namespaceCli } from "./index.ts";

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
    "nsc",
    `
if (process.env.NIX_CACHE_PRIVATE_KEY) process.exit(80);
if (process.argv[2] === "auth") process.exit(process.env.TEST_LOGIN === "no" ? 1 : 0);
console.log(JSON.stringify({name: process.env.TEST_WORKSPACE, tenant_id: "tenant_test"}));
`,
  );
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
if (args[0] === "config") {
  if (args[2] === "trusted-substituters") console.log(process.env.TEST_ALLOWED);
  else {
    const prefix = args[2] + " = ";
    console.log(process.env.NIX_CONFIG.split("\\n").filter(line => line.startsWith(prefix)).at(-1)?.slice(prefix.length) || "");
  }
} else if (args[0] === "store") console.log(JSON.stringify({trusted: process.env.TEST_TRUSTED === "yes"}));
else if (args[0] === "key") {
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

it("reuses an authenticated local reader and preserves public caches and administrator trust", async () => {
  const f = await fixture();
  const warning = vi.spyOn(console, "error").mockImplementation(() => {});
  let pid: number | undefined;
  const args = [
    "nixcache",
    "local-config",
    "--workspace",
    "private-workspace",
    "--public-key",
    "fixture:public",
    "--port",
    String(f.port),
  ];
  try {
    expect(await namespaceCli(args, { ...f.env, TEST_LOGIN: "no" })).toBe(
      f.env.NIX_CONFIG,
    );
    expect(
      await namespaceCli(args, { ...f.env, TEST_WORKSPACE: "other" }),
    ).toBe(f.env.NIX_CONFIG);
    const config = await namespaceCli(args, f.env);
    expect(config).toContain(
      `substituters = http://127.0.0.1:${f.port} https://quantile-co.cachix.org`,
    );
    expect(config?.match(/trusted-public-keys =/g)).toHaveLength(1);
    const record = join(
      f.root,
      "nixcache/tenant_test",
      String(f.port),
      "proxy",
    );
    const before = readFileSync(record, "utf8");
    pid = Number(before.split(" ")[0]);
    expect(await namespaceCli(args, { ...f.env, NIX_CONFIG: config })).toBe(
      config,
    );
    expect(readFileSync(record, "utf8")).toBe(before);
  } finally {
    if (pid) process.kill(pid, "SIGTERM");
    warning.mockRestore();
    rmSync(f.root, { recursive: true, force: true });
  }
});

it("publishes restored and built paths without leaking the key and cleans up after a failed upload", async () => {
  const f = await fixture();
  const env: NodeJS.ProcessEnv = { ...f.env, TEST_TRUSTED: "yes" };
  try {
    await expect(
      namespaceCli(["nixcache", "proxy"], {
        ...env,
        GITHUB_REF: "refs/heads/topic",
      }),
    ).rejects.toThrow("require main");
    await namespaceCli(["nixcache", "proxy", "--port", String(f.port)], env);
    const variables = readFileSync(env.GITHUB_ENV as string, "utf8");
    for (const match of variables.matchAll(
      /^(\w+)<<(NIXCACHE_\w+)\n([\s\S]*?)\n\2\n/gm,
    ))
      env[match[1]] = match[3];
    env.NIX_CACHE_PRIVATE_KEY = "fixture-private";
    for (const failure of ["17", "0"]) {
      env.TEST_FAIL = failure;
      const result = namespaceCli(["nixcache", "publish"], env);
      if (failure === "0") await result;
      else await expect(result).rejects.toThrow("exit 17");
      expect(
        existsSync(readFileSync(env.TEST_KEY_PATH as string, "utf8")),
      ).toBe(false);
    }
  } finally {
    await namespaceCli(["nixcache", "cleanup"], env);
    if (env.NIXCACHE_STATE) expect(existsSync(env.NIXCACHE_STATE)).toBe(false);
    rmSync(f.root, { recursive: true, force: true });
  }
});
