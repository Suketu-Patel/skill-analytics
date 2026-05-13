// Common query-param parser for metric routes. Reads ?source=&from=&to=
// from the request URL and normalizes them for the metric helpers.
export type MetricOpts = {
  source?: "codex" | "claude" | "all";
  from?: string;
  to?: string;
};

export function parseOpts(url: string): MetricOpts {
  const u = new URL(url);
  const source = (u.searchParams.get("source") || "all") as MetricOpts["source"];
  const from = u.searchParams.get("from") || undefined;
  const to = u.searchParams.get("to") || undefined;
  return { source, from, to };
}
