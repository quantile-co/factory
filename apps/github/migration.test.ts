import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  migrateBackend,
  migrationAnswer,
  stateDigest,
  verifySourceInventory,
  verifyTransition,
} from "./migration.ts";

it("refuses overwrite and unknown confirmation prompts", () => {
  const query =
    "Do you want to copy existing state to the new backend? Enter a value:";
  expect(
    migrationAnswer(
      `No existing state was found in the newly configured "gcs" backend. ${query}`,
    ),
  ).toBe("yes\n");
  expect(
    migrationAnswer(
      `An existing non-empty state already exists in the new backend. ${query}`,
    ),
  ).toBe("no\n");
  expect(migrationAnswer(query)).toBe("no\n");
  expect(
    migrationAnswer(
      `No existing state was found in the newly configured "local" backend. ${query}`,
    ),
  ).toBe("no\n");
});

it("accepts only the reviewed GCS serial increment without payload changes", () => {
  const original = {
    version: 4,
    terraform_version: "1.13.1",
    serial: 78,
    lineage: "same-lineage",
    resources: [],
    outputs: { sentinel: { value: "unchanged", type: "string" } },
  };
  const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
  expect(() =>
    verifyTransition(bytes(original), bytes({ ...original, serial: 79 })),
  ).not.toThrow();
  for (const after of [
    { ...original, serial: 80 },
    { ...original, serial: 79, lineage: "foreign" },
    { ...original, serial: 79, outputs: {} },
  ])
    expect(() => verifyTransition(bytes(original), bytes(after))).toThrow(
      /transition/,
    );
});

it("detects changes to numbers outside JavaScript integer precision", () => {
  const before = Buffer.from(
    '{"version":4,"terraform_version":"1.13.1","serial":78,"lineage":"same","resources":[],"outputs":{"number":{"type":"number","value":9007199254740992}}}',
  );
  const after = Buffer.from(
    before
      .toString()
      .replace('"serial":78', '"serial":79')
      .replace("9007199254740992", "9007199254740993"),
  );
  expect(stateDigest(before)).not.toBe(
    stateDigest(
      Buffer.from(
        before.toString().replace("9007199254740992", "9007199254740993"),
      ),
    ),
  );
  expect(() => verifyTransition(before, after)).toThrow(/transition/);
  expect(() =>
    verifyTransition(
      before,
      Buffer.from(before.toString().replace('"serial":78', '"serial":79')),
    ),
  ).not.toThrow();
});

it("rejects extra source workspaces, locks and unknown nested prefixes", () => {
  const prefix = "example/prod";
  const inventory = {
    items: [{ name: `${prefix}/default.tfstate` }],
    prefixes: [`${prefix}/application/`],
  };
  expect(() =>
    verifySourceInventory(prefix, [prefix, `${prefix}/application`], inventory),
  ).not.toThrow();
  for (const listing of [
    { items: [...inventory.items, { name: `${prefix}/other.tfstate` }] },
    { items: [...inventory.items, { name: `${prefix}/other.tflock` }] },
    { ...inventory, prefixes: [`${prefix}/unknown/`] },
    { ...inventory, nextPageToken: "more" },
  ])
    expect(() =>
      verifySourceInventory(prefix, [prefix, `${prefix}/application`], listing),
    ).toThrow(/inventory/);
});

it("migrates only an empty backend and preserves an existing destination", async () => {
  const directory = mkdtempSync(join(tmpdir(), "native-state-migration-"));
  const env = {
    PATH: process.env.PATH,
    HOME: directory,
    TF_DATA_DIR: join(directory, ".terraform"),
    TF_IN_AUTOMATION: "true",
    TF_WORKSPACE: "default",
  };
  const initial = {
    version: 4,
    terraform_version: "1.13.1",
    serial: 7,
    lineage: "440620c2-1ddd-4632-bc57-61247c862334",
    outputs: { sentinel: { value: "preserve", type: "string" } },
    resources: [
      {
        mode: "managed",
        type: "terraform_data",
        name: "fixture",
        provider: 'provider["terraform.io/builtin/terraform"]',
        instances: [
          {
            schema_version: 0,
            attributes: {
              id: "fixture",
              input: { value: "preserve", type: "string" },
              output: { value: "preserve", type: "string" },
              triggers_replace: null,
            },
            sensitive_attributes: [],
          },
        ],
      },
    ],
  };
  const old = join(directory, "old.tfstate"),
    destination = join(directory, "new.tfstate"),
    occupied = join(directory, "occupied.tfstate");
  const run = (...args: string[]) => {
    const result = spawnSync("tofu", [`-chdir=${directory}`, ...args], {
      env,
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout;
  };
  try {
    writeFileSync(
      join(directory, "backend.tf"),
      'terraform {\n  backend "local" {}\n}\n',
    );
    writeFileSync(old, JSON.stringify(initial));
    run("init", "-input=false", "-no-color", `-backend-config=path=${old}`);
    const beforeBytes = Buffer.from(run("state", "pull"));
    stateDigest(beforeBytes);
    await migrateBackend(
      [
        `-chdir=${directory}`,
        "init",
        "-migrate-state",
        "-input=true",
        "-no-color",
        `-backend-config=path=${destination}`,
      ],
      env,
      join(directory, "migration.log"),
      "local",
    );
    const afterBytes = Buffer.from(run("state", "pull"));
    // The filesystem backend increments twice; GCS persistence increments once.
    verifyTransition(beforeBytes, afterBytes, 2);
    expect(() => verifyTransition(beforeBytes, afterBytes)).toThrow(
      /transition/,
    );
    expect(stateDigest(readFileSync(destination))).toBe(
      stateDigest(afterBytes),
    );
    writeFileSync(
      occupied,
      JSON.stringify({
        ...initial,
        lineage: "cb708b52-2270-42b6-8790-006bfbcf9437",
        serial: 12,
        outputs: { sentinel: { value: "foreign", type: "string" } },
      }),
    );
    const foreign = readFileSync(occupied);
    await expect(
      migrateBackend(
        [
          `-chdir=${directory}`,
          "init",
          "-migrate-state",
          "-input=true",
          "-no-color",
          `-backend-config=path=${occupied}`,
        ],
        env,
        join(directory, "migration.log"),
        "local",
      ),
    ).rejects.toThrow(/Refused nonempty or unknown migration prompt/);
    expect(readFileSync(occupied).equals(foreign)).toBe(true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);
