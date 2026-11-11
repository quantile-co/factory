export function managedConfig(env: NodeJS.ProcessEnv = process.env) {
  const endpoint = env.CLICKSTACK_OTLP_ENDPOINT;
  const key = env.CLICKSTACK_API_KEY;
  if (!endpoint && !key) return undefined;
  try {
    const url = new URL(endpoint ?? "");
    if (
      !endpoint?.startsWith("https://") ||
      /[\s?#\\]/.test(endpoint) ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      !key ||
      !/^[\x21-\x7e]{1,4096}$/.test(key)
    )
      throw new Error();
    return { endpoint: url.origin, key };
  } catch {
    throw new Error(
      "Invalid OTel configuration; supply an HTTPS ClickHouse Observability base endpoint and raw ingestion key together.",
    );
  }
}

export type ManagedConfig = NonNullable<ReturnType<typeof managedConfig>>;

export function withoutCredentials(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = { ...env };
  delete result.CLICKSTACK_OTLP_ENDPOINT;
  delete result.CLICKSTACK_API_KEY;
  return result;
}
