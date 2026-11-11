import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  identity,
  orbPeers,
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
    const lint = spawnSync("shellcheck", ["--shell=bash", "-"], {
      input: script,
      encoding: "utf8",
    });
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
    await expect(resume({ thread }, "/", "/missing")).rejects.toThrow(
      "only for an Amp orb",
    );
  } finally {
    vi.unstubAllEnvs();
  }
});

it("refreshes orb collector runtime credentials without arguments or persistent files, and fails open", () => {
  const directory = mkdtempSync(join(tmpdir(), "factory-orb-otel-"));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const record = join(directory, "operations");
    const sudo = join(directory, "sudo");
    writeFileSync(
      sudo,
      `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(3);
fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify(args) + '\\n');
if (args[0] === 'install') fs.appendFileSync(${JSON.stringify(record)}, fs.readFileSync(0, 'utf8'));
if (args.includes('restart')) { console.error('PRIVATE_ERROR'); process.exit(1); }
if (args.includes('is-active')) process.exit(3);
`,
    );
    chmodSync(sudo, 0o755);
    vi.stubEnv("PATH", directory);
    vi.stubEnv("AMP_ORB", "1");
    vi.stubEnv("CLICKSTACK_OTLP_ENDPOINT", "https://ingest.example.invalid");
    vi.stubEnv("CLICKSTACK_API_KEY", "fixture-runtime-key");
    expect(() => resumeCollector("org/repo", thread)).not.toThrow();
    const operations = readFileSync(record, "utf8");
    expect(operations).toContain(
      '["install","-m","0600","/dev/stdin","/run/factory-amp/otel.env"]',
    );
    expect(operations).toContain('CLICKSTACK_API_KEY="fixture-runtime-key"');
    expect(
      operations.trim().endsWith('["rm","-f","/run/factory-amp/otel.env"]'),
    ).toBe(true);
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
});

it.each([true, false])(
  "resolves account tools only when sshd is missing (exists=%s)",
  (exists) => {
    const home = mkdtempSync(join(tmpdir(), "factory-amp-setup-"));
    try {
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
: > "$HOME/lookups"
command() {
  case "$2" in
    useradd|nologin)
      printf '%s\\n' "$2" >> "$HOME/lookups"
      [ "$ACCOUNT_EXISTS" = 0 ] || return 1
      [[ ":$PATH:" == *:/usr/sbin:* && "$PATH" == /pinned/bin:* ]] || return 1
      printf '/usr/sbin/%s\\n' "$2"
      ;;
    *) printf '/pinned/bin/%s\\n' "$2" ;;
  esac
}
getent() { [ "$ACCOUNT_EXISTS" = 1 ]; }
sudo() {
  printf '%s\\n' "$*" >> "$HOME/operations"
  if [ "$1" = tee ]; then
    while IFS= read -r line; do printf '%s\\n' "$line" >> "$HOME/units"; done
  fi
  if [ "$1" = systemctl ] && [ "$2" = is-active ]; then return 1; fi
  return 0
}
readlink() { printf '%s\\n' "$2"; }
${setupScript}
`,
        ],
        {
          env: {
            HOME: home,
            AMP_ORB: "1",
            ACCOUNT_EXISTS: exists ? "1" : "0",
            CLICKSTACK_API_KEY: "fixture-not-for-snapshots",
            PATH: `/pinned/bin:${process.env.PATH?.split(":")
              .filter((path) => !path.endsWith("/sbin"))
              .join(":")}`,
          },
          encoding: "utf8",
        },
      );
      expect(result.status, result.stdout + result.stderr).toBe(0);
      const lookups = readFileSync(join(home, "lookups"), "utf8");
      const operations = readFileSync(join(home, "operations"), "utf8");
      expect(readFileSync(join(home, "units"), "utf8")).toContain(
        "Type=notify\nTimeoutStartSec=15\n",
      );
      const units = readFileSync(join(home, "units"), "utf8");
      expect(units).toContain("EnvironmentFile=/run/factory-amp/otel.env");
      expect(units).not.toContain("fixture-not-for-snapshots");
      if (exists) {
        expect(lookups).toBe("");
        expect(operations).not.toContain("useradd");
      } else {
        expect(lookups).toContain("useradd");
        expect(lookups).toContain("nologin");
        expect(operations).toContain("/usr/sbin/useradd --system");
        expect(operations).toContain("--shell /usr/sbin/nologin sshd");
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  },
);
