const marker = "<!-- code-quality-tracker -->";
const title = "Code Quality findings";
const severities = ["error", "warning", "note", "none"];

interface Finding {
  number: number;
  rule: { severity: string };
  location: { path: string; start_line?: number };
}

interface Issue {
  number: number;
  body: string | null;
  state: "open" | "closed";
  pull_request?: object;
}

function renderIssue(findings: Finding[], dashboard: string): string {
  const lines = [
    marker,
    "",
    `Open Standard findings: **${findings.length}**. [View in Security and quality](${dashboard}).`,
    "",
  ];
  for (const { number, rule, location } of findings.slice(0, 50)) {
    const path = location.path
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("@", "&#64;")
      .replace(/[\r\n]/g, " ");
    lines.push(
      `- Finding ${number} — **${rule.severity}** — <code>${path}:${location.start_line ?? "?"}</code>`,
    );
  }
  if (findings.length > 50)
    lines.push(
      "",
      "Showing the first 50. See Standard findings for the full list.",
    );
  return lines.join("\n").trimEnd();
}

export async function syncCodeQuality({
  repository,
  token,
  apiUrl = "https://api.github.com",
  serverUrl = "https://github.com",
  request = fetch,
}: {
  repository: string;
  token: string;
  apiUrl?: string;
  serverUrl?: string;
  request?: typeof fetch;
}): Promise<"created" | "updated" | "closed" | "reopened" | "unchanged"> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !token)
    throw new Error("Set GITHUB_REPOSITORY (owner/repo) and GH_TOKEN");

  const base = `${apiUrl.replace(/\/$/, "")}/repos/${repository}`;
  const origin = new URL(base).origin;
  async function send(url: URL, method = "GET", body?: object) {
    if (url.origin !== origin)
      throw new Error("Unexpected GitHub pagination URL");
    const response = await request(url, {
      method,
      redirect: "error",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-github-api-version": "2026-03-10",
      },
      body: body && JSON.stringify(body),
    });
    if (!response.ok)
      throw new Error(
        `GitHub API ${method} ${url.pathname} failed (HTTP ${response.status})`,
      );
    return response;
  }

  async function* list<T>(path: string) {
    let url: URL | undefined = new URL(base + path);
    while (url) {
      const response = await send(url);
      const page: unknown = await response.json();
      if (!Array.isArray(page))
        throw new Error(`Expected a GitHub list from ${url.pathname}`);
      yield* page as T[];
      const next = response.headers
        .get("link")
        ?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
      url = next ? new URL(next, url) : undefined;
    }
  }

  const findings: Finding[] = [];
  for await (const finding of list<Finding>(
    "/code-quality/findings?state=open&per_page=100",
  )) {
    if (
      !Number.isSafeInteger(finding?.number) ||
      !severities.includes(finding.rule?.severity) ||
      typeof finding.location?.path !== "string" ||
      (finding.location.start_line != null &&
        !Number.isSafeInteger(finding.location.start_line))
    )
      throw new Error("Unexpected GitHub Code Quality finding");
    findings.push(finding);
  }
  findings.sort((a, b) => a.number - b.number);

  const body = renderIssue(
    findings,
    `${serverUrl.replace(/\/$/, "")}/${repository}/security`,
  );
  const state = findings.length ? "open" : "closed";
  const issues = `${base}/issues`;
  for await (const issue of list<Issue>(
    "/issues?state=all&per_page=100&creator=github-actions%5Bbot%5D",
  )) {
    if (issue.pull_request || !issue.body?.startsWith(marker)) continue;
    if (issue.body === body && issue.state === state) return "unchanged";
    await send(new URL(`${issues}/${issue.number}`), "PATCH", { body, state });
    if (issue.state === state) return "updated";
    return state === "closed" ? "closed" : "reopened";
  }
  if (!findings.length) return "unchanged";
  await send(new URL(issues), "POST", { title, body });
  return "created";
}
