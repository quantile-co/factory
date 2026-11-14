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
  resumeGuardScript,
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

it("retains early hook stdout/stderr privately, appends on resume and preserves failure", () => {
  const home = mkdtempSync(join(tmpdir(), "factory-amp-logs-"));
  const capture = readFileSync(
    new URL("../../../.agents/log-output", import.meta.url),
    "utf8",
  );
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = spawnSync(
        "bash",
        [
          "-euo",
          "pipefail",
          "-c",
          `${capture}\nprintf 'early stdout\\n'; printf 'early stderr\\n' >&2; exit 17`,
          "resume",
        ],
        {
          env: { HOME: home, PATH: process.env.PATH },
          encoding: "utf8",
          timeout: 5000,
        },
      );
      expect(result.status).toBe(17);
      expect(result.stdout).toBe("early stdout\nearly stderr\n");
    }
    const log = join(home, ".local/share/factory-amp/logs/resume.log");
    expect(readFileSync(log, "utf8")).toBe(
      "early stdout\nearly stderr\n".repeat(2),
    );
    expect(statSync(log).mode & 0o777).toBe(0o600);
    expect(
      spawnSync("test", ["-e", join(home, ".local/state/factory-amp")]).status,
    ).toBe(1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

it("installs skills before building the orb runtime and stops on provisioning failure", () => {
  const directory = mkdtempSync(join(tmpdir(), "factory-orb-provision-"));
  const log = join(directory, "calls");
  const hook = readFileSync(
    new URL("../../../.agents/setup", import.meta.url),
    "utf8",
  );
  const command = hook.match(/bash -euo pipefail -c '([\s\S]+)'/)?.[1];
  const expected = [
    "install --frozen-lockfile",
    "run skills:sync",
    "run build",
    "amp setup",
  ];
  try {
    expect(command).toBeDefined();
    for (const tool of ["pnpm", "install"]) {
      const path = join(directory, tool);
      writeFileSync(
        path,
        `#!${process.execPath}
const args = process.argv.slice(2).join(" ");
if (${JSON.stringify(tool)} === "pnpm") {
  require("node:fs").appendFileSync(${JSON.stringify(log)}, args + "\\n");
  if (args === process.env.FAIL_COMMAND) process.exit(17);
}
`,
      );
      chmodSync(path, 0o755);
    }
    for (const failCommand of ["", ...expected.slice(0, 2)]) {
      writeFileSync(log, "");
      const result = spawnSync("bash", ["-euo", "pipefail"], {
        input: command,
        encoding: "utf8",
        env: {
          PATH: `${directory}:${process.env.PATH}`,
          HOME: directory,
          FAIL_COMMAND: failCommand,
        },
      });
      expect(result.status, result.stderr).toBe(failCommand ? 17 : 0);
      expect(readFileSync(log, "utf8").trim().split("\n")).toEqual(
        failCommand
          ? expected.slice(0, expected.indexOf(failCommand) + 1)
          : expected,
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
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
if (['mkdir', 'install', 'tee', 'rm'].includes(args[0])) {
  // Inherit Node's actual stdin descriptor: reopening /dev/stdin fails on Linux.
  const result = spawnSync(args[0], args.slice(1).map(arg =>
    arg === '/run/factory-amp/otel.env' ? file :
    arg === '/run/factory-amp' ? ${JSON.stringify(join(directory, "run"))} : arg), { stdio: 'inherit' });
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
      vi.stubEnv("HOME", directory);
      // No selected journal/config in this fixture: optional journal capture
      // must not prevent the base Collector's credential refresh/restart.
      vi.stubEnv("OTEL_JOURNALD", failure === "none" ? "1" : "0");
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
        ["mkdir", "-p", "/run/factory-amp"],
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
          ? [
              [
                "OTel journal access unqualified; continuing with file logs and metrics.",
              ],
            ]
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
      writeFileSync(join(home, "config.yaml"), "config fixture");
      writeFileSync(join(home, "docker.yaml"), "docker fixture");
      writeFileSync(join(home, "journald.yaml"), "journald fixture");
      const collector = join(home, ".local/share/factory-amp/otel");
      mkdirSync(collector, { recursive: true });
      for (const name of ["config", "docker"]) {
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
            OTEL_COLLECTOR_BINARY:
              "/nix/store/fixture-collector/bin/otelcol-contrib",
            OTEL_COLLECTOR_CONFIG: join(home, "config.yaml"),
            OTEL_COLLECTOR_DOCKER_CONFIG: join(home, "docker.yaml"),
            OTEL_COLLECTOR_JOURNAL_CONFIG: join(home, "journald.yaml"),
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
      for (const name of ["config", "docker", "journald"]) {
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
        `ExecStart=/nix/store/fixture-collector/bin/otelcol-contrib --config=${home}/.local/share/factory-amp/otel/config.yaml $OTEL_COLLECTOR_EXTRA_ARGS`,
      );
      expect(units).toContain("StandardError=journal");
      expect(units).toContain("UMask=0077");
      expect(units).toContain("TimeoutStopSec=30");
      const operations = readFileSync(join(home, "operations"), "utf8");
      expect(operations).not.toContain(
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

it.each(["legacy", "wrong-thread"])(
  "refuses %s resume before service startup",
  (failure) => {
    const home = mkdtempSync(join(tmpdir(), "factory-amp-guard-"));
    try {
      const state = join(home, ".local/state/factory-amp");
      if (failure === "wrong-thread") {
        mkdirSync(state, { recursive: true });
        writeFileSync(join(state, "thread"), "another-thread");
      }
      const result = spawnSync(
        "bash",
        [
          "-euo",
          "pipefail",
          "-c",
          `
sudo() {
  if [ "$1" = test ]; then [ "$FAILURE" != legacy ]; return; fi
  if [ "$1" = systemctl ]; then touch "$HOME/service-started"; fi
  [ "$1" = -n ]
}
${resumeGuardScript}
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
            FAILURE: failure,
            PATH: process.env.PATH,
          },
          encoding: "utf8",
        },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        failure === "legacy" ? "Legacy orb" : "another thread",
      );
      expect(
        spawnSync("test", ["-e", join(home, "service-started")]).status,
      ).toBe(1);
      if (failure === "wrong-thread")
        expect(readFileSync(join(state, "thread"), "utf8")).toBe(
          "another-thread",
        );
      else
        expect(spawnSync("test", ["-e", join(state, "thread")]).status).toBe(1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  },
);
