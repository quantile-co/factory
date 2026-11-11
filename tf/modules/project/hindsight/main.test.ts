import { execFile } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const exec = promisify(execFile);

it("uses native bank endpoints, detects drift and protects retained memory from destroy", async () => {
  const work = mkdtempSync(join(tmpdir(), "hindsight-consumer-"));
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  let bank: { bank_id: string; name: string; fact_count: number } | undefined;
  const requests: string[] = [];
  let readStatus = 200;
  let extraMetadata: Record<string, unknown> = {};
  let credential = "fixture-not-a-credential";
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    requests.push(`${request.method} ${url.pathname}`);
    response.setHeader("Content-Type", "application/json");
    if (request.headers.authorization !== `Bearer ${credential}`) {
      response.writeHead(401).end("{}");
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/default/banks") {
      if (readStatus !== 200) {
        response.writeHead(readStatus).end("{}");
        return;
      }
      // An unrelated match must not replace the exact bank being managed.
      response.end(
        JSON.stringify({
          banks: [
            { bank_id: "other--fixture", name: "Other" },
            ...(bank
              ? [
                  {
                    ...bank,
                    disposition: {},
                    mission: "fixture-private-mission",
                    ...extraMetadata,
                  },
                ]
              : []),
          ],
        }),
      );
      return;
    }
    if (
      ["PUT", "PATCH"].includes(request.method ?? "") &&
      url.pathname === "/v1/default/banks/example--fixture"
    ) {
      let body = "";
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body);
      if (Object.keys(payload).join() !== "name") {
        response.writeHead(400).end("{}");
        return;
      }
      bank = {
        bank_id: "example--fixture",
        name: payload.name,
        fact_count: bank?.fact_count ?? 0,
      };
      response.end(JSON.stringify(bank));
      return;
    }
    response.writeHead(404).end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing fixture address");
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !key.startsWith("TF_") &&
          !key.startsWith("REST_API_") &&
          !key.startsWith("HINDSIGHT_"),
      ),
    ),
    TF_IN_AUTOMATION: "1",
    REST_API_BEARER: "fixture-github-credential",
    TF_VAR_hindsight_api_token: credential,
    TF_VAR_gcp_wif_pool: "fixture-pool",
  };
  const tofu = (...args: string[]) =>
    exec("tofu", args, { cwd: work, env, timeout: 120_000 }).catch(
      (error: Error & { stdout?: string; stderr?: string }) => {
        error.message += `\n${error.stdout ?? ""}\n${error.stderr ?? ""}`;
        throw error;
      },
    );
  try {
    writeFileSync(
      join(work, "main.tf"),
      `
terraform {
  required_providers {
    restapi = { source = "registry.terraform.io/Mastercard/restapi", version = "= 3.0.0" }
  }
}
${readFileSync(
  resolve(moduleDir, "../../../infrastructure/providers.tf"),
  "utf8",
)
  .match(/provider "restapi" \{\n {2}alias[\s\S]*?\n\}/)?.[0]
  .replace(
    "https://api.hindsight.vectorize.io",
    `http://127.0.0.1:${address.port}`,
  )}
module "memory" {
  providers = { restapi = restapi.hindsight }
  source  = ${JSON.stringify(moduleDir)}
  bank_id = "example--fixture"
  name    = "Fixture"
}
`,
    );
    copyFileSync(
      resolve(moduleDir, "../../../infrastructure/.terraform.lock.hcl"),
      join(work, ".terraform.lock.hcl"),
    );
    copyFileSync(
      resolve(moduleDir, "../../../infrastructure/variables.tf"),
      join(work, "variables.tf"),
    );
    await tofu("init", "-backend=false", "-input=false", "-no-color");
    await tofu("plan", "-input=false", "-no-color", "-out=saved.tfplan");
    const planJson = (await tofu("show", "-json", "saved.tfplan")).stdout;
    const archive = (
      await exec(
        "python3",
        [
          "-c",
          "import sys, zipfile; z=zipfile.ZipFile(sys.argv[1]); sys.stdout.buffer.write(b'\\n'.join(z.read(n) for n in z.namelist()))",
          join(work, "saved.tfplan"),
        ],
        {
          maxBuffer: 8 * 1024 * 1024,
        },
      )
    ).stdout;
    for (const secret of [credential, "fixture-github-credential"]) {
      expect(planJson).not.toContain(secret);
      expect(archive).not.toContain(secret);
    }
    delete env.TF_VAR_hindsight_api_token;
    await expect(
      tofu("apply", "-input=false", "-no-color", "saved.tfplan"),
    ).rejects.toMatchObject({ code: 1 });
    expect(requests.some((request) => request.startsWith("PUT"))).toBe(false);
    credential = "rotated-fixture-not-a-credential";
    env.TF_VAR_hindsight_api_token = credential;
    await tofu("apply", "-input=false", "-no-color", "saved.tfplan");
    expect(bank?.name).toBe("Fixture");
    expect(requests).toContain("PUT /v1/default/banks/example--fixture");
    await tofu("plan", "-detailed-exitcode", "-input=false", "-no-color");
    if (!bank) throw new Error("Fixture bank was not created");
    bank.fact_count = 100;
    await tofu("plan", "-detailed-exitcode", "-input=false", "-no-color");
    bank.name = "Drift";
    await expect(
      tofu("plan", "-detailed-exitcode", "-input=false", "-no-color"),
    ).rejects.toMatchObject({ code: 2 });
    await tofu("apply", "-auto-approve", "-input=false", "-no-color");
    expect(bank.name).toBe("Fixture");
    expect(bank.fact_count).toBe(100);
    expect(requests).toContain("PATCH /v1/default/banks/example--fixture");
    // Authorization failures and outages must not become create/update proposals.
    for (const status of [401, 403, 500]) {
      readStatus = status;
      const writesBefore = requests.filter(
        (request) => !request.startsWith("GET"),
      ).length;
      await expect(
        tofu("plan", "-input=false", "-no-color"),
      ).rejects.toMatchObject({ code: 1 });
      expect(
        requests.filter((request) => !request.startsWith("GET")),
      ).toHaveLength(writesBefore);
    }
    readStatus = 200;
    await tofu("plan", "-detailed-exitcode", "-input=false", "-no-color");
    extraMetadata = { new_server_field: "unknown schema" };
    // A changed response schema is detected after the provider's write/read cycle;
    // writes still contain only the caller-owned name, never server metadata.
    await expect(
      tofu("apply", "-auto-approve", "-input=false", "-no-color"),
    ).rejects.toThrow("bank response schema changed");
    extraMetadata = {};
    const mainPath = join(work, "main.tf");
    const originalConfig = readFileSync(mainPath, "utf8");
    writeFileSync(
      mainPath,
      originalConfig.replace(
        'bank_id = "example--fixture"',
        'bank_id = "different--bank"',
      ),
    );
    await expect(tofu("plan", "-input=false", "-no-color")).rejects.toThrow(
      "bank identity could not be verified",
    );
    writeFileSync(mainPath, originalConfig);
    await expect(
      tofu("plan", "-destroy", "-input=false", "-no-color"),
    ).rejects.toThrow("prevent_destroy");
    expect(
      requests.some(
        (request) =>
          request.startsWith("DELETE") || request.includes("/profile"),
      ),
    ).toBe(false);
    const state = readFileSync(join(work, "terraform.tfstate"), "utf8");
    expect(state).not.toContain("fixture-github-credential");
    expect(state).not.toContain(credential);
    expect(state).not.toContain("fixture-not-a-credential");
    expect(state).not.toContain("fixture-private-mission");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(work, { recursive: true, force: true });
  }
}, 180_000);
