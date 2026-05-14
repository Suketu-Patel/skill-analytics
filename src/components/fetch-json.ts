// Tolerant JSON fetch helper.
//
// Why this exists: a bare `fetch(url).then((r) => r.json())` throws
// SyntaxError on any non-JSON response, eg the literal string
// "Internal Server Error" Next sends on a 500. The user then sees
// "SyntaxError: Unexpected token 'I'..." which is useless. Always read
// the body as text first, attempt JSON.parse, and on failure raise a
// friendly error that includes the actual status and the first chunk
// of the body so the surfaced message is debuggable.
//
// Use like:
//   const data = await fetchJson<MyShape>("/api/metrics/cost-overview");
//
// Pass init exactly like fetch's second arg if you need POST/body/etc.
export async function fetchJson<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (err) {
    // Network / DNS / aborted. Re-throw with a marker so callers can
    // distinguish "the server replied poorly" from "couldn't reach
    // the server at all".
    throw new Error(
      `Network error fetching ${typeof input === "string" ? input : input.toString()}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  const text = await res.text();
  let parsed: unknown = null;
  let parseError: Error | null = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      parseError = err instanceof Error ? err : new Error(String(err));
    }
  }
  if (!res.ok) {
    // Prefer a server-provided JSON .error field, fall back to the raw
    // body, fall back to the status text. Truncate so a huge HTML error
    // page doesn't blow up the toast.
    const serverMsg =
      (parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error?: unknown }).error || "")
        : "") ||
      text.slice(0, 240).trim() ||
      res.statusText ||
      `HTTP ${res.status}`;
    throw new Error(`${res.status}: ${serverMsg}`);
  }
  if (parseError) {
    // 2xx but body wasn't JSON. Surface what we got rather than the
    // cryptic "Unexpected token 'I' in JSON".
    throw new Error(
      `Expected JSON from ${
        typeof input === "string" ? input : "request"
      } but got ${text.slice(0, 120).trim() || "an empty response"}`
    );
  }
  return parsed as T;
}
