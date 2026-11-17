export function collectorEndpoint(env: NodeJS.ProcessEnv = process.env) {
  const endpoint = env.QUANTILE_OTLP_ENDPOINT;
  if (!endpoint) return undefined;
  try {
    const url = new URL(endpoint);
    if (
      !endpoint.startsWith("https://") ||
      /[\s?#\\]/.test(endpoint) ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/"
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new Error(
      "Invalid OTel configuration; supply an HTTPS Collector base endpoint.",
    );
  }
}

export function managedConfig(env: NodeJS.ProcessEnv = process.env) {
  const endpoint = collectorEndpoint(env);
  const key = env.QUANTILE_OTLP_INGEST_TOKEN;
  if (!endpoint && !key) return undefined;
  if (!endpoint || !key || !/^[\x21-\x7e]{1,4096}$/.test(key))
    throw new Error(
      "Invalid OTel configuration; supply an HTTPS Collector base endpoint and raw ingestion token together.",
    );
  return { endpoint, key };
}

export type ManagedConfig = NonNullable<ReturnType<typeof managedConfig>>;
