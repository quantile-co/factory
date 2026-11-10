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
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("manages an authenticated reader proxy and honors native Nix trust without removing public caches", async () => {
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
  executable(
    "nix",
    `
const args = process.argv.slice(2);
if (args[0] === "store") {
  process.stdout.write(JSON.stringify({ trusted: process.env.TEST_TRUSTED === "yes" }));
} else if (args[2] === "trusted-substituters") {
  process.stdout.write(process.env.TEST_ALLOWED || "");
} else {
  const prefix = args[2] + " = ";
  const lines = process.env.NIX_CONFIG.split("\\n").filter(line => line.startsWith(prefix));
  process.stdout.write(lines.at(-1)?.slice(prefix.length) || "");
}
`,
  );
  const binary = executable(
    "nixcache",
    `
const args = process.argv.slice(2);
if (!args.includes("-foreground") || !args.includes("-cache-upstream=local-only")) process.exit(81);
const [host, port] = args[args.indexOf("-listen") + 1].split(":");
require("node:http").createServer((request, response) => {
  response.end("StoreDir: /nix/store\\n");
}).listen(Number(port), host);
`,
  );
  const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
  const hook = execFileSync(
    "nix",
    [
      "eval",
      "--impure",
      "--raw",
      "--expr",
      `let
    flake = builtins.getFlake ${JSON.stringify(`git+file://${root}`)};
    pkgs = import flake.inputs.nixpkgs { system = builtins.currentSystem; };
    fixture = { type = "derivation"; name = "fixture"; outPath = ${JSON.stringify(temporary)}; };
    cfg = (pkgs.lib.evalModules {
      specialArgs.pkgs = pkgs // {
        namespace-cli = fixture;
        nix = fixture // { meta.mainProgram = "nix"; };
      };
      modules = [ ${root}/nix/nixcache {
        quantile-co.factory.nixcache = {
          workspace = "private-workspace";
          publicKey = "fixture-cache:public";
          port = ${port};
          package = fixture // { meta.mainProgram = "nixcache"; };
        };
      } ];
    }).config.quantile-co.factory.nixcache;
  in cfg.shellHook`,
    ],
    { encoding: "utf8" },
  );
  const lint = spawnSync("shellcheck", ["-s", "bash", "-"], {
    input: hook,
    encoding: "utf8",
  });
  expect(lint.status, lint.stdout + lint.stderr).toBe(0);
  const base =
    "substituters = https://public.example.invalid\ntrusted-public-keys = upstream:public";
  const admin = `${base} fixture-cache:public`;
  const env = {
    ...process.env,
    CI: "",
    XDG_CACHE_HOME: temporary,
    NIX_CONFIG: base,
    TEST_LOGIN: "yes",
    TEST_WORKSPACE: "private-workspace",
    TEST_TENANT: "tenant_test",
    TEST_TRUSTED: "yes",
    TEST_ALLOWED: `http://127.0.0.1:${port}`,
  };
  const run = (overrides = {}, repetitions = 1) =>
    spawnSync(
      "bash",
      [
        "-euo",
        "pipefail",
        "-c",
        `${hook.repeat(repetitions)}\nprintf '%s' "$NIX_CONFIG"`,
      ],
      { env: { ...env, ...overrides }, encoding: "utf8", timeout: 15_000 },
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
      expect(result.stdout).toBe(base);
      expect(
        execFileSync("find", [temporary, "-name", "proxy"], {
          encoding: "utf8",
        }),
      ).toBe("");
    }
    const allowed = run({ TEST_TRUSTED: "no", NIX_CONFIG: admin });
    expect(allowed.status, allowed.stderr).toBe(0);
    expect(allowed.stdout).toContain(
      `substituters = http://127.0.0.1:${port} https://public.example.invalid`,
    );
    expect(allowed.stdout.match(/trusted-public-keys =/g)).toHaveLength(1);
    const state = join(
      temporary,
      "nixcache",
      "tenant_test",
      String(port),
      "proxy",
    );
    const record = readFileSync(state, "utf8");
    pid = Number(record.split(" ")[0]);
    const trusted = run();
    expect(trusted.status, trusted.stderr).toBe(0);
    expect(trusted.stdout).toContain(
      "trusted-public-keys = fixture-cache:public upstream:public",
    );
    expect(run({}, 2).stdout).toBe(trusted.stdout);
    expect(readFileSync(state, "utf8")).toBe(record);
    for (const overrides of [
      { TEST_TRUSTED: "no", TEST_ALLOWED: "", NIX_CONFIG: admin },
      { TEST_TRUSTED: "no" },
    ]) {
      const result = run(overrides);
      expect(result.stdout).toBe(overrides.NIX_CONFIG ?? base);
      expect(result.stderr).toContain("ask your Nix administrator");
    }
    const otherTenant = run({ TEST_TENANT: "tenant_other" });
    expect(otherTenant.stdout).toBe(base);
    expect(otherTenant.stderr).toContain("unmanaged proxy");
    process.kill(pid, 0);
    writeFileSync(state, `${process.pid} ${binary}\n`);
    const stale = run();
    expect(stale.stdout).toBe(base);
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
