// Common query-param parser for metric routes. Reads ?source=&from=&to=
// &project= from the request URL and normalizes them for the metric helpers.
//
// `project` is the full cwd string — typically `/Users/<u>/Desktop/.../<proj>`.
// We match by exact equality on `turns.cwd`. Set to "all" or omit to skip.
export type MetricOpts = {
  source?: "codex" | "claude" | "all";
  from?: string;
  to?: string;
  project?: string;
};

export function parseOpts(url: string): MetricOpts {
  const u = new URL(url);
  const source = (u.searchParams.get("source") || "all") as MetricOpts["source"];
  const from = u.searchParams.get("from") || undefined;
  const to = u.searchParams.get("to") || undefined;
  const rawProject = u.searchParams.get("project") || undefined;
  const project = rawProject && rawProject !== "all" && rawProject !== "" ? rawProject : undefined;
  return { source, from, to, project };
}
