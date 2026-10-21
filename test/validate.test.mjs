// Tests for the validator: the schema subset, and every way a plan file can fail.
// Run: node --test
//
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSupported, isDate, validate } from "../scripts/lib/schema.mjs";
import { ageInDays, canonicalJson, checkDataset, checkPlanFile, leavesOf, sha256, valuesOf } from "../scripts/lib/checks.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const schema = read("schema.json");
const catalog = read("engine/catalog.json");
const TODAY = "2026-10-20";

/** A real plan file with every rule cited, verified and fresh: the passing baseline. */
function verifiedPlan(rel = "rules/topstep/50k.json") {
  const file = structuredClone(read(rel));
  for (const [, leaf] of leavesOf(file)) {
    leaf.source_url = "https://example.com/rules";
    leaf.verified = "2026-10-16";
    leaf.status = "verified";
  }
  file.plan.status = "active";
  file.plan.source_url = "https://example.com/plan";
  file.rules_verified = "2026-10-16";
  file.prices_verified = "2026-10-16";
  return file;
}

const engineFor = (file) => catalog.presets.find((p) => p.id === file.generated.engine_id);
const check = (file, today = TODAY, windowDays = 45) =>
  checkPlanFile(file, { path: `rules/${file.id}.json`, schema, engine: engineFor(file), today, windowDays });

// ---------------------------------------------------------------- the schema subset

test("the schema uses only keywords the validator implements", () => {
  assert.doesNotThrow(() => assertSupported(schema));
});

test("a schema keyword the validator does not implement is refused, not ignored", () => {
  assert.throws(() => assertSupported({ type: "object", oneOf: [] }), /oneOf/);
  assert.throws(() => assertSupported({ type: "string", format: "email" }), /format/);
});

test("types, enums, patterns, ranges and anyOf", () => {
  const s = { type: "object", additionalProperties: false, required: ["a"], properties: { a: { type: ["integer", "null"], minimum: 0 }, b: { enum: ["x"] } } };
  assert.deepEqual(validate({ a: 3 }, s), []);
  assert.deepEqual(validate({ a: null }, s), []);
  assert.equal(validate({ a: 1.5 }, s).length, 1);
  assert.equal(validate({ a: -1 }, s).length, 1);
  assert.equal(validate({}, s).length, 1);
  assert.equal(validate({ a: 1, b: "y" }, s).length, 1);
  assert.equal(validate({ a: 1, c: 1 }, s).length, 1);
  assert.deepEqual(validate("2026-02-28", { type: "string", format: "date" }), []);
  assert.equal(validate("2026-02-30", { type: "string", format: "date" }).length, 1);
  assert.equal(validate(5, { anyOf: [{ type: "string" }, { type: "null" }] }).length > 0, true);
});

test("isDate accepts real dates only", () => {
  assert.equal(isDate("2024-02-29"), true);
  assert.equal(isDate("2025-02-29"), false);
  assert.equal(isDate("2026-1-01"), false);
});

// ------------------------------------------------------------------ plan files

test("a fully verified, fresh plan file passes", () => {
  const r = check(verifiedPlan());
  assert.deepEqual(r.errors, []);
});

test("every plan file in the repo matches the schema", () => {
  for (const firm of fs.readdirSync(path.join(ROOT, "rules"))) {
    for (const name of fs.readdirSync(path.join(ROOT, "rules", firm))) {
      const errs = validate(read(`rules/${firm}/${name}`), schema);
      assert.deepEqual(errs, [], `rules/${firm}/${name}`);
    }
  }
});

test("a rule without a source or a date fails", () => {
  const file = verifiedPlan();
  file.rules.evaluation.profit_target.source_url = null;
  file.rules.evaluation.profit_target.verified = null;
  file.rules.evaluation.profit_target.status = "unverified";
  file.rules_verified = null;
  const msgs = check(file).errors.join("\n");
  assert.match(msgs, /evaluation\.profit_target has no source/);
  assert.match(msgs, /evaluation\.profit_target has no verified date/);
});

test("a rule older than the re-check window fails, and the window is configurable", () => {
  const file = verifiedPlan();
  assert.match(check(file, "2026-12-15").errors.join("\n"), /days ago \(the re-check window is 45 days\)/);
  assert.deepEqual(check(file, "2026-12-15", 90).errors, []);
});

test("a date in the future fails", () => {
  assert.match(check(verifiedPlan(), "2026-10-01").errors.join("\n"), /in the future/);
});

test("a rule whose source states something else fails", () => {
  const file = verifiedPlan();
  file.prices.evaluation_fee.status = "differs";
  file.prices_verified = null;
  assert.match(check(file).errors.join("\n"), /prices\.evaluation_fee differs from its source/);
});

test("a rule the firm does not state fails, unless the config allows it (then a note)", () => {
  const file = verifiedPlan();
  file.prices.reset_fee.status = "not_stated";
  assert.match(check(file).errors.join("\n"), /prices\.reset_fee is not stated by the firm's pages/);
  const r = checkPlanFile(file, { path: `rules/${file.id}.json`, schema, engine: engineFor(file), today: TODAY, windowDays: 45, allowNotStated: true });
  assert.deepEqual(r.errors, []);
  assert.match(r.notices.join("\n"), /prices\.reset_fee is not stated by the firm/);
});

test("a value edited by hand fails the values hash", () => {
  const file = verifiedPlan();
  file.rules.evaluation.profit_target.value += 1;
  assert.match(check(file).errors.join("\n"), /values do not match/);
});

test("a file that no longer matches the engine catalogue fails", () => {
  const file = verifiedPlan();
  const engine = structuredClone(engineFor(file));
  engine.settings.evalProfitTarget += 1;
  const r = checkPlanFile(file, { path: `rules/${file.id}.json`, schema, engine, today: TODAY, windowDays: 45 });
  assert.match(r.errors.join("\n"), /does not match engine\/catalog\.json/);
});

test("rules_verified must be the oldest rule date", () => {
  const file = verifiedPlan();
  file.rules.funded.max_drawdown.verified = "2026-10-10";
  assert.match(check(file).errors.join("\n"), /rules_verified is 2026-10-16, but its rules give 2026-10-10/);
});

test("a file in the wrong place fails", () => {
  const file = verifiedPlan();
  const r = checkPlanFile(file, { path: "rules/topstep/other.json", schema, engine: engineFor(file), today: TODAY, windowDays: 45 });
  assert.match(r.errors.join("\n"), /belongs at rules\/topstep\/50k\.json/);
});

test("hashes are over canonical JSON, so key order does not matter", () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}');
  const file = read("rules/topstep/50k.json");
  assert.equal(sha256(canonicalJson(valuesOf(file))), file.generated.values_sha256);
});

test("ageInDays counts calendar days", () => {
  assert.equal(ageInDays("2026-10-16", "2026-11-30"), 45);
  assert.equal(ageInDays("2026-02-28", "2026-03-01"), 1);
});

// --------------------------------------------------------------------- dataset

test("the dataset check catches a plan missing from rules/ and a stray index entry", () => {
  const file = verifiedPlan();
  const files = new Map([[`rules/${file.id}.json`, file]]);
  const index = {
    plans: [
      { id: file.id, path: `rules/${file.id}.json`, firm: file.firm.name, plan: file.plan.name, rules_verified: file.rules_verified, prices_verified: file.prices_verified },
      { id: "x/y", path: "rules/x/y.json", firm: "X", plan: "Y", rules_verified: null, prices_verified: null },
    ],
  };
  const { errors } = checkDataset({ files, schema, catalog, index, today: TODAY, windowDays: 45 });
  const msgs = errors.map(([w, m]) => `${w}: ${m}`).join("\n");
  assert.match(msgs, /plan "apex-eod-25k" has no file under rules\//);
  assert.match(msgs, /lists rules\/x\/y\.json, which does not exist/);
  assert.doesNotMatch(msgs, /rules\/topstep\/50k\.json: /);
});
