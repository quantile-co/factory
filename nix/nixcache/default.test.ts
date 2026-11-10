import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("starts one authenticated local-only proxy and refuses other workspaces or unmanaged listeners", async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const temporary = mkdtempSync(join(tmpdir(), "factory-nixcache-hook-"));
  const bin = join(temporary, "bin");
  mkdirSync(bin);
  const executable = (name: string, code: string) => {
    const path = join(bin, name);
    writeFileSync(path, `#!${process.execPath}\n${code}`);
    chmodSync(path, 0o755);
    return path;
  };
  executable(
    "nsc",
    `
if (process.argv[2] === "auth") process.exit(process.env.TEST_LOGIN === "yes" ? 0 : 1);
process.stdout.write(JSON.stringify({name: process.env.TEST_WORKSPACE, tenant_id: process.env.TEST_TENANT}));
`,
  );
  const binary = executable(
    "nixcache",
    `
const args = process.argv.slice(2);
if (!args.includes("-foreground") || !args.includes("-cache-upstream=local-only")) process.exit(81);
const listen = args[args.indexOf("-listen") + 1];
const [host, port] = listen.split(":");
require("node:http").createServer((request, response) => {
  response.end("StoreDir: /nix/store\\n");
}).listen(Number(port), host);
`,
  );
  const script = fileURLToPath(new URL("./setup.sh", import.meta.url));
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    CI: "",
    XDG_CACHE_HOME: temporary,
    NIXCACHE_BINARY: binary,
    TEST_LOGIN: "yes",
    TEST_WORKSPACE: "private-workspace",
    TEST_TENANT: "tenant_test",
  };
  const run = (overrides = {}) =>
    spawnSync(
      "bash",
      ["-euo", "pipefail", script, "private-workspace", String(port)],
      {
        env: { ...env, ...overrides },
        encoding: "utf8",
        timeout: 15_000,
      },
    );
  let pid: number | undefined;
  try {
    for (const overrides of [
      { CI: "true" },
      { TEST_LOGIN: "no" },
      { TEST_WORKSPACE: "wrong-workspace" },
    ]) {
      const result = run(overrides);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe("");
      expect(
        execFileSync("find", [temporary, "-name", "proxy"], {
          encoding: "utf8",
        }),
      ).toBe("");
    }
    const started = run();
    expect(started.status, started.stderr).toBe(0);
    expect(started.stdout.trim()).toBe(`http://127.0.0.1:${port}`);
    const state = join(
      temporary,
      "nixcache",
      "tenant_test",
      String(port),
      "proxy",
    );
    const record = readFileSync(state, "utf8");
    pid = Number(record.split(" ")[0]);
    expect(run().stdout).toBe(started.stdout);
    expect(readFileSync(state, "utf8")).toBe(record);
    const otherTenant = run({ TEST_TENANT: "tenant_other" });
    expect(otherTenant.status, otherTenant.stderr).toBe(0);
    expect(otherTenant.stdout).toBe("");
    expect(otherTenant.stderr).toContain("unmanaged proxy");
    process.kill(pid, 0);
    writeFileSync(state, `${process.pid} ${binary}\n`);
    const stale = run();
    expect(stale.stdout).toBe("");
    expect(stale.stderr).toContain("unmanaged proxy");
    writeFileSync(state, record);
    expect(
      execFileSync("find", [temporary, "-name", "start.lock"], {
        encoding: "utf8",
      }),
    ).toBe("");
  } finally {
    if (pid) process.kill(pid, "SIGTERM");
    rmSync(temporary, { recursive: true, force: true });
  }
});
