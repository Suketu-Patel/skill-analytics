import { importAll } from "../src/lib/importer.js";

const started = Date.now();
const result = importAll();
console.log(
  JSON.stringify(
    {
      ok: true,
      duration_ms: Date.now() - started,
      ...result
    },
    null,
    2
  )
);
