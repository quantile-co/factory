import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it.each(["fresh", "resumed"])(
  "loads upstream directly through Pi settings with a %s session",
  (scenario) => {
    const root = mkdtempSync(join(tmpdir(), "hindsight-native-"));
    try {
      execFileSync("git", ["init", "-q", root]);
      const upstream = "@vectorize-io/hindsight-coding-agents";
      const entry = `./npm/node_modules/${upstream}/dist/pi.js`;
      const npmRoot = join(root, ".pi", "npm");
      const packageRoot = dirname(
        dirname(
          fileURLToPath(
            import.meta.resolve(
              "@vectorize-io/hindsight-coding-agents/dist/pi.js",
            ),
          ),
        ),
      );
      mkdirSync(join(npmRoot, "node_modules", "@vectorize-io"), {
        recursive: true,
      });
      // Reuse the exact pinned dev fixture: package resolution must not run an installer.
      symlinkSync(packageRoot, join(npmRoot, "node_modules", upstream));
      const version = JSON.parse(
        readFileSync(join(packageRoot, "package.json"), "utf8"),
      ).version;
      expect(version).toBe("0.8.7");
      writeFileSync(
        join(npmRoot, "package.json"),
        JSON.stringify({ dependencies: { [upstream]: version } }),
      );
      writeFileSync(
        join(root, ".pi", "settings.json"),
        JSON.stringify({
          packages: [`npm:${upstream}@${version}`],
          extensions: [entry],
        }),
      );
      mkdirSync(join(root, "home", ".pi", "agent", "sessions"), {
        recursive: true,
      });
      mkdirSync(join(root, "tmp"));
      writeFileSync(
        join(root, "home", ".pi", "agent", "sessions", "archive.jsonl"),
        JSON.stringify({
          type: "message",
          message: { role: "user", content: "ARCHIVE_NOT_APPROVED" },
        }),
      );
      const configPath = join(root, ".pi", "hindsight.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          ...JSON.parse(
            readFileSync(
              new URL("../../etc/hindsight/coding-agent.json", import.meta.url),
              "utf8",
            ),
          ),
          bankId: "example--fixture",
        }),
      );
      const script = `
      import childProcess from "node:child_process";
      import { syncBuiltinESMExports } from "node:module";
      const spawned = [];
      childProcess.spawn = (...args) => { spawned.push(args[0]); throw new Error("Installers/background processes prohibited"); };
      syncBuiltinESMExports();
      const requests = [];
      globalThis.fetch = async (url, init = {}) => {
        const parsed = new URL(url);
        const method = init.method ?? "GET";
        requests.push({ method, path: parsed.pathname, body: init.body ? JSON.parse(init.body) : undefined });
        if (parsed.origin !== "https://api.hindsight.vectorize.io") throw new Error("Unexpected server");
        if (new Headers(init.headers).get("Authorization") !== "Bearer fixture-not-a-credential") throw new Error("Missing runtime authentication");
        const response = (value) => Response.json(value);
        if (parsed.pathname.endsWith("/pages/tree") && method === "GET") return response({ roots: [] });
        if (parsed.pathname.endsWith("/memories/recall") && method === "POST") return response({ results: [{ text: "Previously verified decision." }] });
        if (parsed.pathname.endsWith("/memories") && method === "POST") return response({});
        if (parsed.pathname.endsWith("/version") && method === "GET") return response({ version: "0.4.20" });
        throw new Error("Unexpected API operation");
      };
      const { DefaultResourceLoader, SettingsManager } = await import(${JSON.stringify(import.meta.resolve("@earendil-works/pi-coding-agent"))});
      const agentDir = process.env.HOME + "/.pi/agent";
      const settings = SettingsManager.create(process.cwd(), agentDir);
      settings.setProjectTrusted(true);
      const loader = new DefaultResourceLoader({
        cwd: process.cwd(), agentDir, settingsManager: settings,
        noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true,
      });
      await loader.reload();
      const loaded = loader.getExtensions();
      if (loaded.errors.length) throw new Error(JSON.stringify(loaded.errors));
      const extension = loaded.extensions.find((e) => e.path.endsWith("/dist/pi.js"));
      if (!extension) throw new Error("Native entrypoint was not loaded");
      const run = async (name, event, ctx) => {
        let result;
        for (const handler of extension.handlers.get(name) ?? []) result = await handler(event, ctx);
        return result;
      };
      const branch = [
        { type: "message", timestamp: ${JSON.stringify(scenario === "resumed" ? "2020-01-01T00:00:00.000Z" : new Date().toISOString())}, message: { role: "user", content: "ACTIVE_BRANCH_HISTORY" } },
        { type: "message", timestamp: new Date().toISOString(), message: { role: "assistant", content: [{ type: "text", text: "The fixture decision is verified." }] } },
      ];
      const ctx = { cwd: process.cwd(), sessionManager: { getSessionId: () => "fixture-session", getBranch: () => branch } };
      await run("session_start", {}, ctx);
      const injection = await run("before_agent_start", { prompt: "What was decided?" }, ctx);
      await run("agent_end", { messages: [] }, ctx);
      await run("session_shutdown", {}, ctx);
      console.log(JSON.stringify({ paths: loaded.extensions.map((e) => e.path), tools: [...extension.tools.keys()], requests, injection, spawned }));
    `;
      const output = execFileSync(
        process.execPath,
        ["--input-type=module", "--eval", script],
        {
          cwd: root,
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter(
                ([key]) =>
                  !key.startsWith("HINDSIGHT_") && !key.startsWith("PI_"),
              ),
            ),
            HOME: join(root, "home"),
            TMPDIR: join(root, "tmp"),
            PI_OFFLINE: "1",
            HINDSIGHT_CONFIG: configPath,
            HINDSIGHT_OPT_IN_PATHS: root,
            HINDSIGHT_API_TOKEN: "fixture-not-a-credential",
          },
          encoding: "utf8",
          timeout: 30_000,
        },
      );
      const result = JSON.parse(output.trim().split("\n").at(-1) ?? "");
      expect(result.paths).toEqual([join(root, ".pi", entry)]);
      expect(result.spawned).toEqual([]);
      expect(result.tools).toContain("hindsight_reflect");
      expect(result.injection.message.content).toContain(
        "Previously verified decision",
      );
      const recalls = result.requests.filter((r: { path: string }) =>
        r.path.endsWith("/memories/recall"),
      );
      expect(recalls).toHaveLength(1);
      expect(recalls[0].body.max_tokens).toBe(2000);
      expect(recalls[0].body.types).toEqual([
        "world",
        "experience",
        "observation",
      ]);
      const retains = result.requests.filter((r: { path: string }) =>
        r.path.endsWith("/memories"),
      );
      expect(retains).toHaveLength(1);
      // Document upstream behavior honestly: resume uploads the full active branch,
      // including old messages. Disabling autoSeed prevents archive scans, not this.
      expect(JSON.stringify(retains)).toContain("ACTIVE_BRANCH_HISTORY");
      expect(JSON.stringify(retains)).toContain("fixture decision is verified");
      expect(JSON.stringify(result.requests)).not.toContain(
        "ARCHIVE_NOT_APPROVED",
      );
      expect(
        result.requests.every(
          (r: { method: string; path: string }) =>
            r.method === "GET" ||
            [
              "/v1/default/banks/example--fixture/memories",
              "/v1/default/banks/example--fixture/memories/recall",
            ].includes(r.path),
        ),
      ).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  45_000,
);
