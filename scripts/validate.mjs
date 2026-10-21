#!/usr/bin/env node
// Validates the dataset. Fails (exit 1) when:
//   - a file under rules/ does not match schema.json;
//   - a rule or price has no source or no verified date, or its source states something else, or
//     the firm does not state it (unless prop-rules.config.json sets allow_not_stated);
//   - a rule or price was verified longer ago than the re-check window (prop-rules.config.json);
//   - a file does not match engine/catalog.json, the simulator's catalogue it is generated from,
//     or its values were edited by hand;
//   - index.json does not list exactly the files under rules/.
//
//   node scripts/validate.mjs [--today YYYY-MM-DD] [--window DAYS] [--root DIR] [--quiet]
//
// No dependencies: Node 18 or later.
//
// SPDX-License-Identifier: MIT

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkDataset } from "./lib/checks.mjs";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const root = path.resolve(arg("--root") ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const quiet = process.argv.includes("--quiet");
const readJson = (rel) => {
  const p = path.join(root, rel);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
};

const config = readJson("prop-rules.config.json") ?? {};
const windowDays = Number(arg("--window") ?? config.recheck_window_days ?? 45);
const today = arg("--today") ?? new Date().toISOString().slice(0, 10);
const allowNotStated = config.allow_not_stated === true;

const files = new Map();
const rulesDir = path.join(root, "rules");
const parseErrors = [];
if (fs.existsSync(rulesDir)) {
  for (const firm of fs.readdirSync(rulesDir, { withFileTypes: true })) {
    if (!firm.isDirectory()) {
      parseErrors.push([`rules/${firm.name}`, "rules/ holds only firm folders"]);
      continue;
    }
    for (const name of fs.readdirSync(path.join(rulesDir, firm.name))) {
      const rel = `rules/${firm.name}/${name}`;
      if (!name.endsWith(".json")) {
        parseErrors.push([rel, "is not a .json file"]);
        continue;
      }
      try {
        files.set(rel, JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")));
      } catch (e) {
        parseErrors.push([rel, `is not valid JSON (${e.message})`]);
      }
    }
  }
}

const result = checkDataset({
  files,
  schema: readJson("schema.json"),
  catalog: readJson("engine/catalog.json"),
  index: readJson("index.json"),
  today,
  windowDays,
  allowNotStated,
});
const errors = [...parseErrors, ...result.errors];

if (!quiet) for (const [where, msg] of result.notices) console.log(`note  ${where}: ${msg}`);
for (const [where, msg] of errors) console.log(`FAIL  ${where}: ${msg}`);
console.log(
  `\n${files.size} plan files checked on ${today} (re-check window ${windowDays} days): ` +
    (errors.length ? `${errors.length} problems` : "all valid") +
    (result.notices.length ? `, ${result.notices.length} notes` : ""),
);
process.exit(errors.length ? 1 : 0);
