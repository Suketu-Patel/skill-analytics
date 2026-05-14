// Crazy-tab analytics. Eight metrics that turn raw JSONL session
// transcripts into uncomfortably honest charts. Every function returns
// plain JSON and reads only from the local SQLite DB, no external
// services. Heavy queries memoize via metric-cache if needed; for now
// they all run in <200ms on a ~200K-event corpus.
import fs from "node:fs";
import path from "node:path";
import { queryRows, sqlString } from "./sqlite.js";

// — Shared helpers ────────────────────────────────────────────────────

// Words/phrases the user types AFTER an assistant turn when the
// previous answer didn't land. Two classes: polite corrections (no,
// wrong, actually) and explicit frustration (fuck, wtf, ugh). We
// match both, but the fingerprint surfaces the top-by-count so
// the spicy ones show up if they're really how you talk.
const CORRECTION_RE =
  /\b(no|nope|wrong|actually|instead|that'?s not|try again|undo|revert|broken|fix this|redo|start over|didn'?t (?:work|finish|complete)|stop|don'?t|why (?:did|are) you|fuck|fucks?|fucking|shit|damn|hell|wtf|dammit|bullshit|bs|crap|ugh|jesus|christ|wtaf|smh|wth|frustrat\w*|annoying|stupid|come on|seriously|bruh)\b/i;

// Phrases the model says when it's stalling / over-apologizing /
// performing competence rather than demonstrating it. The literature
// calls this "obsequiousness" and "sycophancy"; we just call it the
// pep-talk index.
const PEPTALK_RE =
  /\b(great question|good (?:question|catch|point)|excellent|absolutely|i see what'?s happening|i understand|let me (?:help|fix|investigate)|i'?ll (?:fix|help|investigate|take a look)|perfect|exactly|happy to|of course|great idea|that makes sense)\b/i;

function parseRaw(json) {
  try { return JSON.parse(json); } catch { return null; }
}

// Pulls the textual body out of a raw_events row, regardless of which
// JSONL flavor (Codex's nested payload, Claude's message.content array).
// `userOnly` mode rejects tool_result wrappers Claude stores with
// type=user but which are actually the model receiving tool output,
// not the human typing.
function extractMessageText(row, opts = {}) {
  const j = parseRaw(row.raw_json);
  if (!j) return "";
  // Codex shape: {type: "event_msg", payload: {type: "user_message", message: "..."}}
  if (j.payload?.message && typeof j.payload.message === "string") return j.payload.message;
  // Claude shape: {message: {content: [{type: "text", text: "..."}]}}
  if (Array.isArray(j.message?.content)) {
    const items = j.message.content;
    // Claude tool_result wrapper: pseudo-user message whose content
    // is the tool output. Not user voice; skip when caller asks for
    // userOnly. We detect by presence of any tool_result child.
    if (opts.userOnly && items.some((p) => p?.type === "tool_result")) return "";
    return items
      .filter((p) => p?.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n");
  }
  if (typeof j.message?.content === "string") return j.message.content;
  // Claude assistant shape: top-level content array
  if (Array.isArray(j.content)) {
    return j.content
      .filter((p) => p?.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n");
  }
  return "";
}

function hourFromIso(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.getHours();
}

// — #2: Frustration curve (hour of day) ───────────────────────────────
//
// For each user message, hour-bucket the timestamp and flag if it
// contains a correction phrase. Output the correction-rate per hour
// so the user can see when in the day they push back the hardest.
export function frustrationByHour() {
  const rows = queryRows(`
    SELECT timestamp, raw_json
    FROM raw_events
    WHERE payload_type IN ('user_message', 'user')
       OR event_type = 'user'
    ORDER BY timestamp
  `);
  const buckets = Array.from({ length: 24 }, () => ({ total: 0, frustrated: 0 }));
  for (const r of rows) {
    const h = hourFromIso(r.timestamp);
    if (h == null) continue;
    buckets[h].total++;
    const text = extractMessageText(r);
    if (text && CORRECTION_RE.test(text)) buckets[h].frustrated++;
  }
  return {
    by_hour: buckets.map((b, h) => ({
      hour: h,
      total: b.total,
      frustrated: b.frustrated,
      rate: b.total > 0 ? b.frustrated / b.total : 0,
    })),
    total_messages: rows.length,
    total_frustrated: buckets.reduce((a, b) => a + b.frustrated, 0),
  };
}

// — #5: Cost per LOC kept (approximation) ─────────────────────────────
//
// For each cwd, sum the spend across turns that wrote there, divide by
// the current LOC of source files in that repo. Imperfect (counts cost
// that produced no code, ignores deleted lines, doesn't track AI vs
// human authorship line by line), but the ratio still surfaces the
// repos where you spent a fortune and have little to show.
function repoLineCount(cwd) {
  if (!cwd || !fs.existsSync(cwd)) return 0;
  // Only count source files we recognize, skip node_modules/.git/etc.
  // Bounded depth + extension whitelist keeps this snappy.
  const EXT = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".go", ".rs", ".java", ".kt", ".swift",
    ".rb", ".php", ".c", ".cc", ".cpp", ".h", ".hpp",
    ".cs", ".scala", ".lua", ".sh", ".sql",
    ".html", ".css", ".scss", ".vue", ".svelte",
  ]);
  const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "vendor", "target", ".venv", "__pycache__"]);
  let lines = 0;
  function walk(dir, depth) {
    if (depth > 8) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full, depth + 1);
      } else if (EXT.has(path.extname(e.name))) {
        try {
          const data = fs.readFileSync(full, "utf8");
          lines += data.split("\n").length;
        } catch { /* unreadable, skip */ }
      }
    }
  }
  walk(cwd, 0);
  return lines;
}

export function costPerLOCKept(limit = 12) {
  const rows = queryRows(`
    SELECT t.cwd,
           COUNT(DISTINCT t.turn_id) AS turns,
           SUM(COALESCE(tu.input_tokens,0) + COALESCE(tu.output_tokens,0)
               + COALESCE(tu.reasoning_output_tokens,0)) AS billable_tokens
    FROM turns t
    LEFT JOIN token_usage tu ON tu.turn_id = t.turn_id
    WHERE t.cwd IS NOT NULL AND t.cwd <> ''
    GROUP BY t.cwd
    HAVING turns > 5
    ORDER BY billable_tokens DESC
    LIMIT ${limit}
  `);
  // Use the same crude $/MTok approximation cost-overview uses for
  // rough cost. We could pull pricing.js for per-model rates but the
  // ratio is what matters here, not absolute dollar accuracy.
  const ROUGH_USD_PER_MTOK = 8;
  return rows.map((r) => {
    const tokens = Number(r.billable_tokens || 0);
    const usd = (tokens / 1_000_000) * ROUGH_USD_PER_MTOK;
    const loc = repoLineCount(r.cwd);
    return {
      cwd: r.cwd,
      cwd_short: r.cwd.replace(/^.*?\/([^/]+\/[^/]+)$/, "$1"),
      turns: Number(r.turns),
      tokens,
      cost: usd,
      loc,
      cost_per_loc: loc > 0 ? usd / loc : null,
      exists: loc > 0,
    };
  });
}

// — #6: Context-broke-the-camel's-back ────────────────────────────────
//
// For each session, walk turns in order, accumulate billable tokens.
// For each turn, check if the very next user message contains a
// correction. Bucket turns by cumulative-token band and report the
// correction-rate per band. Reveals at what context length the model's
// answers stop landing for you.
export function contextDegradationCurve() {
  const turns = queryRows(`
    SELECT t.turn_id, t.session_id, t.started_at, t.source,
           COALESCE(tu.input_tokens,0) + COALESCE(tu.output_tokens,0)
             + COALESCE(tu.reasoning_output_tokens,0) AS toks
    FROM turns t
    LEFT JOIN token_usage tu ON tu.turn_id = t.turn_id
    WHERE t.session_id IS NOT NULL AND t.started_at IS NOT NULL
    ORDER BY t.session_id, t.started_at
  `);
  const userMsgs = queryRows(`
    SELECT timestamp, raw_json, source
    FROM raw_events
    WHERE payload_type IN ('user_message', 'user') OR event_type = 'user'
    ORDER BY timestamp
  `);
  // Sort user msgs into per-session timelines via source_path proximity.
  // We index by timestamp and scan for "is there a frustrated user msg
  // within 5 minutes after the turn ended". Cheap and good enough.
  const corrTimes = [];
  for (const m of userMsgs) {
    if (!m.timestamp) continue;
    const text = extractMessageText(m);
    if (text && CORRECTION_RE.test(text)) {
      corrTimes.push(new Date(m.timestamp).getTime());
    }
  }
  corrTimes.sort((a, b) => a - b);
  function hasCorrectionShortlyAfter(iso) {
    if (!iso) return false;
    const start = new Date(iso).getTime();
    if (Number.isNaN(start)) return false;
    // Binary search the lower bound, then scan forward.
    let lo = 0, hi = corrTimes.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (corrTimes[mid] < start) lo = mid + 1; else hi = mid;
    }
    const t = corrTimes[lo];
    return t != null && t - start < 5 * 60 * 1000;
  }

  // Per-session cumulative.
  let lastSession = null;
  let cumulative = 0;
  const BUCKETS = [
    [0, 10_000, "0-10k"],
    [10_000, 25_000, "10-25k"],
    [25_000, 50_000, "25-50k"],
    [50_000, 100_000, "50-100k"],
    [100_000, 200_000, "100-200k"],
    [200_000, Infinity, "200k+"],
  ];
  const out = BUCKETS.map(([, , label]) => ({ band: label, turns: 0, corrected: 0, rate: 0 }));
  for (const t of turns) {
    if (t.session_id !== lastSession) {
      lastSession = t.session_id;
      cumulative = 0;
    }
    cumulative += Number(t.toks || 0);
    const idx = BUCKETS.findIndex(([lo, hi]) => cumulative >= lo && cumulative < hi);
    if (idx < 0) continue;
    out[idx].turns++;
    if (hasCorrectionShortlyAfter(t.started_at)) out[idx].corrected++;
  }
  out.forEach((b) => { b.rate = b.turns > 0 ? b.corrected / b.turns : 0; });
  return { by_band: out };
}

// — #8: Phantom edit graveyard ────────────────────────────────────────
//
// Files Claude/Codex wrote that don't exist on disk anymore. Either
// you renamed them, you deleted them in disgust, or the AI hallucinated
// the path. The query pulls Edit/Write/apply_patch tool calls and the
// loop just stat()s each unique target.
export function phantomEdits(limit = 50) {
  const rows = queryRows(`
    SELECT tool_name, command, status, cwd, turn_id, source
    FROM tool_events
    WHERE tool_name IN ('Edit', 'Write', 'apply_patch')
       OR tool_name = 'MultiEdit'
    ORDER BY rowid DESC
    LIMIT 5000
  `);
  // Extract file_path from tool command JSON (Claude) or unified diff
  // body (Codex apply_patch). Keep it best-effort.
  function pathFromCommand(toolName, command) {
    if (!command) return null;
    // Claude Edit/Write/MultiEdit: command is JSON-ish args text.
    try {
      const j = JSON.parse(command);
      if (j.file_path) return j.file_path;
      if (j.path) return j.path;
    } catch { /* not JSON, keep going */ }
    // Codex apply_patch: look for "*** Update File:" / "*** Add File:"
    const m = command.match(/\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+(\S+)/);
    if (m) return m[1];
    return null;
  }
  const seen = new Map();
  for (const r of rows) {
    const p = pathFromCommand(r.tool_name, r.command);
    if (!p) continue;
    const abs = path.isAbsolute(p) ? p : (r.cwd ? path.join(r.cwd, p) : p);
    if (seen.has(abs)) {
      const e = seen.get(abs);
      e.edits++;
    } else {
      seen.set(abs, {
        path: abs,
        cwd: r.cwd || null,
        edits: 1,
        last_source: r.source,
      });
    }
  }
  const out = [];
  for (const entry of seen.values()) {
    let exists = false;
    try { exists = fs.existsSync(entry.path); } catch { exists = false; }
    if (!exists) out.push(entry);
  }
  out.sort((a, b) => b.edits - a.edits);
  return out.slice(0, limit);
}

// — #9: Tool-call transitions (Sankey-ish) ────────────────────────────
//
// Sequential tool calls within the same turn, paired up: tool_i ->
// tool_{i+1}. Top N pairs by frequency surface your real workflows
// (Read -> Edit -> Bash is iterating; Read -> Read -> Read is wandering).
export function toolTransitions(limit = 15) {
  const rows = queryRows(`
    SELECT turn_id, tool_name
    FROM tool_events
    WHERE turn_id IS NOT NULL AND tool_name IS NOT NULL
    ORDER BY turn_id, rowid
  `);
  const counts = new Map();
  let lastTurn = null;
  let lastTool = null;
  for (const r of rows) {
    if (r.turn_id !== lastTurn) {
      lastTurn = r.turn_id;
      lastTool = null;
    }
    if (lastTool) {
      const key = `${lastTool}→${r.tool_name}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    lastTool = r.tool_name;
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k, v]) => {
      const [from, to] = k.split("→");
      return { from, to, count: v };
    });
}

// — #18: Pep-talk index ───────────────────────────────────────────────
//
// How often the assistant says encouraging-but-empty things, and
// whether those sessions ended in user corrections. High pep-talk +
// high correction rate is the model bullshitting.
export function pepTalkIndex() {
  const rows = queryRows(`
    SELECT timestamp, raw_json, source
    FROM raw_events
    WHERE payload_type = 'assistant' OR event_type = 'assistant'
    ORDER BY timestamp
    LIMIT 10000
  `);
  let total = 0;
  let pepCount = 0;
  const topPhrases = new Map();
  for (const r of rows) {
    const text = extractMessageText(r);
    if (!text) continue;
    total++;
    const matches = text.match(new RegExp(PEPTALK_RE.source, "gi"));
    if (matches && matches.length > 0) {
      pepCount++;
      for (const m of matches) {
        const norm = m.toLowerCase().trim();
        topPhrases.set(norm, (topPhrases.get(norm) || 0) + 1);
      }
    }
  }
  return {
    total_assistant_msgs: total,
    pep_msgs: pepCount,
    rate: total > 0 ? pepCount / total : 0,
    top_phrases: [...topPhrases.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([phrase, count]) => ({ phrase, count })),
  };
}

// — #21: AI fingerprint ───────────────────────────────────────────────
//
// One-page personality profile. Aggregates the existing tables into
// "things that would feel uncomfortably specific if a coworker said
// them about you".
export function aiFingerprint() {
  const topModel = queryRows(`
    SELECT model, COUNT(*) AS n
    FROM turns
    WHERE model IS NOT NULL AND model <> ''
    GROUP BY model
    ORDER BY n DESC
    LIMIT 3
  `);
  const peakHour = queryRows(`
    SELECT strftime('%H', started_at) AS h, COUNT(*) AS n
    FROM turns
    WHERE started_at IS NOT NULL
    GROUP BY h
    ORDER BY n DESC
    LIMIT 1
  `);
  const topProject = queryRows(`
    SELECT cwd, COUNT(*) AS n
    FROM turns
    WHERE cwd IS NOT NULL AND cwd <> ''
    GROUP BY cwd
    ORDER BY n DESC
    LIMIT 1
  `);
  const sessionStats = queryRows(`
    SELECT AVG(c) AS avg_turns
    FROM (SELECT COUNT(*) AS c FROM turns WHERE session_id IS NOT NULL GROUP BY session_id)
  `);

  // Scan user messages for: (a) most common short phrase you actually
  // say (bigrams + trigrams across all your prompts, minus stopwords);
  // (b) most common frustration token. Tool name stats were boring
  // because everyone's #1 is exec_command/Bash. Phrase stats are not.
  const userMsgs = queryRows(`
    SELECT raw_json FROM raw_events
    WHERE payload_type IN ('user_message', 'user') OR event_type = 'user'
    LIMIT 10000
  `);
  // Stopwords + ultra-short noise. Keep "you", "i", "can" as parts of
  // bigrams; we strip them only when they form the whole bigram.
  const STOP = new Set([
    "the","a","an","of","to","in","on","at","by","for","with","from","is","are","was","were",
    "be","been","being","do","does","did","this","that","these","those","it","its","as","if",
    "or","and","but","not","no","yes","so","just","very","too","also","then","than","there",
    "here","what","when","where","why","how","who","whom","which","my","me","mine","you","your",
    "yours","i","im","we","us","our","ours","he","him","his","she","her","hers","they","them",
    "their","theirs","com","de","la","el","et","un","une",
  ]);
  // Common short-phrase noise that drowns out the actual signal.
  // Two classes: connective tissue ("you can", "it is") and agent-brief
  // boilerplate ("the user", "the file") that the user types when
  // writing instructions FOR an LLM, not when talking conversationally.
  const PHRASE_BLACKLIST = new Set([
    "you can","i can","you are","i am","i was","it is","there is","there are",
    "this is","that is","you should","i should","you have","i have","i will","you will",
    "i think","you know","let me","let s","i d","you d","i ll","you ll",
    // Third-person agent-brief framing
    "the user","user 's","the file","the same","the new","the next","the current",
    "the way","the previous","the existing","the right","the wrong","the model",
    "the test","the tests","the script","the data","the page","the code","the api",
    "the agent","the assistant","the change","the changes","the fix","the issue",
    "the bug","the feature","the request","the response","the task","the step",
    "you should","do not","make sure","based on","such that","in order","as well",
    "read only","run the","use the","do the","get the","add the","set the","fix the",
    "this file","this code","this is","this should","this means","that we","that you",
    "we need","we should","we want","we have","i want","i need","i would","i d like",
    "for the","with the","without the","of the","to the","from the","on the","at the",
    "in the","by the","into the","via the","across the","through the","over the","under the",
    "as the","like the","than the","then the",
  ]);
  const bigramCounts = new Map();
  const trigramCounts = new Map();
  const frustrationCounts = new Map();
  // Codex prepends IDE context to every user_message: a markdown block
  // ("# Context from my IDE setup", "## Active file:", "## Open tabs",
  // file path listings). That stuff isn't user voice. Strip it out
  // before n-gramming, otherwise the top phrase is just file path
  // components from your project tree.
  function stripIdeContext(text) {
    // Codex pattern: when the message starts with auto-injected
    // context blocks ("# Context from my IDE setup", "# In app
    // browser", "## Active file:"), the real ask lives after
    // "## My request for Codex:". Take only that tail.
    const codexMarker = text.indexOf("## My request");
    if (codexMarker >= 0) {
      const after = text.slice(codexMarker).replace(/^##\s+My request[^\n]*\n+/, "");
      return after;
    }
    // If we see context markers but no "## My request" tail, the
    // entire message is context — drop it. Counting bullets like
    // "- The user has the in-app browser open" as user voice would
    // poison the top-phrase signal.
    if (/^\s*#\s+(?:Context from|In app browser|Active file)/im.test(text)) return "";
    // Otherwise drop lines that look like context: paths, headers,
    // "filename.ext: path" tab listings.
    return text
      .split("\n")
      .filter((line) => {
        const t = line.trim();
        if (!t) return true;
        if (/^#{1,6}\s/.test(t)) return false;            // markdown headers
        if (/^[-*]\s+\S+\.\w+:\s+\S+/.test(t)) return false;  // "- file.ts: src/x.ts" tab listing
        if (/^\/Users\//.test(t) || /^\/home\//.test(t)) return false; // bare path
        return true;
      })
      .join("\n");
  }

  // Heuristics to keep ONLY the user's conversational voice:
  // - Agent briefs are usually 500+ chars with markdown headers
  //   like "# Mission", "# Task", "You are the X Agent". The user
  //   typed them, but they're instruction-language, not natural
  //   speech. Bias the n-gram pool toward shorter messages.
  // - Frustration tokens still count from any length (you swear in
  //   long messages too), so we apply the length filter ONLY to
  //   the phrase-mining loop, not the frustration loop.
  const AGENT_BRIEF_RE =
    /^\s*#\s+(?:Mission|Task|Goal|Objective|Plan|Brief|Instructions?|Workflow)\b|^You are\s+(?:evaluating|reviewing|helping|assessing|analyzing|building|writing|designing|the\s|an?\s|my\s|now\s|going\s|asked|tasked|expected|required|responsible)|^Your\s+(?:job|task|goal|mission|role|responsibility)\b|^\s*##\s+(?:Cwd|What'?s already done|Mission|Out of scope)|^You will see\b|^You'?ll see\b/im;
  // Claude Code's bracketed system markers stored as user_message
  // when the user hits Ctrl-C or pastes from the model. Not voice.
  const SYSTEM_MARKER_RE =
    /^\s*\[Request interrupted by user|^\s*\[?Caveat:\s*The messages|^\s*<system-reminder>|^\s*<task-notification>|^\s*<command-name>|^\s*<command-message>|^\s*\[Image:?\s*source:|^\s*\[Image\s*\d*\s*:|^\s*\[Pasted text/i;

  for (const m of userMsgs) {
    const rawText = extractMessageText(m, { userOnly: true });
    if (!rawText) continue;
    // Codex auto-review wraps the whole previous transcript inside a
    // user_message ("The following is the Codex agent history...
    // >>> TRANSCRIPT START"). That's machine-generated meta-prompt
    // content, not your voice. Skip the entire message.
    if (
      /The following is the Codex agent history/i.test(rawText) ||
      />>> TRANSCRIPT START/i.test(rawText) ||
      SYSTEM_MARKER_RE.test(rawText)
    ) continue;
    const text = stripIdeContext(rawText);
    if (!text) continue;
    // Frustration: keep counting individual matches by lemma.
    const frust = text.match(new RegExp(CORRECTION_RE.source, "gi"));
    if (frust) for (const x of frust) {
      const norm = x.toLowerCase().trim();
      frustrationCounts.set(norm, (frustrationCounts.get(norm) || 0) + 1);
    }
    // Phrase mining: only on conversational messages. Skip agent
    // briefs (long messages, role-assignment markers). Frustration
    // already counted above regardless of length.
    if (text.length > 500) continue;
    if (AGENT_BRIEF_RE.test(text)) continue;
    // Phrase mining: split into words, generate 2- and 3-grams, drop
    // anything where the boundary words are both stopwords (those are
    // basically connective tissue, not your "voice").
    const words = text
      .toLowerCase()
      .replace(/```[\s\S]*?```/g, " ")  // strip code blocks (massive false-positive source)
      .replace(/`[^`]*`/g, " ")          // inline code
      .replace(/https?:\/\/\S+/g, " ")    // URLs
      .replace(/\S+\/\S+/g, " ")          // anything with a slash (paths)
      .replace(/&[a-z]+;/g, " ")          // html entities (&gt; -> "gt")
      .replace(/[^a-z0-9\s']/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 1 && w.length <= 20)
      // Drop pure-numeric tokens and hex-ish tokens (git hashes,
      // commit refs leak through as "index 6aeyk..."). Threshold:
      // mixed alphanumeric of length >=6 with >=2 digits = probably
      // a hash. Real english words almost never look like that.
      .filter((w) => {
        if (/^\d+$/.test(w)) return false;
        // Any mixed alphanumeric of length >= 6 is overwhelmingly
        // a hash, commit ref, build id, or session id. Real english
        // tokens that mix letters and digits at that length (ipv6,
        // utf8, sha256) are rare and not phrase-y anyway.
        if (w.length >= 6 && /\d/.test(w) && /[a-z]/.test(w)) return false;
        return true;
      });
    for (let i = 0; i + 1 < words.length; i++) {
      const a = words[i], b = words[i + 1];
      // Both stop -> connective tissue. One stop is fine ("the file").
      if (STOP.has(a) && STOP.has(b)) continue;
      // Single-letter tokens or numbers are noise.
      if (a.length < 2 || b.length < 2) continue;
      const key = `${a} ${b}`;
      if (PHRASE_BLACKLIST.has(key)) continue;
      bigramCounts.set(key, (bigramCounts.get(key) || 0) + 1);
      if (i + 2 < words.length) {
        const c = words[i + 2];
        if (c.length >= 2) {
          // Trigram: skip if every word is a stopword.
          if (STOP.has(a) && STOP.has(b) && STOP.has(c)) continue;
          const k3 = `${a} ${b} ${c}`;
          trigramCounts.set(k3, (trigramCounts.get(k3) || 0) + 1);
        }
      }
    }
  }
  // Top-N for both bigrams and trigrams. Trigrams read better as
  // "phrases" (more specific) so we lean on them when they have
  // comparable volume. Surface a top-5 list, not just the single
  // winner, so the texture comes through.
  const sortedBigrams = [...bigramCounts.entries()].sort((a, b) => b[1] - a[1]);
  const sortedTrigrams = [...trigramCounts.entries()].sort((a, b) => b[1] - a[1]);
  // Merge: trigrams whose count is at least 0.5x top bigram are
  // promoted into the favorite list; otherwise bigrams dominate.
  const topBigramCount = sortedBigrams[0]?.[1] || 0;
  const merged = [
    ...sortedTrigrams
      .filter(([, c]) => c >= topBigramCount * 0.5)
      .map(([phrase, count]) => ({ phrase, count, n: 3 })),
    ...sortedBigrams.map(([phrase, count]) => ({ phrase, count, n: 2 })),
  ]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const favoritePhrase = merged[0] || null;

  const sortedFrustration = [...frustrationCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([phrase, count]) => ({ phrase, count }));
  const topFrustration = sortedFrustration[0] || null;

  return {
    top_models: topModel.map((r) => ({ model: r.model, count: Number(r.n) })),
    peak_hour: peakHour[0] ? Number(peakHour[0].h) : null,
    peak_hour_count: peakHour[0] ? Number(peakHour[0].n) : 0,
    top_project: topProject[0]?.cwd || null,
    top_project_turns: topProject[0] ? Number(topProject[0].n) : 0,
    favorite_phrase: favoritePhrase,
    favorite_phrases: merged,
    most_frustrating_phrase: topFrustration,
    frustrating_phrases: sortedFrustration,
    avg_turns_per_session: sessionStats[0]?.avg_turns
      ? Math.round(Number(sessionStats[0].avg_turns) * 10) / 10
      : 0,
    top_correction_phrase: topFrustration,
  };
}
