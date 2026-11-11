import { execFileSync, spawnSync } from "node:child_process";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const [action, ...args] = process.argv.slice(2);
if (args.length || !["check", "fix"].includes(action))
  throw new Error("Expected check or fix");

const result = spawnSync(
  "factory-files",
  [action === "check" ? "check" : "write"],
  { cwd: root, stdio: "inherit" },
);
if (result.error) throw result.error;
if (result.signal) process.kill(process.pid, result.signal);
else process.exitCode = result.status ?? 1;
