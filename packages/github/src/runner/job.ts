import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  startCollector,
  startJobCollector,
  stopCollector,
} from "./collector.ts";

function jobDirectory(env: NodeJS.ProcessEnv) {
  if (!env.RUNNER_TEMP) throw new Error("Missing runner temporary directory");
  return join(env.RUNNER_TEMP, "factory-otel");
}

export function completeRunnerJob(env: NodeJS.ProcessEnv) {
  return stopCollector(jobDirectory(env));
}

export function runnerTailnetSuffix(resolverConfig: string) {
  const suffixes = new Set<string>();
  for (const line of resolverConfig.split("\n")) {
    const [directive, ...domains] = line
      .split(/[#;]/, 1)[0]
      .trim()
      .split(/\s+/);
    if (directive !== "search" && directive !== "domain") continue;
    for (const domain of domains) {
      const suffix = domain.toLowerCase().replace(/\.$/, "");
      if (/^[a-z0-9-]+\.ts\.net$/.test(suffix)) suffixes.add(suffix);
    }
  }
  if (suffixes.size !== 1)
    throw new Error("Runner network must supply one MagicDNS search suffix");
  return [...suffixes][0];
}

export async function startRunnerJob(
  env: NodeJS.ProcessEnv,
  {
    loadNetwork = () => readFile("/etc/resolv.conf", "utf8"),
    start = startCollector,
  } = {},
) {
  const directory = jobDirectory(env);
  const envFile = env.GITHUB_ENV;
  if (!envFile) throw new Error("Missing job environment file");

  // Namespace enrolls the runner and installs the MagicDNS search suffix.
  const suffix = runnerTailnetSuffix(await loadNetwork());
  const gateway = `https://ai-gateway.${suffix}`;
  const collector = `https://otel.${suffix}`;
  // These jobs also deploy and repair the remote services. Require the local
  // collector to be healthy, not the services it will eventually reach.
  await appendFile(envFile, `QUANTILE_AI_GATEWAY_ENDPOINT=${gateway}\n`);
  await startJobCollector(env, directory, collector, start);
  await appendFile(
    envFile,
    `QUANTILE_OTLP_ENDPOINT=${collector}\nLANGFUSE_TRACING_ENABLED=true\n`,
  );
}
