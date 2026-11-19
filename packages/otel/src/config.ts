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
