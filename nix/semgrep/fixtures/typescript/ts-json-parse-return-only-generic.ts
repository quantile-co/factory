// biome-ignore-all lint/nursery/noUnsafeReturn: Contains intentionally unchecked JSON for the Semgrep regression test.

// ruleid: ts-json-parse-return-only-generic
export function decode<T>(input: string): T {
  return JSON.parse(input);
}

// ruleid: ts-json-parse-return-only-generic
export function claimed<T>(input: string): T {
  return JSON.parse(input) as T;
}

// ok: ts-json-parse-return-only-generic
export function untrusted(input: string): unknown {
  return JSON.parse(input);
}

// ok: ts-json-parse-return-only-generic
export function decoded<T>(input: string, validate: (value: unknown) => T): T {
  return validate(JSON.parse(input));
}

// ok: ts-json-parse-return-only-generic
export function identity<T>(input: T) {
  return input;
}

// ok: ts-json-parse-return-only-generic
export function unrelated<T>(input: string): T {
  throw new Error(input);
}
