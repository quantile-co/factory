import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  identity,
  orbPeers,
  resume,
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
