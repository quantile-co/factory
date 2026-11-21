import { syncCodeQuality } from "../../packages/github/src/code-quality.ts";

export async function runCodeQuality(): Promise<void> {
  const result = await syncCodeQuality({
    repository: process.env.GITHUB_REPOSITORY ?? "",
    token: process.env.GH_TOKEN ?? "",
    apiUrl: process.env.GITHUB_API_URL,
    serverUrl: process.env.GITHUB_SERVER_URL,
  });
  console.log(`Code Quality tracking issue: ${result}`);
}

if (import.meta.main) {
  try {
    await runCodeQuality();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
