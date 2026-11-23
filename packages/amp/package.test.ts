import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("runs both capabilities from the single installed bundle without a source tree", () => {
  const temporary = mkdtempSync(join(tmpdir(), "factory-amp-bundle-"));
  try {
    writeFileSync(join(temporary, "package.json"), '{"type":"module"}');
    copyFileSync(
      new URL("./dist/plugin.js", import.meta.url),
      join(temporary, "quantile-co-factory-amp.js"),
    );
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
        import assert from 'node:assert/strict';
        import plugin from './quantile-co-factory-amp.js';
        const commands = new Map();
        const handlers = new Map();
        let leases = 0;
        plugin({
          logger: { log() {} },
          system: { executor: { kind: 'remote', keepAlive: async () => {
            leases++; return { unsubscribe() {} };
          } } },
          registerCommand: (name, options, action) => commands.set(name, action),
          on: (name, action) => handlers.set(name, action),
        });
        assert.equal(commands.size, 3);
        assert.equal(handlers.size, 4);
        await commands.get('factory-orb-awake-on')({ ui: { notify: async () => {} } });
        assert.equal(leases, 1);
        const event = { thread: { id: 'T-12345678-1234-1234-1234-123456789abc' }, id: 'turn' };
        assert.equal(handlers.get('agent.start')(event), undefined);
        assert.deepEqual(handlers.get('tool.call')({ ...event, toolUseID: 'tool' }), { action: 'allow' });
        assert.equal(handlers.get('tool.result')({ ...event, toolUseID: 'tool' }), undefined);
        assert.equal(await handlers.get('agent.end')(event), undefined);
        `,
      ],
      {
        cwd: temporary,
        env: {
          HOME: temporary,
          PATH: process.env.PATH,
          AMP_ORB: "1",
          QUANTILE_OTLP_ENDPOINT: "https://collector.example",
        },
        timeout: 10_000,
        stdio: "pipe",
      },
    );
    const manifest = JSON.parse(
      readFileSync(new URL("./package.json", import.meta.url), "utf8"),
    );
    expect(Object.keys(manifest.publishConfig.exports)).toEqual([
      ".",
      "./plugin",
    ]);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

it("Factory setup replaces only its old installed plugins with the unified bundle", () => {
  const temporary = mkdtempSync(join(tmpdir(), "factory-amp-install-"));
  const config = join(temporary, "config");
  const directory = join(config, "amp/plugins");
  mkdirSync(directory, { recursive: true });
  for (const name of [
    "factory-orb-awake.js",
    "factory-observability.js",
    "unrelated.js",
  ])
    writeFileSync(join(directory, name), "preserve unrelated plugins");
  try {
    const setup = readFileSync(
      new URL("../../.agents/setup", import.meta.url),
      "utf8",
    );
    const start = setup.indexOf("  plugins=");
    expect(start).toBeGreaterThan(0);
    execFileSync(
      "bash",
      ["-euo", "pipefail", "-c", setup.slice(start, setup.lastIndexOf("\n'"))],
      {
        cwd: new URL("../../", import.meta.url),
        env: {
          HOME: temporary,
          XDG_CONFIG_HOME: config,
          PATH: process.env.PATH,
        },
        stdio: "pipe",
      },
    );
    const installed = join(directory, "quantile-co-factory-amp.js");
    expect(readFileSync(installed, "utf8")).toBe(
      readFileSync(new URL("./dist/plugin.js", import.meta.url), "utf8"),
    );
    expect(statSync(installed).mode & 0o777).toBe(0o644);
    expect(existsSync(join(directory, "factory-orb-awake.js"))).toBe(false);
    expect(existsSync(join(directory, "factory-observability.js"))).toBe(false);
    expect(readFileSync(join(directory, "unrelated.js"), "utf8")).toBe(
      "preserve unrelated plugins",
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
