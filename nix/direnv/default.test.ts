import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it.each([
  { info: '{"trusted":true}', status: 0, caches: true },
  { info: '{"trusted":false}', status: 0, caches: false },
  { info: "{}", status: 0, caches: false },
  { info: "", status: 9, caches: false },
])("bootstraps only after store discovery: $info / $status", (test) => {
  const root = mkdtempSync(join(tmpdir(), "factory-direnv-"));
  try {
    writeFileSync(
      join(root, ".envrc.local"),
      'export NIX_CONFIG="sandbox = true\nrequire-sigs = true"\n',
    );
    const run = spawnSync(
      "bash",
      [
        "-c",
        `
strict_env() { set -euo pipefail; }
source_env_if_exists() { [[ ! -f "$1" ]] || source "$1"; }
nix() { printf '%s' "$STORE_INFO"; return "$STORE_STATUS"; }
use() { [[ "$*" == flake ]]; printf 'flake\\n' >> "$LOG"; }
source "$1" || exit $?
printf '%s' "$NIX_CONFIG"
`,
        "fixture",
        fileURLToPath(new URL("../../etc/direnv/.envrc", import.meta.url)),
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          STORE_INFO: test.info,
          STORE_STATUS: String(test.status),
          LOG: join(root, "order"),
        },
      },
    );
    if (run.error) throw run.error;
    expect(run.status, run.stderr).toBe(test.status);
    for (const hook of ["setup", "resume"]) {
      const configFile = join(root, `${hook}-config`);
      const hookRun = spawnSync(
        "bash",
        [
          "-c",
          `
nix() {
  # Both store discovery and evaluation must exclude runtime credentials.
  bash -c '[[ ! -v CLICKSTACK_API_KEY && ! -v CLICKSTACK_OTLP_ENDPOINT && ! -v OTEL_DOCKER_STATS ]]' || return 99
  if [[ "$*" == "store info --json" ]]; then
    printf '%s' "$STORE_INFO"
    return "$STORE_STATUS"
  fi
  [[ "$1" == develop || "$1" == print-dev-env ]] || return 98
  printf '%s' "$NIX_CONFIG" > "$CONFIG_FILE"
  printf ':\\n'
}
pnpm() {
  [[ "$1 $2" == "amp resume" ]] || return 97
  # Resume restores runtime values only after Nix evaluation.
  bash -c '[[ "$CLICKSTACK_API_KEY" == fixture && "$OTEL_DOCKER_STATS" == 1 ]]' || return 96
}
export -f nix pnpm
bash "$1"
`,
          "fixture",
          fileURLToPath(new URL(`../../.agents/${hook}`, import.meta.url)),
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            NIX_CONFIG: "sandbox = true\nrequire-sigs = true",
            AMP_ORB: "1",
            STORE_INFO: test.info,
            STORE_STATUS: String(test.status),
            CONFIG_FILE: configFile,
            CLICKSTACK_API_KEY: "fixture",
            CLICKSTACK_OTLP_ENDPOINT: "https://example.invalid",
            OTEL_DOCKER_STATS: "1",
          },
        },
      );
      expect(hookRun.status, hookRun.stderr).toBe(test.status);
      if (test.status === 0) {
        expect(readFileSync(configFile, "utf8")).toBe(run.stdout);
      } else {
        expect(() => readFileSync(configFile)).toThrow();
      }
    }
    if (test.status !== 0) {
      expect(run.stdout).toBe("");
      expect(() => readFileSync(join(root, "order"))).toThrow();
      return;
    }
    const config = run.stdout;
    expect(config).toContain(
      "sandbox = true\nrequire-sigs = true\nextra-experimental-features = nix-command flakes",
    );
    expect(config?.includes("extra-substituters =")).toBe(test.caches);
    expect(config?.includes("extra-trusted-public-keys =")).toBe(test.caches);
    expect(readFileSync(join(root, "order"), "utf8")).toBe("flake\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
