import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

interface ImportResult {
  bank: string;
  source: string;
  document_id: string;
  sha256: string;
  bytes: number;
  operation_id: string;
  replay?: string;
  submitted?: boolean;
  verified?: boolean;
  reason?: string;
  recovery?: string;
}

const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

/** Explicit one-document migration/correction; never scans directories or archives. */
export async function main(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  request: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<ImportResult> {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      approve: { type: "string" },
      replace: { type: "string" },
      replay: { type: "string" },
    },
  });
  const [action, bank, source, file] = positionals;
  if (
    positionals.length !== 4 ||
    !["plan", "apply", "verify"].includes(action) ||
    !/^[a-z0-9][a-z0-9._-]*--[a-z0-9][a-z0-9._-]*$/.test(bank) ||
    !/^[A-Za-z0-9._/-]+$/.test(source) ||
    source.startsWith("/") ||
    source.split("/").includes("..") ||
    (values.replay !== undefined &&
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(values.replay))
  ) {
    throw new Error(
      "Usage: import.ts plan|apply|verify organization--repository source-key FILE [--approve SHA256] [--replace REMOTE_SHA256] [--replay ID]",
    );
  }
  const bytes = await readFile(file);
  if (!bytes.length || bytes.length > 2 * 1024 * 1024)
    throw new Error(
      "Expected one nonempty reviewed text file of at most 2 MiB.",
    );
  const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!Buffer.from(content).equals(bytes))
    throw new Error("Use UTF-8 without a byte-order mark.");
  const hash = sha256(bytes);
  const documentId = `factory-import:${bank}:${source}`;
  // Stable within one revision/replay: completed IDs remain consumed after deletion.
  const operationBytes = createHash("sha256")
    .update(
      JSON.stringify(
        values.replay ? [documentId, hash, values.replay] : [documentId, hash],
      ),
    )
    .digest()
    .subarray(0, 16);
  operationBytes[6] = (operationBytes[6] & 15) | 80;
  operationBytes[8] = (operationBytes[8] & 63) | 128;
  const hex = operationBytes.toString("hex");
  const operationId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const plan = {
    bank,
    source,
    document_id: documentId,
    sha256: hash,
    bytes: bytes.length,
    operation_id: operationId,
    ...(values.replay ? { replay: values.replay } : {}),
  };
  if (action === "plan") return plan;
  if (values.approve !== hash)
    throw new Error(
      "Approval digest is missing or does not match the current file. Review a fresh plan.",
    );
  const token = env.HINDSIGHT_API_TOKEN?.trim();
  if (!token) throw new Error("A runtime HINDSIGHT_API_TOKEN is required.");
  const base = `https://api.hindsight.vectorize.io/v1/default/banks/${encodeURIComponent(bank)}`;
  async function api(
    path: string,
    method = "GET",
    body?: unknown,
    allowMissing = false,
  ): Promise<Record<string, unknown> | undefined> {
    const response = await request(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (allowMissing && response.status === 404) return undefined;
    if (!response.ok)
      throw new Error(
        `Hindsight ${method} failed (HTTP ${response.status}); no response content logged.`,
      );
    try {
      return await response.json();
    } catch {
      throw new Error("Hindsight returned invalid JSON.");
    }
  }
  // Retain can implicitly create banks: prohibit that in migration/correction work.
  await api("/config");
  const document = await api(
    `/documents/${encodeURIComponent(documentId)}`,
    "GET",
    undefined,
    true,
  );
  const remoteHash =
    typeof document?.original_text === "string"
      ? sha256(document.original_text)
      : undefined;
  if (action === "verify") {
    if (remoteHash !== hash)
      throw new Error(
        "Remote source content does not match the approved file.",
      );
    const operation = await api(`/operations/${operationId}`);
    if (operation?.status !== "completed")
      throw new Error(
        "Extraction has not completed successfully; preserve the local source.",
      );
    return {
      ...plan,
      verified: true,
      recovery:
        "The reviewed source file can replay this document; this is not a full bank backup.",
    };
  }
  if (remoteHash === hash)
    return {
      ...plan,
      submitted: false,
      reason: "Source already matches; verify extraction before cutover.",
    };
  if (
    document !== undefined &&
    (!remoteHash || values.replace !== remoteHash)
  ) {
    throw new Error(
      "Remote document differs. Review its content and supply its current SHA256 with --replace; no overwrite performed.",
    );
  }
  const submitted = await api("/memories", "POST", {
    async: true,
    operation_id: operationId,
    items: [
      {
        document_id: documentId,
        content,
        context: `Explicitly approved repository memory import/correction from ${source}; claims require current-source verification.`,
        tags: ["source:factory-import"],
        metadata: { source, sha256: hash },
        update_mode: "replace",
      },
    ],
  });
  if (submitted?.operation_id !== operationId)
    throw new Error(
      "Server did not acknowledge the stable operation ID. Stop and inspect operations before retrying.",
    );
  return { ...plan, submitted: true, verified: false };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).then(
    (result) => console.log(JSON.stringify(result, null, 2)),
    (error) => {
      console.error(error instanceof Error ? error.message : "Import failed.");
      process.exitCode = 1;
    },
  );
}
