// Skill quality scoring + error clustering.
//
// Pure JS helpers — no DB access here. Callers from metrics.js feed in already-
// queried rows so the module can be unit-tested without sqlite.

// ---------- Clustering ----------
//
// Normalize an error message into a stable "shape" so similar messages collapse
// into the same cluster. Strips numbers, paths, hashes, IDs, ANSI escapes.
export function normalizeMessage(text) {
  if (!text) return "";
  return String(text)
    .toLowerCase()
    // ANSI / escapes
    .replace(/\\u001b\[[0-9;]*m/g, " ")
    .replace(/\[[0-9;]*m/g, " ")
    // Absolute paths
    .replace(/\/[^\s'"]+/g, " <path>")
    // hex hashes
    .replace(/\b[0-9a-f]{8,64}\b/g, "<hash>")
    // uuids
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
    // standalone numbers (line numbers, ports, sizes)
    .replace(/\b\d+(?:\.\d+)?\b/g, "N")
    // collapse whitespace
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

// Build clusters from an iterable of { message, timestamp, evidence_id, skill_name, category, severity }.
// Returns an array of { signature, count, category, severity, sample, first_seen, last_seen, skills, evidence_ids }
export function clusterErrors(rows, { topN = 50, sampleEvidence = 3 } = {}) {
  const buckets = new Map();
  for (const row of rows || []) {
    const sig = normalizeMessage(row.message);
    if (!sig) continue;
    const key = `${row.category || "_"}|${sig}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        signature: sig,
        category: row.category || "unknown",
        severity: row.severity || "error",
        count: 0,
        sample: row.message || "",
        first_seen: row.timestamp || null,
        last_seen: row.timestamp || null,
        skills: new Set(),
        evidence_ids: []
      };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (row.skill_name) bucket.skills.add(row.skill_name);
    if (row.timestamp) {
      if (!bucket.first_seen || row.timestamp < bucket.first_seen) bucket.first_seen = row.timestamp;
      if (!bucket.last_seen || row.timestamp > bucket.last_seen) bucket.last_seen = row.timestamp;
    }
    if (bucket.evidence_ids.length < sampleEvidence && row.evidence_id) {
      bucket.evidence_ids.push(row.evidence_id);
    }
  }
  return [...buckets.values()]
    .map((b) => ({ ...b, skills: [...b.skills].slice(0, 8) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

// ---------- Quality scoring ----------
//
// Composite 0-100 score derived from observable signals. Each dimension is a
// 0-100 sub-score; the final score is a weighted average.
//
// Inputs: a single Object with the precomputed metrics:
//   { events, errors, tool_calls, tool_completed, tool_failed,
//     avg_duration_ms, cost_per_session, last_seen, file_age_days,
//     explicit_events, mentioned_events }
export function scoreSkillQuality(m) {
  const dimensions = [];

  // 1. Success rate of tool calls in skill's sessions.
  const totalResolved = (m.tool_completed || 0) + (m.tool_failed || 0);
  const successRate = totalResolved > 0 ? (m.tool_completed || 0) / totalResolved : null;
  if (successRate !== null) {
    dimensions.push({
      key: "success_rate",
      label: "Tool success rate",
      value: Math.round(successRate * 100),
      weight: 0.35,
      score: Math.round(successRate * 100)
    });
  }

  // 2. Error pressure (errors per event). Lower is better; 0 ⇒ 100, ≥0.5 ⇒ 0.
  if ((m.events || 0) > 0) {
    const errorRatio = (m.errors || 0) / m.events;
    const errPressure = Math.max(0, Math.min(1, errorRatio * 2));
    dimensions.push({
      key: "error_pressure",
      label: "Error pressure",
      value: Math.round(errorRatio * 100),
      weight: 0.2,
      score: Math.round((1 - errPressure) * 100)
    });
  }

  // 3. Recency — used within the last 30 days = 100, > 90 = 0.
  if (m.last_seen) {
    const days = (Date.now() - Date.parse(m.last_seen)) / (1000 * 60 * 60 * 24);
    const rec = days <= 7 ? 100 : days <= 30 ? 80 : days <= 60 ? 40 : 0;
    dimensions.push({
      key: "recency",
      label: "Recency of use",
      value: Math.round(days),
      weight: 0.15,
      score: rec
    });
  } else if ((m.events || 0) === 0) {
    dimensions.push({
      key: "recency",
      label: "Recency of use",
      value: "never",
      weight: 0.15,
      score: 0
    });
  }

  // 4. Explicit-vs-mention signal clarity. Mostly-mentioned skills mean the
  // agent doesn't deliberately invoke them — bad signal for skill design.
  const totalSig = (m.explicit_events || 0) + (m.mentioned_events || 0);
  if (totalSig > 0) {
    const explicitRatio = (m.explicit_events || 0) / totalSig;
    dimensions.push({
      key: "explicit_ratio",
      label: "Invocation clarity",
      value: Math.round(explicitRatio * 100),
      weight: 0.1,
      score: Math.round(explicitRatio * 100)
    });
  }

  // 5. File freshness — skill files older than 90d while still failing
  // suggest stale guidance.
  if (m.file_age_days != null) {
    const fresh = m.file_age_days <= 30 ? 100 : m.file_age_days <= 90 ? 70 : 30;
    dimensions.push({
      key: "file_freshness",
      label: "Skill file freshness",
      value: Math.round(m.file_age_days),
      weight: 0.1,
      score: fresh
    });
  }

  // 6. Token efficiency vs peer median — if peerCostPerSession provided.
  if (m.cost_per_session != null && m.peer_cost_median != null && m.peer_cost_median > 0) {
    const ratio = m.cost_per_session / m.peer_cost_median;
    const eff = ratio <= 1 ? 100 : ratio <= 2 ? 70 : ratio <= 4 ? 40 : 10;
    dimensions.push({
      key: "token_efficiency",
      label: "Token efficiency vs peers",
      value: `${ratio.toFixed(2)}× peer median`,
      weight: 0.1,
      score: eff
    });
  }

  if (!dimensions.length) {
    return { score: null, grade: "—", dimensions: [], note: "Not enough activity to score yet." };
  }
  const totalWeight = dimensions.reduce((a, d) => a + d.weight, 0);
  const score = Math.round(
    dimensions.reduce((a, d) => a + d.score * d.weight, 0) / totalWeight
  );
  const grade =
    score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 50 ? "D" : "F";
  return { score, grade, dimensions };
}

// ---------- Rule-based suggestions ----------
//
// Inspect signals + clusters to suggest concrete improvements. Each suggestion
// returns { kind, title, detail, severity }.
export function buildSuggestions(skill, signals, clusters) {
  const out = [];
  const events = signals.events || 0;
  const errors = signals.errors || 0;
  const last = signals.last_seen ? Date.parse(signals.last_seen) : null;
  const daysSince = last ? (Date.now() - last) / (1000 * 60 * 60 * 24) : null;
  const errorRatio = events > 0 ? errors / events : 0;
  const successRate =
    (signals.tool_completed || 0) + (signals.tool_failed || 0) > 0
      ? signals.tool_completed / (signals.tool_completed + signals.tool_failed)
      : null;

  if (events === 0) {
    out.push({
      kind: "stale",
      severity: "warn",
      title: "Never invoked",
      detail:
        "This skill exists on disk but has zero recorded events. Consider archiving it, sharpening its description, or testing whether the agent should auto-discover it for the tasks you're doing."
    });
  } else if (daysSince != null && daysSince > 30) {
    out.push({
      kind: "stale",
      severity: "info",
      title: `Unused for ${Math.round(daysSince)} days`,
      detail:
        "Skill registered but inactive. If it was retired, delete it. If it's still relevant, the description may not match the tasks you're actually doing — try the AI Coach to rephrase it."
    });
  }

  if (errorRatio > 0.3) {
    out.push({
      kind: "high_error",
      severity: "high",
      title: `High error rate (${Math.round(errorRatio * 100)}%)`,
      detail:
        "More than 30% of this skill's events are errors. Look at the top failure clusters below — most of the cost can usually be removed by addressing the top 2-3 patterns."
    });
  } else if (errorRatio > 0.15) {
    out.push({
      kind: "med_error",
      severity: "warn",
      title: `Elevated error rate (${Math.round(errorRatio * 100)}%)`,
      detail: "Not catastrophic, but worth investigating the top failure cluster."
    });
  }

  if (successRate != null && successRate < 0.7 && (signals.tool_completed || 0) + (signals.tool_failed || 0) >= 10) {
    out.push({
      kind: "low_success",
      severity: "high",
      title: `Tool success rate ${Math.round(successRate * 100)}%`,
      detail:
        "The agent is invoking tools but they fail more than 30% of the time. Common root causes: too-broad skill scope, missing preconditions in the skill description, or out-of-date assumptions about paths/commands."
    });
  }

  if (clusters && clusters.length) {
    const hot = clusters[0];
    if (hot.count >= 5) {
      out.push({
        kind: "hot_cluster",
        severity: "high",
        title: `Recurring failure: "${hot.signature.slice(0, 60)}…" (${hot.count} times)`,
        detail:
          "This exact failure shape has happened repeatedly. One targeted fix will eliminate all of them. Use 'Run AI Coach' below to propose a patch to the skill file."
      });
    }
  }

  if (signals.mentioned_events && signals.explicit_events != null) {
    const total = signals.mentioned_events + signals.explicit_events;
    if (total > 5 && signals.explicit_events / total < 0.2) {
      out.push({
        kind: "low_clarity",
        severity: "info",
        title: "Mostly mentioned, rarely invoked",
        detail:
          "The agent talks about this skill more than it actually triggers it. Tighten the SKILL.md trigger phrases so the orchestrator picks it up deliberately."
      });
    }
  }

  if (signals.file_age_days != null && signals.file_age_days > 90 && errorRatio > 0.05) {
    out.push({
      kind: "stale_file",
      severity: "warn",
      title: `Skill file hasn't changed in ${Math.round(signals.file_age_days)} days`,
      detail: "Still producing errors despite an old file. The guidance probably hasn't kept up with reality."
    });
  }

  return out;
}
