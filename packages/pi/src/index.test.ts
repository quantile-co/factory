import { execFileSync } from "node:child_process";
import {
  cpSync,
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
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  createCodemodeExtension,
  createToolSearchExtension,
  DefaultResourceLoader,
  loadSkillsFromDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, expect, it } from "vitest";

let resources: string;
let packed: string;
beforeAll(() => {
  packed = mkdtempSync(join(tmpdir(), "factory-pi-packed-"));
  const archive = join(packed, "factory-pi.tgz");
  execFileSync("pnpm", ["pack", "--out", archive], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
  });
  execFileSync("tar", ["-xzf", archive, "-C", packed]);
  resources = join(packed, "package/dist");
});
afterAll(() => rmSync(packed, { recursive: true, force: true }));

it("packs only Factory skills and loads extensions independently of skill sync", async () => {
  const settingsText = readFileSync(join(resources, "settings.json"), "utf8");
  const settings = JSON.parse(settingsText);
  expect(settings).toEqual(
    JSON.parse(
      readFileSync(
        new URL("../../../etc/pi/settings.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  expect(settings.packages[0].skills).toEqual([]);
  expect(settings.packages).toContain("npm:pi-web-access@0.42.0");
  const manifest = JSON.parse(
    readFileSync(join(resources, "../package.json"), "utf8"),
  );
  expect(manifest.pi.skills).toEqual([]);
  expect(
    manifest.skills.every((entry: { ref: string }) =>
      /^[a-f0-9]{40}$/.test(entry.ref),
    ),
  ).toBe(true);
  const skillRoot = join(resources, "../skills");
  const catalog = loadSkillsFromDir({ dir: skillRoot, source: "package" });
  expect(catalog.diagnostics).toEqual([]);
  expect(catalog.skills.map((skill) => skill.name).sort()).toEqual([
    "day-zero-deploy",
    "deploy",
  ]);
  for (const skill of catalog.skills) {
    expect(readFileSync(skill.filePath, "utf8")).toBe(
      readFileSync(
        new URL(`../skills/${skill.name}/SKILL.md`, import.meta.url),
        "utf8",
      ),
    );
  }
  expect(manifest.pi.extensions).toEqual(["./dist/index.js"]);
  execFileSync(
    "gitleaks",
    [
      "dir",
      "--no-banner",
      "--redact",
      "--config",
      fileURLToPath(
        new URL("../../../etc/gitleaks/.gitleaks.toml", import.meta.url),
      ),
      join(resources, ".."),
    ],
    { encoding: "utf8", stdio: "pipe" },
  );
  const work = mkdtempSync(join(tmpdir(), "factory-pi-settings-"));
  try {
    const agentDir = join(work, "agent");
    mkdirSync(agentDir);
    mkdirSync(join(work, ".pi"));
    writeFileSync(join(work, ".pi/settings.json"), settingsText);
    expect(SettingsManager.create(work, agentDir).getDefaultTools()).toEqual([
      "read",
      "bash",
      "edit",
      "write",
      "codemode",
      "tool_search",
    ]);
    const loader = new DefaultResourceLoader({
      cwd: work,
      agentDir,
      settingsManager: SettingsManager.inMemory({
        packages: [
          {
            ...settings.packages[0],
            source: join(resources, ".."),
            extensions: [],
          },
        ],
      }),
      noExtensions: true,
      noThemes: true,
      noPromptTemplates: true,
      noContextFiles: true,
    });
    await loader.reload();
    expect(loader.getSkills().diagnostics).toEqual([]);
    expect(
      loader
        .getSkills()
        .skills.filter((skill) => skill.baseDir.startsWith(`${skillRoot}/`)),
    ).toEqual([]);
    writeFileSync(
      join(agentDir, "settings.json"),
      JSON.stringify({ defaultTools: ["read", "grep"] }),
    );
    expect(SettingsManager.create(work, agentDir).getDefaultTools()).toEqual([
      "read",
      "grep",
      "codemode",
      "tool_search",
    ]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

it("loads the independently installed Herdr extension through native settings", async () => {
  const work = mkdtempSync(join(tmpdir(), "factory-pi-herdr-settings-"));
  try {
    const settings = JSON.parse(
      readFileSync(join(resources, "settings.json"), "utf8"),
    );
    const herdr = settings.packages.find(
      (entry: string | { source: string }) =>
        typeof entry === "object" &&
        entry.source.startsWith("git:github.com/herdrdev/herdr@"),
    );
    expect(herdr).toBeDefined();
    const extension = join(work, ".pi", settings.extensions[0]);
    mkdirSync(join(extension, ".."), { recursive: true });
    writeFileSync(extension, "export default function () {}\n");
    writeFileSync(
      join(work, ".pi/settings.json"),
      JSON.stringify({
        packages: [herdr],
        extensions: settings.extensions,
      }),
    );
    const loader = new DefaultResourceLoader({
      cwd: work,
      agentDir: join(work, "agent"),
      settingsManager: SettingsManager.create(work, join(work, "agent")),
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      noContextFiles: true,
    });
    await loader.reload();
    const result = loader.getExtensions();
    expect(result.errors).toEqual([]);
    expect(result.extensions.map((item) => item.path)).toEqual([extension]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

it("loads packaged Factory guards for native codemode without shipping tests", async () => {
  const output = resources;
  expect(readdirSync(output).some((name) => name.includes(".test."))).toBe(
    false,
  );
  const work = mkdtempSync(join(tmpdir(), "factory-pi-load-"));
  try {
    const primary = join(work, "primary");
    const child = join(work, "child");
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", primary, ...args], {
        encoding: "utf8",
      }).trim();
    mkdirSync(primary);
    git("init", "-q", "-b", "main");
    writeFileSync(join(primary, "file.txt"), "original\n");
    git("add", "file.txt");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "initial",
    );
    git("worktree", "add", "-qb", "task", child);
    const agentDir = join(work, "agent");
    const nativeSettings = JSON.parse(
      readFileSync(
        new URL("../../../etc/pi/settings.json", import.meta.url),
        "utf8",
      ),
    );
    const settingsManager = SettingsManager.inMemory({
      defaultTools: nativeSettings.defaultTools,
    });
    const loader = new DefaultResourceLoader({
      cwd: child,
      agentDir,
      settingsManager,
      extensionFactories: [
        createCodemodeExtension(),
        createToolSearchExtension(),
      ],
      noExtensions: true,
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      noContextFiles: true,
      additionalExtensionPaths: [join(output, "index.js")],
    });
    await loader.reload();
    const { extensions, errors } = loader.getExtensions();
    expect(errors).toEqual([]);
    expect(extensions).toHaveLength(3);
    const factory = extensions.find((item) => item.tools.has("herdr_worktree"));
    expect(factory?.tools.has("foreground_terminal")).toBe(true);
    expect(extensions.every((item) => item.commands.size === 0)).toBe(true);
    const modelRuntime = await ModelRuntime.create({
      authPath: join(agentDir, "auth.json"),
      modelsPath: null,
      refreshOnCreate: false,
    });
    const sessionManager = SessionManager.inMemory(child);
    sessionManager.appendMessage(
      fauxAssistantMessage([fauxToolCall("codemode", {}, { id: "probe" })], {
        stopReason: "toolUse",
      }),
    );
    const { session } = await createAgentSession({
      cwd: child,
      agentDir,
      modelRuntime,
      model: modelRuntime.getModels()[0],
      resourceLoader: loader,
      settingsManager,
      sessionManager,
    });
    try {
      await session.bindExtensions({});
      expect(session.getActiveToolNames()).toEqual(
        expect.arrayContaining([
          "read",
          "bash",
          "edit",
          "write",
          "codemode",
          "tool_search",
          "herdr_worktree",
          "foreground_terminal",
        ]),
      );
      const tools = session.agent.state.tools;
      expect(tools.find((tool) => tool.name === "read")?.description).toContain(
        "Codemode:",
      );
      const codemode = tools.find((tool) => tool.name === "codemode");
      if (!codemode) throw new Error("Native codemode was not activated");
      const result = await codemode.execute("probe", {
        code: `
          const primary = ${JSON.stringify(primary)};
          text(await tools.read({ path: primary + "/file.txt" }));
          await tools.write({ path: "file.txt", content: "child edit\\n" });
          const attempts = await Promise.allSettled([
            tools.write({ path: primary + "/file.txt", content: "blocked" }),
            tools.edit({ path: primary + "/file.txt", edits: [{ oldText: "original", newText: "blocked" }] }),
            tools.bash({ command: "git -C '" + primary + "' switch -c blocked" }),
          ]);
          return "guarded: " + attempts.filter((attempt) => attempt.status === "rejected" && String(attempt.reason).includes("primary checkout")).length;
        `,
      });
      const text = result.content
        .map((item) => (item.type === "text" ? item.text : ""))
        .join("\n");
      expect(text).toContain("Script completed");
      expect(text).toContain("original");
      expect(text).toContain("guarded: 3");
      expect(readFileSync(join(primary, "file.txt"), "utf8")).toBe(
        "original\n",
      );
      expect(readFileSync(join(child, "file.txt"), "utf8")).toBe(
        "child edit\n",
      );
      expect(git("branch", "--show-current")).toBe("main");
    } finally {
      session.dispose();
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 120_000);

it("lets downstreams synchronize and exclude packaged skills without activating Pi package skills", async () => {
  const work = mkdtempSync(join(tmpdir(), "factory-pi-sync-"));
  try {
    const dependency = join(work, "node_modules/@quantile-co/factory-pi");
    cpSync(join(resources, ".."), dependency, { recursive: true });
    writeFileSync(
      join(work, "package.json"),
      JSON.stringify({
        name: "consumer",
        private: true,
        type: "module",
        devDependencies: { "@quantile-co/factory-pi": "0.0.0" },
      }),
    );
    const canonical = join(work, ".agents/skills");
    mkdirSync(join(canonical, "consumer-owned"), { recursive: true });
    writeFileSync(
      join(canonical, "consumer-owned/SKILL.md"),
      "---\nname: consumer-owned\ndescription: Consumer-owned instructions.\n---\nKeep this.\n",
    );
    const sync = (...filters: string[]) =>
      execFileSync(
        process.execPath,
        [
          fileURLToPath(
            new URL(
              "../../../node_modules/skills/bin/cli.mjs",
              import.meta.url,
            ),
          ),
          "experimental_sync",
          "--agent",
          "pi",
          "--copy",
          "--yes",
          "--no-remote",
          ...filters,
        ],
        {
          cwd: work,
          encoding: "utf8",
          env: { ...process.env, DISABLE_TELEMETRY: "1" },
        },
      );
    sync("--include", "@quantile-co/factory-pi#deploy");
    expect(readdirSync(canonical).sort()).toEqual(["consumer-owned", "deploy"]);
    expect(
      JSON.parse(readFileSync(join(work, "skills-lock.json"), "utf8")).skills
        .deploy.source,
    ).toBe("@quantile-co/factory-pi");
    const loader = new DefaultResourceLoader({
      cwd: work,
      agentDir: join(work, "agent"),
      settingsManager: SettingsManager.inMemory({}),
      noExtensions: true,
      noThemes: true,
      noPromptTemplates: true,
      noContextFiles: true,
    });
    await loader.reload();
    expect(loader.getSkills().diagnostics).toEqual([]);
    expect(
      loader
        .getSkills()
        .skills.filter((skill) => skill.baseDir.startsWith(`${canonical}/`))
        .map((skill) => skill.name)
        .sort(),
    ).toEqual(["consumer-owned", "deploy"]);
    sync("--exclude", "@quantile-co/factory-pi#deploy");
    expect(readdirSync(canonical).sort()).toEqual([
      "consumer-owned",
      "day-zero-deploy",
    ]);
    expect(
      readFileSync(join(canonical, "consumer-owned/SKILL.md"), "utf8"),
    ).toContain("Keep this.");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
