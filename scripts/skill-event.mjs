import { appendExplicitSkillEvent } from "../src/lib/importer.js";

function usage() {
  return `Usage:
  npm run skill-event -- start --skill <name> [--turn <turn_id>] [--notes <text>]
  npm run skill-event -- success --skill <name> [--turn <turn_id>] [--notes <text>]
  npm run skill-event -- error --skill <name> [--turn <turn_id>] [--notes <text>] [--category <name>]
  npm run skill-event -- skipped --skill <name> [--turn <turn_id>] [--notes <text>]`;
}

const [, , eventType, ...args] = process.argv;
const parsed = { eventType };

for (let i = 0; i < args.length; i += 1) {
  const key = args[i];
  const value = args[i + 1];
  if (!key?.startsWith("--")) continue;
  parsed[key.slice(2)] = value;
  i += 1;
}

if (!eventType || !parsed.skill) {
  console.error(usage());
  process.exit(2);
}

const result = appendExplicitSkillEvent({
  eventType,
  skill: parsed.skill,
  turnId: parsed.turn,
  notes: parsed.notes,
  category: parsed.category,
  error: parsed.error
});

console.log(JSON.stringify(result, null, 2));
