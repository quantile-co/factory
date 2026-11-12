import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  connect,
  identity,
  orbPeers,
  pinHostKeys,
  resume,
  resumeCollector,
  resumeScript,
  setupScript,
} from "./index.ts";

const thread = "T-12345678-1234-1234-1234-123456789abc";
it("keys machines by thread, starts labels with org/repo and rejects unsafe input", () => {
  const orb = {
    thread,
    repository: "quantile-co/factory",
    issue: 123,
    title: "Fix cache",
  };
  expect(identity(orb)).toEqual({
    thread,
    hostname: "amp-12345678-1234-1234-1234-123456789abc",
    label: "quantile-co/factory · #123 Fix cache · T-56789abc",
  });
  expect(
    identity({ ...orb, thread: `https://ampcode.com/threads/${thread}` }),
  ).toEqual(identity(orb));
  expect(identity({ thread, project: "Scratch" }).label).toMatch(
    /^Scratch · T-/,
  );
  expect(
    identity({ ...orb, thread: thread.replace("12345678-", "abcdefab-") })
      .hostname,
  ).not.toBe(identity(orb).hostname);
  for (const invalid of [
    { ...orb, thread: "T-$(touch nope)" },
    { ...orb, repository: "just-a-repo" },
    { ...orb, issue: -1 },
    { ...orb, title: "line\nbreak" },
    { ...orb, title: "x".repeat(129) },
    { thread, issue: 123 },
  ])
    expect(() => identity(invalid)).toThrow();
  expect(
    orbPeers({
      Peer: {
        one: { HostName: "orb", Tags: ["tag:amp-orb"], Online: false },
        two: { HostName: "laptop", Online: true },
      },
    }),
  ).toEqual([{ HostName: "orb", Tags: ["tag:amp-orb"], Online: false }]);
});

it("lifecycle scripts parse but refuse execution outside an orb before service commands", async () => {
  for (const script of [
    setupScript,
    resumeScript,
    ...["setup", "resume"].map((hook) =>
      readFileSync(
        new URL(`../../../.agents/${hook}`, import.meta.url),
        "utf8",
      ),
    ),
  ]) {
    expect(spawnSync("bash", ["-n"], { input: script }).status).toBe(0);
    const lint = spawnSync(
      "shellcheck",
      ["--external-sources", "--shell=bash", "-"],
      {
        cwd: new URL("../../../", import.meta.url),
        input: script,
        encoding: "utf8",
      },
    );
    expect(lint.status, lint.stdout + lint.stderr).toBe(0);
    const result = spawnSync("bash", ["-euo", "pipefail", "-c", script], {
      env: { AMP_ORB: "0" },
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("only for an Amp orb");
  }
  vi.stubEnv("AMP_ORB", "0");
  try {
    await expect(resume({ thread }, "/")).rejects.toThrow(
      "only for an Amp orb",
    );
  } finally {
    vi.unstubAllEnvs();
  }
});

it.each(["none", "tee", "restart"])(
  "refreshes collector credentials through native stdin, cleans up and fails open (%s failure)",
  (failure) => {
    const directory = mkdtempSync(join(tmpdir(), "factory-orb-otel-"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const record = join(directory, "operations");
      const sudo = join(directory, "sudo");
      const file = join(directory, "otel.env");
      writeFileSync(
        sudo,
        `#!${process.execPath}
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(3);
const file = ${JSON.stringify(file)};
fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify(args) + '\\n');
if (args[0] === 'tee') {
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(file, 'utf8'), '');
}
if (['install', 'tee', 'rm'].includes(args[0])) {
  // Inherit Node's actual stdin descriptor: reopening /dev/stdin fails on Linux.
  const result = spawnSync(args[0], args.slice(1).map(arg =>
    arg === '/run/factory-amp/otel.env' ? file : arg), { stdio: 'inherit' });
  if (result.status !== 0) process.exit(1);
}
if (args.includes('restart')) {
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.ok(fs.readFileSync(file, 'utf8').includes('CLICKSTACK_API_KEY="fixture-runtime-key"\\n'));
}
if (args.includes(${JSON.stringify(failure)})) { console.error('PRIVATE_ERROR'); process.exit(1); }
if (args.includes('is-active')) process.exit(3);
`,
      );
      chmodSync(sudo, 0o755);
      vi.stubEnv("PATH", `${directory}:${process.env.PATH}`);
      vi.stubEnv("AMP_ORB", "1");
      vi.stubEnv("CLICKSTACK_OTLP_ENDPOINT", "https://ingest.example.invalid");
      vi.stubEnv("CLICKSTACK_API_KEY", "fixture-runtime-key");
      expect(() => resumeCollector("org/repo", thread)).not.toThrow();
      const operations = readFileSync(record, "utf8");
      expect(
        operations
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line)),
      ).toEqual([
        ["systemctl", "stop", "factory-amp-otel.service"],
        ["install", "-m", "0600", "/dev/null", "/run/factory-amp/otel.env"],
        ["tee", "/run/factory-amp/otel.env"],
        ...(failure === "tee"
          ? []
          : [["systemctl", "restart", "factory-amp-otel.service"]]),
        ["rm", "-f", "/run/factory-amp/otel.env"],
      ]);
      expect(() => statSync(file)).toThrow(/ENOENT/);
      expect(log.mock.calls).toEqual(
        failure === "none"
          ? []
          : [["OTel orb collector unavailable; resume continues."]],
      );
      expect(JSON.stringify(log.mock.calls)).not.toMatch(
        /fixture-runtime-key|PRIVATE_ERROR/,
      );
      writeFileSync(record, "");
      log.mockClear();
      vi.stubEnv("CLICKSTACK_OTLP_ENDPOINT", "");
      vi.stubEnv("CLICKSTACK_API_KEY", "");
      resumeCollector("org/repo", thread);
      expect(readFileSync(record, "utf8")).not.toContain('"stop"');
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      vi.unstubAllEnvs();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it.each(["1.104.5", "1.104.1"])(
  "prepares only safe Tailscale SSH snapshots (%s)",
  (version) => {
    const home = mkdtempSync(join(tmpdir(), "factory-amp-setup-"));
    try {
      // Match a downstream pnpm install, not Factory's unscoped workspace path.
      const artifacts = join(
        home,
        "node_modules/.pnpm/@quantile-co+factory-otel@0.1.0/node_modules/@quantile-co/factory-otel/dist",
      );
      mkdirSync(artifacts, { recursive: true });
      writeFileSync(join(artifacts, "cli.js"), "import './chunk.js';");
      writeFileSync(join(artifacts, "chunk.js"), "export {};");
      writeFileSync(join(home, "host.yaml"), "host fixture");
      writeFileSync(join(home, "docker.yaml"), "docker fixture");
      const collector = join(home, ".local/share/factory-amp/otel");
      mkdirSync(collector, { recursive: true });
      for (const name of ["host", "docker"]) {
        chmodSync(join(home, `${name}.yaml`), 0o444);
        writeFileSync(join(collector, `${name}.yaml`), "stale config", {
          mode: 0o444,
        });
      }
      // Mock privileged operations; only the temporary HOME is written.
      const result = spawnSync(
        "bash",
        [
          "--noprofile",
          "--norc",
          "-euo",
          "pipefail",
          "-c",
          `
command() {
  if [ "$2" = node ]; then printf '/nix/store/fixture-node/bin/node\\n';
  else printf '/pinned/bin/%s\\n' "$2"; fi
}
tailscale() { printf '%s\\n' "$VERSION"; }
sudo() {
  printf '%s\\n' "$*" >> "$HOME/operations"
  if [ "$1" = tee ]; then
    while IFS= read -r line; do printf '%s\\n' "$line" >> "$HOME/units"; done
  fi
  if [ "$1" = systemctl ] && [ "$2" = is-active ]; then return 1; fi
  return 0
}
readlink() { printf '%s\\n' "$2"; }
nix-store() { printf '%s\\n' "$*" >> "$HOME/operations"; }
${setupScript}
`,
        ],
        {
          env: {
            HOME: home,
            AMP_ORB: "1",
            VERSION: version,
            PATH: process.env.PATH,
            CLICKSTACK_API_KEY: "fixture-not-for-snapshots",
            FACTORY_AMP_OTEL_CLI: join(artifacts, "cli.js"),
            OTEL_COLLECTOR_BINARY:
              "/nix/store/fixture-collector/bin/otelcol-contrib",
            OTEL_COLLECTOR_CONFIG: join(home, "host.yaml"),
            OTEL_COLLECTOR_DOCKER_CONFIG: join(home, "docker.yaml"),
          },
          encoding: "utf8",
        },
      );
      if (version === "1.104.1") {
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(">= 1.104.4");
        return;
      }
      expect(result.status, result.stdout + result.stderr).toBe(0);
      for (const name of ["host", "docker"]) {
        const config = join(collector, `${name}.yaml`);
        expect(readFileSync(config, "utf8")).toBe(`${name} fixture`);
        expect(statSync(config).mode & 0o777).toBe(0o644);
      }
      const units = readFileSync(join(home, "units"), "utf8");
      expect(units).toContain("Environment=TS_SSH_DISABLE_FORWARDING=1");
      expect(units).toContain("InaccessiblePaths=-/etc/ssh/ssh_host_rsa_key");
      expect(units).toContain("EnvironmentFile=/run/factory-amp/otel.env");
      expect(units).not.toMatch(
        /fixture-not-for-snapshots|ExecStart=.*sshd|authorized_keys/,
      );
      expect(units).toContain(
        `ExecStart=/nix/store/fixture-node/bin/node ${home}/.local/share/factory-amp/otel/cli.js collector`,
      );
      expect(
        readFileSync(
          join(home, ".local/share/factory-amp/otel/chunk.js"),
          "utf8",
        ),
      ).toBe("export {};");
      const operations = readFileSync(join(home, "operations"), "utf8");
      expect(operations).toContain(
        "--indirect --realise /nix/store/fixture-node",
      );
      expect(operations).toContain(
        "--indirect --realise /nix/store/fixture-collector",
      );
      expect(operations).not.toMatch(/restart|useradd/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  },
);

it("pins authenticated public keys once, handles hashed entries, and rejects rotation or malformed input", () => {
  const home = mkdtempSync(join(tmpdir(), "factory-amp-trust-"));
  try {
    const keyPath = join(home, "fixture");
    expect(
      spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", keyPath])
        .status,
    ).toBe(0);
    const key = readFileSync(`${keyPath}.pub`, "utf8")
      .trim()
      .split(" ")
      .slice(0, 2)
      .join(" ");
    const host = "amp-test.tail.example";
    const file = join(home, ".ssh", "known_hosts");
    expect(() => pinHostKeys(host, [], file)).toThrow("No Tailscale SSH");
    expect(() => pinHostKeys(host, [`${key}\ninjection`], file)).toThrow(
      "Invalid",
    );
    pinHostKeys(host, [key], file);
    const initial = readFileSync(file, "utf8");
    pinHostKeys(host, [key], file);
    expect(readFileSync(file, "utf8")).toBe(initial);
    expect(spawnSync("ssh-keygen", ["-H", "-f", file]).status).toBe(0);
    const hashed = readFileSync(file, "utf8");
    pinHostKeys(host, [key], file);
    expect(readFileSync(file, "utf8")).toBe(hashed);
    const other = join(home, "other");
    expect(
      spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", other])
        .status,
    ).toBe(0);
    const changed = readFileSync(`${other}.pub`, "utf8")
      .trim()
      .split(" ")
      .slice(0, 2)
      .join(" ");
    expect(() => pinHostKeys(host, [changed], file)).toThrow("changed");
    expect(readFileSync(file, "utf8")).toBe(hashed);
    writeFileSync(file, `@revoked ${host} ${key}\n`);
    expect(() => pinHostKeys(host, [key], file)).toThrow("trust marker");
    expect(() => pinHostKeys("-unsafe", [key], file)).toThrow("hostname");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

it("verifies Tailscale-pinned SSH before native Herdr setup and stops on SSH failure", () => {
  const home = mkdtempSync(join(tmpdir(), "factory-amp-connect-"));
  try {
    const keyPath = join(home, "fixture");
    expect(
      spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", keyPath])
        .status,
    ).toBe(0);
    const key = readFileSync(`${keyPath}.pub`, "utf8")
      .trim()
      .split(" ")
      .slice(0, 2)
      .join(" ");
    const peer = {
      HostName: identity({ thread }).hostname,
      DNSName: "amp-fixture.tail.example.",
      Online: true,
      Tags: ["tag:amp-orb"],
      sshHostKeys: [key],
    };
    const record = join(home, "operations");
    for (const command of ["tailscale", "ssh", "herdr"]) {
      const file = join(home, command);
      writeFileSync(
        file,
        `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify([${JSON.stringify(command)}, ...args]) + "\\n");
if (${JSON.stringify(command)} === "tailscale") console.log(${JSON.stringify(JSON.stringify({ Peer: { orb: peer } }))});
if (${JSON.stringify(command)} === "herdr" && args[1] === "list") console.log("[]");
if (${JSON.stringify(command)} === "ssh" && process.env.FIXTURE_SSH_FAIL) process.exit(1);
`,
      );
      chmodSync(file, 0o755);
    }
    vi.stubEnv("HOME", home);
    vi.stubEnv("PATH", `${home}:${process.env.PATH}`);
    connect({ thread });
    const calls = readFileSync(record, "utf8");
    expect(calls).toContain("StrictHostKeyChecking=yes");
    expect(calls).toContain("ControlPath=none");
    expect(calls).toContain(
      '["herdr","machine","add","user@amp-fixture.tail.example"',
    );
    expect(calls).toContain('"--remote-session","orb"');
    expect(readFileSync(join(home, ".ssh/known_hosts"), "utf8")).toContain(key);
    writeFileSync(record, "");
    vi.stubEnv("FIXTURE_SSH_FAIL", "1");
    expect(() => connect({ thread })).toThrow();
    expect(readFileSync(record, "utf8")).not.toContain('"herdr"');
  } finally {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  }
});

it("refuses legacy resume before changing runtime identity or services", () => {
  const home = mkdtempSync(join(tmpdir(), "factory-amp-legacy-"));
  try {
    const result = spawnSync(
      "bash",
      [
        "-euo",
        "pipefail",
        "-c",
        `
sudo() {
  if [ "$1" = test ]; then return 1; fi
  [ "$1" = -n ]
}
${resumeScript}
`,
      ],
      {
        env: {
          HOME: home,
          AMP_ORB: "1",
          TAILSCALE_CLIENT_ID: "fixture",
          TAILSCALE_AUDIENCE: "fixture",
          FACTORY_AMP_THREAD: thread,
          FACTORY_AMP_HOSTNAME: "amp-test",
          PATH: process.env.PATH,
        },
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Legacy orb");
    expect(
      spawnSync("test", ["-e", join(home, ".local/state/factory-amp/thread")])
        .status,
    ).toBe(1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
