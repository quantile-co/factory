#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { manageFiles } from "@quantile-co/factory-nix/files";
import { assemblePacks } from "@quantile-co/factory-nix/semgrep";

try {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "files": {
      const [action, manifest] = args;
      if (!manifest || args.length !== 2)
        throw new Error("Usage: factory-nix files write|check <manifest>");
      manageFiles(
        process.cwd(),
        JSON.parse(readFileSync(manifest, "utf8")),
        action,
      );
      break;
    }
    case "semgrep":
      if (args.length !== 3)
        throw new Error(
          "Usage: factory-nix semgrep <inventory> <source> <output>",
        );
      assemblePacks(args[0], args[1], args[2]);
      break;
    default:
      throw new Error("Expected files or semgrep");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
