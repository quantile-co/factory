import { expect, it } from "vitest";
import { syncCodeQuality } from "./code-quality.ts";

const repository = "owner/repo";
const finding = {
  number: 9,
  rule: { severity: "warning" },
  location: { path: "src/index.ts", start_line: 4 },
};

it("keeps one issue in sync through new, changed, cleared and returning findings", async () => {
  let findings = [finding];
  let issue: { number: number; body: string; state: string } | undefined;
  const writes: string[] = [];
  const request: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/code-quality/findings")) return Response.json(findings);
    if (init?.method === "GET") return Response.json(issue ? [issue] : []);
    const { body, state } = JSON.parse(String(init?.body));
    writes.push(`${init?.method} ${path}`);
    issue = { number: 42, body, state: state ?? "open" };
    return Response.json(issue);
  };
  const sync = () => syncCodeQuality({ repository, token: "test", request });

  expect(await sync()).toBe("created");
  expect(issue?.body).toContain("src/index.ts:4");
  expect(await sync()).toBe("unchanged");
  findings = [{ ...finding, number: 10 }];
  expect(await sync()).toBe("updated");
  findings = [];
  expect(await sync()).toBe("closed");
  findings = [finding];
  expect(await sync()).toBe("reopened");
  expect(writes).toEqual([
    "POST /repos/owner/repo/issues",
    ...Array(3).fill("PATCH /repos/owner/repo/issues/42"),
  ]);
});

it("does not touch issues when a later findings page fails", async () => {
  const requests: string[] = [];
  const request: typeof fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    if (url.searchParams.has("after"))
      return new Response(null, { status: 503 });
    url.searchParams.set("after", "cursor");
    return Response.json([], { headers: { link: `<${url}>; rel="next"` } });
  };

  await expect(
    syncCodeQuality({ repository, token: "test", request }),
  ).rejects.toThrow("HTTP 503");
  expect(requests).toEqual(
    Array(2).fill("/repos/owner/repo/code-quality/findings"),
  );
});
