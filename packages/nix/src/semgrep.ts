import { execFileSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

export function assemblePacks(
  inventoryFile: string,
  sourceDirectory: string,
  outputDirectory: string,
): void {
  const inventory: Record<string, Record<string, string>> = JSON.parse(
    readFileSync(inventoryFile, "utf8"),
  );
  const documents = new Map<string, { id: string; [key: string]: unknown }[]>();
  mkdirSync(outputDirectory, { recursive: true });
  for (const [pack, entries] of Object.entries(inventory)) {
    if (!/^[a-z0-9-]+$/.test(pack)) throw new Error("Invalid rule-pack name");
    const rules = Object.entries(entries).map(([id, relativePath]) => {
      const source = resolve(sourceDirectory, relativePath);
      if (!source.startsWith(resolve(sourceDirectory) + sep))
        throw new Error("Rule path escapes pinned source");
      let document = documents.get(relativePath);
      if (!document) {
        const parsed = JSON.parse(
          execFileSync("yq", ["--output-format", "json", ".", source], {
            encoding: "utf8",
            maxBuffer: 64 * 1024 * 1024,
          }),
        );
        document = parsed.rules;
        if (!Array.isArray(document))
          throw new Error(`No rules in ${relativePath}`);
        documents.set(relativePath, document);
      }
      const matches = document.filter(
        (rule) => id === rule.id || id.endsWith(`.${rule.id}`),
      );
      if (matches.length !== 1)
        throw new Error(
          `${pack}: expected exactly one ${id} in ${relativePath}`,
        );
      return { ...matches[0], id };
    });
    const fd = openSync(join(outputDirectory, `${pack}.yaml`), "w");
    try {
      execFileSync("yq", ["--prettyPrint", "--output-format", "yaml", "."], {
        input: JSON.stringify({ rules }) + "\n",
        stdio: ["pipe", fd, "pipe"],
      });
    } finally {
      closeSync(fd);
    }
  }
}
