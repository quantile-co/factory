import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const workflow = (name: string) =>
  readFileSync(
    new URL(`../../.github/workflows/${name}.yaml`, import.meta.url),
    "utf8",
  );

it.each(["check", "test", "plan", "apply"])(
  "%s remains directly runnable and callable by downstream repositories",
  (name) => {
    const source = workflow(name);
    expect(source).toMatch(/^ {2}workflow_call:/m);
    expect(source).toMatch(/^ {2}workflow_dispatch:/m);
    expect(source).toContain("persist-credentials: false");
  },
);

it.each(["plan", "apply"])(
  "%s retains its protected manual gate when invoked through workflow_call",
  (name) => {
    const source = workflow(name);
    expect(source).toContain("github.event_name == 'workflow_dispatch' &&");
    expect(source).toContain("github.ref == 'refs/heads/main' &&");
    expect(source).toContain("github.triggering_actor");
    expect(source).toContain("environment: prod");
    expect(source).toContain("group: factory-production");
    expect(source).toContain("id-token: write");
    expect(source).toContain("CACHIX_AUTH_TOKEN:");
    expect(source).not.toContain("secrets: inherit");
  },
);

it("Apply still takes a reviewed Plan artifact ID and applies only its fresh saved plan", () => {
  const source = workflow("apply");
  expect(source.match(/^ {6}plan_artifact_id:/gm)).toHaveLength(2);
  expect(source).toContain("required: true");
  expect(source).toMatch(
    /PLAN_ARTIFACT_ID:\s+\$\{\{\s*inputs\.plan_artifact_id\s*\}\}/,
  );
  expect(source).toContain("tasks run --show-output apply:infrastructure");
});

it("Test cannot publish caches from a non-manual or non-main invocation", () => {
  const source = workflow("test");
  expect(source).toContain(
    "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'",
  );
  expect(source).toContain("CACHIX_AUTH_TOKEN:");
});
