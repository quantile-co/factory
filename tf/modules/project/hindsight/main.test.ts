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

it.each(["create", "import"])(
  "%s: manages bank and page configuration without retaining memory or credentials in state",
  async (scenario) => {
    const work = mkdtempSync(join(tmpdir(), "hindsight-consumer-"));
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    let bank:
      | { bank_id: string; name: string; fact_count: number }
      | undefined =
      scenario === "import"
        ? { bank_id: "example--fixture", name: "Fixture", fact_count: 100 }
        : undefined;
    const requests: string[] = [];
    let readStatus = 200;
    let extraMetadata: Record<string, unknown> = {};
    let credential = "fixture-not-a-credential";
    type Page = {
      id: string;
      name: string;
      source_query: string;
      parent_id: string | null;
      tags: string[];
      trigger: {
        refresh_cron: string | null;
        refresh_after_consolidation?: boolean;
      };
    };
    const pages = new Map<string, Page>();
    const requirePage = (id: string): Page => {
      const page = pages.get(id);
      if (!page) throw new Error(`Missing fixture page: ${id}`);
      return page;
    };
    const pageWrites: Record<string, unknown>[] = [];
    let pageReadStatus = 200;
    let pageSequence = 0;
    const privateContent = "PRIVATE_GENERATED_PAGE_CONTENT";
    const pageNode = (page: Page) => ({
      id: page.id,
      kind: "page",
      name: page.name,
      description: page.source_query,
      parent_id: page.parent_id,
      tags: page.tags,
      trigger: {
        refresh_after_consolidation: false,
        ...page.trigger,
        fact_types: ["world", "experience", "observation"],
        unrelated_option: "PRIVATE_TRIGGER_METADATA",
      },
      timestamp: new Date().toISOString(),
      is_stale: true,
      managed: false,
      children: [],
      // Unknown response fields must not be copied to Terraform state either.
      unexpected_content: privateContent,
    });
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
      const pagePath = "/v1/default/banks/example--fixture/pages";
      if (request.method === "GET" && url.pathname === `${pagePath}/tree`) {
        if (pageReadStatus !== 200) {
          response.writeHead(pageReadStatus).end("{}");
          return;
        }
        response.end(
          JSON.stringify({
            roots: [
              ...[...pages.values()]
                .filter((page) => page.parent_id === null)
                .map(pageNode),
              {
                id: "kf-fixture",
                kind: "folder",
                name: "Initiatives",
                parent_id: null,
                children: [...pages.values()]
                  .filter((page) => page.parent_id === "kf-fixture")
                  .map(pageNode),
              },
              {
                id: "kp-unrelated",
                kind: "page",
                name: "Unmanaged",
                description: privateContent,
              },
            ],
          }),
        );
        return;
      }
      if (
        (request.method === "POST" && url.pathname === pagePath) ||
        (request.method === "PATCH" &&
          url.pathname.startsWith(`${pagePath}/nodes/`))
      ) {
        let body = "";
        for await (const chunk of request) body += chunk;
        const payload = JSON.parse(body);
        pageWrites.push(payload);
        if (
          Object.keys(payload).some(
            (key) =>
              ![
                "name",
                "source_query",
                "parent_id",
                "tags",
                "trigger",
              ].includes(key),
          )
        ) {
          response
            .writeHead(400)
            .end(
              JSON.stringify({ unexpectedPayloadKeys: Object.keys(payload) }),
            );
          return;
        }
        const id =
          request.method === "POST"
            ? `kp-created-${++pageSequence}`
            : url.pathname.slice(`${pagePath}/nodes/`.length);
        const old = pages.get(id);
        if (request.method === "PATCH" && !old) {
          response.writeHead(404).end("{}");
          return;
        }
        const page: Page = { ...old, ...payload, id };
        if (payload.trigger)
          page.trigger = { ...old?.trigger, ...payload.trigger };
        pages.set(id, page);
        response.end(
          JSON.stringify(
            request.method === "POST"
              ? { page_id: id, mental_model_id: `mm-${id}`, operation_id: null }
              : pageNode(page),
          ),
        );
        return;
      }
      response.writeHead(404).end("{}");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
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
    restful = { source = "registry.terraform.io/magodo/restful", version = "= 0.25.2" }
  }
}
${readFileSync(
  resolve(moduleDir, "../../../infrastructure/providers.tf"),
  "utf8",
)
  .match(/provider "restful" \{[\s\S]*?\n\}/)?.[0]
  .replace(
    "https://api.hindsight.vectorize.io",
    `http://127.0.0.1:${address.port}`,
  )}
variable "pages" {
  type = map(object({
    name = string
    source_query = string
    parent_id = string
    tags = list(string)
  }))
  default = {}
}
module "memory" {
  providers = { restful = restful.hindsight }
  source  = ${JSON.stringify(moduleDir)}
  bank_id = "example--fixture"
  name    = "Fixture"
  additional_pages = var.pages
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
      if (scenario === "import") {
        await tofu(
          "import",
          "-input=false",
          "-no-color",
          "module.memory.restful_resource.bank",
          JSON.stringify({
            id: "/v1/default/banks",
            path: "/v1/default/banks/example--fixture",
            query: { q: ["example--fixture"], limit: ["1000"] },
            read_selector:
              '[banks.#.{"bank_id":bank_id,"name":name}]|@flatten|{"bank":#(bank_id=="example--fixture")}',
            read_response_template: "$(body.bank)",
            body: { name: null },
          }),
        );
        const bankImportState = readFileSync(
          join(work, "terraform.tfstate"),
          "utf8",
        );
        expect(bankImportState).not.toContain("fixture-private-mission");
        expect(bankImportState).not.toContain(credential);
      }
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
      expect(pages.size).toBe(1);
      const procedures = requirePage("kp-created-1");
      expect(procedures.name).toBe("Successful procedures and pitfalls");
      expect(procedures.source_query).toContain("supporting outcomes");
      expect(procedures.trigger.refresh_cron).toBe("0 3 * * *");
      expect(requests.includes("PUT /v1/default/banks/example--fixture")).toBe(
        scenario === "create",
      );
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
      const savedBank = bank;
      bank = undefined;
      await expect(
        tofu("plan", "-input=false", "-no-color"),
      ).rejects.toMatchObject({ code: 1 });
      bank = savedBank;
      await tofu("plan", "-detailed-exitcode", "-input=false", "-no-color");

      // One-time native import uses only the tree metadata. No import definitions or
      // import-only variables remain in the module or production root.
      const adopted: Page = {
        id: "kp-existing",
        name: 'Existing "initiative"',
        source_query: 'A recorded "question"\nwith two lines.',
        parent_id: "kf-fixture",
        tags: ["knowledge:feature-work"],
        trigger: { refresh_cron: null, refresh_after_consolidation: false },
      };
      pages.set(adopted.id, adopted);
      env.TF_VAR_pages = JSON.stringify({
        initiative: {
          name: adopted.name,
          source_query: adopted.source_query,
          parent_id: adopted.parent_id,
          tags: adopted.tags,
        },
      });
      await tofu(
        "import",
        "-input=false",
        "-no-color",
        'module.memory.restful_resource.page["initiative"]',
        JSON.stringify({
          id: "/v1/default/banks/example--fixture/pages/tree",
          path: "/v1/default/banks/example--fixture/pages",
          read_selector:
            '[roots.#(id=="kf-fixture").children.#.{"page_id":id,"name":name,"source_query":description,"parent_id":parent_id,"tags":tags,"trigger":trigger.{"refresh_cron":refresh_cron}}]|@flatten|{"page":#(page_id=="kp-existing")}',
          read_response_template: "$(body.page)",
          body: {
            name: null,
            source_query: null,
            parent_id: null,
            tags: null,
            trigger: { refresh_cron: null },
          },
        }),
      );
      const importState = readFileSync(join(work, "terraform.tfstate"), "utf8");
      expect(importState).not.toContain(privateContent);
      expect(importState).not.toContain("PRIVATE_TRIGGER_METADATA");
      expect(importState).not.toContain(credential);
      await tofu("plan", "-input=false", "-no-color", "-out=pages.tfplan");
      const adoptionPlan = (await tofu("show", "-json", "pages.tfplan")).stdout;
      const changes = JSON.parse(adoptionPlan).resource_changes;
      const imported = changes.find(
        (change: { address: string }) =>
          change.address ===
          'module.memory.restful_resource.page["initiative"]',
      );
      expect(imported.change.actions).toContain("update");
      expect(imported.change.actions).not.toContain("create");
      expect(imported.change.actions).not.toContain("delete");
      expect(adoptionPlan).not.toContain(privateContent);
      expect(adoptionPlan).not.toContain("PRIVATE_TRIGGER_METADATA");
      expect(adoptionPlan).not.toContain(credential);
      await tofu("apply", "-input=false", "-no-color", "pages.tfplan");
      expect(pages.get(adopted.id)?.parent_id).toBe("kf-fixture");
      expect(pages.get(adopted.id)?.trigger.refresh_cron).toBe("0 3 * * *");
      expect(pageSequence).toBe(1);
      await tofu("plan", "-detailed-exitcode", "-input=false", "-no-color");

      const stablePage = requirePage(adopted.id);
      stablePage.source_query = "Drifted question";
      stablePage.trigger.refresh_cron = "0 * * * *";
      stablePage.tags = ["unexpected", "extra-tag"];
      requirePage("kp-created-1").tags = ["unexpected"];
      await expect(
        tofu("plan", "-detailed-exitcode", "-input=false", "-no-color"),
      ).rejects.toMatchObject({ code: 2 });
      await tofu("apply", "-auto-approve", "-input=false", "-no-color");
      expect(pages.get(adopted.id)?.source_query).toBe(adopted.source_query);
      expect(pages.get(adopted.id)?.tags).toEqual(adopted.tags);
      expect(requirePage("kp-created-1").tags).toEqual([]);
      expect(pages.get(adopted.id)?.trigger.refresh_cron).toBe("0 3 * * *");
      await tofu("plan", "-detailed-exitcode", "-input=false", "-no-color");

      for (const status of [401, 403, 500]) {
        pageReadStatus = status;
        const writesBefore = pageWrites.length;
        await expect(
          tofu("plan", "-input=false", "-no-color"),
        ).rejects.toMatchObject({ code: 1 });
        expect(pageWrites).toHaveLength(writesBefore);
      }
      pageReadStatus = 200;
      const savedPage = requirePage(adopted.id);
      pages.delete(adopted.id);
      await expect(
        tofu("plan", "-input=false", "-no-color"),
      ).rejects.toMatchObject({ code: 1 });
      pages.set(adopted.id, { ...savedPage, parent_id: null });
      await expect(
        tofu("plan", "-input=false", "-no-color"),
      ).rejects.toMatchObject({ code: 1 });
      pages.set(adopted.id, savedPage);
      await tofu("plan", "-detailed-exitcode", "-input=false", "-no-color");

      // No content endpoint may be read during create, import, refresh or update.
      expect(
        requests
          .filter(
            (request) =>
              request.startsWith("GET") && request.includes("/pages/"),
          )
          .every((request) => request.endsWith("/pages/tree")),
      ).toBe(true);
      extraMetadata = { new_server_field: "unknown schema" };
      // Response projection ignores new metadata without storing or managing it.
      await tofu("plan", "-detailed-exitcode", "-input=false", "-no-color");
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
        "prevent_destroy",
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
      const state = ["terraform.tfstate", "terraform.tfstate.backup"]
        .map((file) => readFileSync(join(work, file), "utf8"))
        .join("\n");
      expect(state).not.toContain("fixture-github-credential");
      expect(state).not.toContain(credential);
      expect(state).not.toContain("fixture-not-a-credential");
      expect(state).not.toContain("fixture-private-mission");
      expect(state).not.toContain(privateContent);
      expect(state).not.toContain("PRIVATE_TRIGGER_METADATA");

      if (scenario === "import") {
        const keep = JSON.parse(env.TF_VAR_pages ?? "{}");
        env.TF_VAR_pages = JSON.stringify({
          ...keep,
          amp_adoption: { ...keep.initiative, name: "Amp fixture" },
          hindsight_rollout: { ...keep.initiative, name: "Rollout fixture" },
        });
        await tofu("apply", "-auto-approve", "-input=false", "-no-color");
        const before = [...pages.values()];
        expect(before).toHaveLength(4);
        const requestStart = requests.length;

        env.TF_VAR_pages = JSON.stringify(keep);
        writeFileSync(
          join(work, "hindsight-page-detachment.tf"),
          readFileSync(
            resolve(
              moduleDir,
              "../../../infrastructure/hindsight-page-detachment.tf",
            ),
            "utf8",
          ).replaceAll("module.hindsight.", "module.memory."),
        );
        await tofu("plan", "-input=false", "-no-color", "-out=detach.tfplan");
        const detach = JSON.parse(
          (await tofu("show", "-json", "detach.tfplan")).stdout,
        );
        const mutations = detach.resource_changes
          .filter((r: { change: { actions: string[] } }) =>
            r.change.actions.some((action) => action !== "no-op"),
          )
          .map(
            (r: {
              previous_address?: string;
              change: { actions: string[] };
            }) => ({
              from: r.previous_address,
              actions: r.change.actions,
            }),
          );
        expect(mutations).toHaveLength(2);
        expect(mutations).toEqual(
          expect.arrayContaining(
            ["amp_adoption", "hindsight_rollout"].map((key) => ({
              from: `module.memory.restful_resource.page["${key}"]`,
              actions: ["forget"],
            })),
          ),
        );
        await tofu("apply", "-input=false", "-no-color", "detach.tfplan");
        await tofu("plan", "-detailed-exitcode", "-input=false", "-no-color");
        expect((await tofu("state", "list")).stdout.trim().split("\n")).toEqual(
          [
            "module.memory.restful_resource.bank",
            'module.memory.restful_resource.page["initiative"]',
            'module.memory.restful_resource.page["procedures"]',
          ],
        );
        expect([...pages.values()]).toEqual(before);
        expect(
          requests.slice(requestStart).every((r) => r.startsWith("GET ")),
        ).toBe(true);
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(work, { recursive: true, force: true });
    }
  },
  300_000,
);
