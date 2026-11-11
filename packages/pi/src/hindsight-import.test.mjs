import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { main } from "../skills/hindsight/import.mjs";

it("gates imports, stable retries, corrections and explicit recovery replays", async () => {
  const root = await mkdtemp(join(tmpdir(), "hindsight-import-"));
  const file = join(root, "reviewed.txt");
  const args = ["example--project", ".pi/memory/MEMORY.md", file];
  const env = { HINDSIGHT_API_TOKEN: "fixture-not-a-credential" };
  const calls = [];
  let document;
  const operations = new Set();
  let status = "pending";
  const request = async (url, init) => {
    expect(init.redirect).toBe("error");
    expect(init.headers.Authorization).toBe("Bearer fixture-not-a-credential");
    const path = new URL(url).pathname;
    calls.push({ path, method: init.method, body: init.body });
    if (path.endsWith("/config")) return Response.json({});
    if (path.includes("/documents/"))
      return document
        ? Response.json(document)
        : new Response("", { status: 404 });
    if (path.includes("/operations/")) return Response.json({ status });
    const body = JSON.parse(init.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].update_mode).toBe("replace");
    // Cloud deduplicates completed operation IDs even after document deletion.
    if (!operations.has(body.operation_id)) {
      document = { original_text: body.items[0].content };
      operations.add(body.operation_id);
    }
    return Response.json({ operation_id: body.operation_id });
  };
  try {
    await writeFile(file, "Reviewed fixture decision.\n");
    const plan = await main(["plan", ...args], {}, request);
    expect(calls).toHaveLength(0);
    expect(plan.document_id).toBe(
      "factory-import:example--project:.pi/memory/MEMORY.md",
    );
    expect(JSON.stringify(plan)).not.toContain("Reviewed fixture decision");
    expect(await main(["plan", ...args], {}, request)).toEqual(plan);
    await expect(main(["apply", ...args], env, request)).rejects.toThrow(
      "Approval digest",
    );
    await expect(
      main(["apply", ...args, "--approve", plan.sha256], {}, request),
    ).rejects.toThrow("HINDSIGHT_API_TOKEN");
    expect(calls).toHaveLength(0);
    const applied = await main(
      ["apply", ...args, "--approve", plan.sha256],
      env,
      request,
    );
    expect(applied.submitted).toBe(true);
    expect(applied.verified).toBe(false);
    const writes = () => calls.filter((call) => call.method === "POST");
    expect(writes()).toHaveLength(1);
    expect(
      (await main(["apply", ...args, "--approve", plan.sha256], env, request))
        .submitted,
    ).toBe(false);
    expect(writes()).toHaveLength(1);
    await expect(
      main(["verify", ...args, "--approve", plan.sha256], env, request),
    ).rejects.toThrow("not completed");
    status = "completed";
    expect(
      (await main(["verify", ...args, "--approve", plan.sha256], env, request))
        .verified,
    ).toBe(true);

    await writeFile(file, "Explicitly corrected fixture decision.\n");
    const changed = await main(["plan", ...args], {}, request);
    expect(changed.document_id).toBe(plan.document_id);
    expect(changed.operation_id).not.toBe(plan.operation_id);
    await expect(
      main(["apply", ...args, "--approve", plan.sha256], env, request),
    ).rejects.toThrow("Approval digest");
    await expect(
      main(["apply", ...args, "--approve", changed.sha256], env, request),
    ).rejects.toThrow("Remote document differs");
    expect(writes()).toHaveLength(1);
    await main(
      ["apply", ...args, "--approve", changed.sha256, "--replace", plan.sha256],
      env,
      request,
    );
    expect(writes()).toHaveLength(2);
    expect(
      (
        await main(
          ["verify", ...args, "--approve", changed.sha256],
          env,
          request,
        )
      ).verified,
    ).toBe(true);
    document = undefined;
    await main(["apply", ...args, "--approve", changed.sha256], env, request);
    await expect(
      main(["verify", ...args, "--approve", changed.sha256], env, request),
    ).rejects.toThrow("Remote source content");
    const replayFlags = ["--replay", "restore-1"];
    const replay = await main(["plan", ...args, ...replayFlags], {}, request);
    expect(replay.document_id).toBe(changed.document_id);
    expect(replay.sha256).toBe(changed.sha256);
    expect(replay.operation_id).not.toBe(changed.operation_id);
    expect(await main(["plan", ...args, ...replayFlags], {}, request)).toEqual(
      replay,
    );
    await main(
      ["apply", ...args, "--approve", replay.sha256, ...replayFlags],
      env,
      request,
    );
    expect(
      (
        await main(
          ["verify", ...args, "--approve", replay.sha256, ...replayFlags],
          env,
          request,
        )
      ).verified,
    ).toBe(true);
    await writeFile(file, "Reviewed fixture decision.\n");
    const revertFlags = ["--replay", "revert-1"];
    const revert = await main(["plan", ...args, ...revertFlags], {}, request);
    expect(revert.sha256).toBe(plan.sha256);
    expect(revert.operation_id).not.toBe(plan.operation_id);
    await main(
      [
        "apply",
        ...args,
        "--approve",
        revert.sha256,
        "--replace",
        replay.sha256,
        ...revertFlags,
      ],
      env,
      request,
    );
    expect(
      (
        await main(
          ["verify", ...args, "--approve", revert.sha256, ...revertFlags],
          env,
          request,
        )
      ).verified,
    ).toBe(true);
    expect(JSON.stringify(calls)).not.toContain(env.HINDSIGHT_API_TOKEN);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("refuses missing banks and API failures without submitting or logging response content", async () => {
  const root = await mkdtemp(join(tmpdir(), "hindsight-import-"));
  const file = join(root, "reviewed.txt");
  const args = ["example--project", "memory", file];
  try {
    await writeFile(file, "Fixture");
    const plan = await main(["plan", ...args]);
    for (const status of [401, 403, 404, 500]) {
      let calls = 0;
      const request = async (_url, init) => {
        calls++;
        expect(init.method).toBe("GET");
        return new Response("PRIVATE_RESPONSE_MUST_NOT_BE_LOGGED", { status });
      };
      await expect(
        main(
          ["apply", ...args, "--approve", plan.sha256],
          { HINDSIGHT_API_TOKEN: "fixture" },
          request,
        ),
      ).rejects.toThrow(`HTTP ${status}`);
      expect(calls).toBe(1);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
