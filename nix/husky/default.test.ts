import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it.each([
  { check: 0, legacy: "none", status: 0, order: "check\nlfs\n" },
  { check: 0, legacy: "0", status: 0, order: "check\nlegacy\nlfs\n" },
  { check: 17, legacy: "0", status: 17, order: "check\n" },
  { check: 0, legacy: "23", status: 23, order: "check\nlegacy\n" },
  { check: 0, legacy: "missing", status: 1, order: "check\n" },
])("gates LFS and preserves push refs: $check / $legacy", (test) => {
  const root = mkdtempSync(join(tmpdir(), "factory-husky-"));
  try {
    mkdirSync(join(root, "bin"));
    mkdirSync(join(root, "tmp"));
    writeFileSync(
      join(root, "bin/direnv"),
      `#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == exec && "$2" == . ]]
shift 2
if [[ "$1" == pnpm ]]; then
  [[ "$*" == 'pnpm run check' ]]
  printf 'check\\n' >> "$LOG/order"
  cat > "$LOG/check.refs"
  exit "$CHECK_STATUS"
fi
[[ "$1 $2 $3" == 'git lfs pre-push' ]]
shift 3
printf 'lfs\\n' >> "$LOG/order"
printf '%s\\n' "$@" > "$LOG/lfs.args"
cat > "$LOG/lfs.refs"
`,
      { mode: 0o755 },
    );
    const legacy = join(root, "legacy");
    if (test.legacy !== "missing") {
      writeFileSync(
        legacy,
        `#!/usr/bin/env bash
printf 'legacy\\n' >> "$LOG/order"
printf '%s\\n' "$@" > "$LOG/legacy.args"
cat > "$LOG/legacy.refs"
exit "$LEGACY_STATUS"
`,
        { mode: 0o755 },
      );
    }
    const refs = "refs/heads/main abc refs/heads/main def\n";
    const args = ["origin", "remote with spaces"];
    const run = spawnSync(
      "bash",
      [
        fileURLToPath(new URL("../../etc/husky/pre-push", import.meta.url)),
        ...args,
      ],
      {
        cwd: root,
        input: refs,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${join(root, "bin")}:${process.env.PATH}`,
          TMPDIR: join(root, "tmp"),
          LOG: root,
          CHECK_STATUS: String(test.check),
          LEGACY_STATUS: test.legacy,
          GIT_PRE_PUSH_LEGACY: test.legacy === "none" ? "" : legacy,
        },
      },
    );
    if (run.error) throw run.error;
    expect(run.status, run.stderr).toBe(test.status);
    expect(readFileSync(join(root, "order"), "utf8")).toBe(test.order);
    expect(readFileSync(join(root, "check.refs"), "utf8")).toBe("");
    for (const stage of ["legacy", "lfs"]) {
      if (test.order.includes(`${stage}\n`)) {
        expect(readFileSync(join(root, `${stage}.refs`), "utf8")).toBe(refs);
        expect(readFileSync(join(root, `${stage}.args`), "utf8")).toBe(
          `${args.join("\n")}\n`,
        );
      } else {
        expect(existsSync(join(root, `${stage}.refs`))).toBe(false);
      }
    }
    expect(readdirSync(join(root, "tmp"))).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
