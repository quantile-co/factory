import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { renew } from "./sender.ts";

test("job credential is scoped to the Collector origin and renewed atomically", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "sender-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const audience = "https://collector.example.test";
  const env = {
    ACTIONS_ID_TOKEN_REQUEST_URL:
      "https://pipelines.actions.githubusercontent.com/fixture?job=123",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "synthetic-request",
  };
  let n = 0;
  const token = () =>
    "fixture." +
    Buffer.from(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 300,
        n,
      }),
    ).toString("base64url") +
    ".fixture";
  t.mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
    assert.equal(url.searchParams.get("audience"), audience);
    assert.equal(url.searchParams.get("job"), "123");
    assert.equal(
      new Headers(init.headers).get("authorization"),
      "Bearer synthetic-request",
    );
    assert.equal(init.redirect, "error");
    n++;
    return Response.json({ value: token() });
  });
  for (let i = 1; i <= 2; i++) {
    assert((await renew(dir, audience, env, new AbortController().signal)) > 0);
    assert.equal(n, i);
    assert.equal(await readFile(join(dir, "identity"), "utf8"), token());
    assert.equal((await stat(join(dir, "identity"))).mode & 0o777, 0o600);
  }
  await assert.rejects(stat(join(dir, "identity.next")), { code: "ENOENT" });
});

test("missing permission and unusable tokens never populate the credential file", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "sender-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const audience = "https://collector.example.test",
    signal = new AbortController().signal;
  await assert.rejects(renew(dir, audience, {}, signal), /id-token/);
  let payload = { aud: audience, exp: 1 };
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      value:
        "x." +
        Buffer.from(JSON.stringify(payload)).toString("base64url") +
        ".x",
    }),
  );
  const env = {
    ACTIONS_ID_TOKEN_REQUEST_URL:
      "https://pipelines.actions.githubusercontent.com/fixture",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "synthetic",
  };
  await assert.rejects(renew(dir, audience, env, signal), /Unusable/);
  payload = { aud: "wrong", exp: Math.floor(Date.now() / 1000) + 300 };
  await assert.rejects(renew(dir, audience, env, signal), /Unusable/);
  await assert.rejects(stat(join(dir, "identity")), { code: "ENOENT" });
});
