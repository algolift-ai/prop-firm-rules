// The dataset's checks, as pure functions over loaded files, so the tests can
// run them on fixtures. scripts/validate.mjs loads the repo and prints these.
//
// SPDX-License-Identifier: MIT

import { createHash } from "node:crypto";
import { assertSupported, isDate, validate } from "./schema.mjs";

export const RULE_GROUPS = ["account", "evaluation", "funded", "payouts"];

/** JSON with object keys sorted and no whitespace: the form both hashes are taken over. */
export function canonicalJson(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(v)
    .sort()
    .filter((k) => v[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`)
    .join(",")}}`;
}

export const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

/** A plan file's values only (no sources or dates): what values_sha256 covers. */
export function valuesOf(file) {
  const pick = (g) => (g === null ? null : Object.fromEntries(Object.entries(g).map(([k, leaf]) => [k, leaf.value])));
  return {
    rules: Object.fromEntries(RULE_GROUPS.map((g) => [g, pick(file.rules[g])])),
    prices: pick(file.prices),
  };
}

/** Every rule and price of a plan file, as [rule id, leaf]. */
export function leavesOf(file) {
  const out = [];
  for (const g of RULE_GROUPS) for (const [k, leaf] of Object.entries(file.rules?.[g] ?? {})) out.push([`${g}.${k}`, leaf]);
  for (const [k, leaf] of Object.entries(file.prices ?? {})) out.push([`prices.${k}`, leaf]);
  return out;
}

const DAY_MS = 86_400_000;
const dayNumber = (ymd) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / DAY_MS;

/** Days from `date` to `today`, both YYYY-MM-DD. */
export const ageInDays = (date, today) => dayNumber(today) - dayNumber(date);

function oldestDated(leaves) {
  if (leaves.some((l) => !(l.status === "verified" || l.status === "not_stated") || !l.verified || !l.source_url)) return null;
  return leaves.map((l) => l.verified).sort()[0] ?? null;
}

/**
 * Checks one plan file. `path` is its repo path ("rules/topstep/50k.json"); `engine` is the
 * plan's entry in engine/catalog.json (or undefined). Returns { errors, notices }.
 */
export function checkPlanFile(file, { path, schema, engine, today, windowDays, allowNotStated = false }) {
  const errors = [];
  const notices = [];
  const schemaErrors = validate(file, schema);
  if (schemaErrors.length) return { errors: schemaErrors.map((e) => `does not match schema.json: ${e}`), notices };

  const expectedPath = `rules/${file.id}.json`;
  if (path !== expectedPath) errors.push(`its id "${file.id}" says it belongs at ${expectedPath}`);
  if (file.id !== `${file.firm.slug}/${file.plan.slug}`) errors.push(`its id "${file.id}" does not match firm.slug/plan.slug`);

  if (file.plan.status === "unverified" || !file.plan.source_url) errors.push("the plan itself has not been checked (plan.status unverified or no plan.source_url)");
  if (file.plan.status === "discontinued") notices.push("the firm no longer sells this plan");

  for (const [id, leaf] of leavesOf(file)) {
    if (!leaf.source_url) errors.push(`${id} has no source`);
    if (!leaf.verified) errors.push(`${id} has no verified date`);
    if (leaf.status === "differs") errors.push(`${id} differs from its source: the firm states something else (the simulator must be updated first)`);
    else if (leaf.status === "unverified" && leaf.source_url && leaf.verified) errors.push(`${id} is marked unverified`);
    if (leaf.verified && isDate(leaf.verified)) {
      const age = ageInDays(leaf.verified, today);
      if (age < 0) errors.push(`${id} is dated ${leaf.verified}, in the future`);
      else if (age > windowDays) errors.push(`${id} was last verified ${leaf.verified}, ${age} days ago (the re-check window is ${windowDays} days)`);
    }
    if (leaf.status === "not_stated") {
      if (allowNotStated) notices.push(`${id} is not stated by the firm (AlgoLift's assumption)`);
      else errors.push(`${id} is not stated by the firm's pages, so it cannot be published as sourced (allow_not_stated is off)`);
    }
  }

  const ruleLeaves = RULE_GROUPS.flatMap((g) => Object.values(file.rules[g] ?? {}));
  if (file.rules_verified !== oldestDated(ruleLeaves)) errors.push(`rules_verified is ${file.rules_verified}, but its rules give ${oldestDated(ruleLeaves)}`);
  const priceLeaves = Object.values(file.prices);
  if (file.prices_verified !== oldestDated(priceLeaves)) errors.push(`prices_verified is ${file.prices_verified}, but its prices give ${oldestDated(priceLeaves)}`);

  if (!engine) errors.push(`engine/catalog.json has no plan "${file.generated.engine_id}"`);
  else if (sha256(canonicalJson(engine)) !== file.generated.engine_sha256) {
    errors.push(`does not match engine/catalog.json's "${file.generated.engine_id}": regenerate it with AlgoLift's exporter`);
  }
  if (sha256(canonicalJson(valuesOf(file))) !== file.generated.values_sha256) {
    errors.push("its values do not match the values it was generated with: values change in AlgoLift's simulator, never by hand");
  }
  return { errors, notices };
}

/**
 * Checks the whole dataset. `files` maps repo path to parsed JSON for every rules/**.json;
 * `catalog` is engine/catalog.json; `index` is index.json. Returns { errors, notices, counts },
 * where errors and notices are [path, message] pairs.
 */
export function checkDataset({ files, schema, catalog, index, today, windowDays, allowNotStated = false }) {
  const errors = [];
  const notices = [];
  assertSupported(schema);
  if (!isDate(today)) throw new Error(`today must be YYYY-MM-DD, got ${today}`);

  const presets = new Map((catalog?.presets ?? []).map((p) => [p.id, p]));
  if (!catalog || !Array.isArray(catalog.presets)) errors.push(["engine/catalog.json", "is missing or has no presets"]);

  const seenEngine = new Map();
  for (const [path, file] of files) {
    const engineId = file?.generated?.engine_id;
    const r = checkPlanFile(file, { path, schema, engine: presets.get(engineId), today, windowDays, allowNotStated });
    r.errors.forEach((m) => errors.push([path, m]));
    r.notices.forEach((m) => notices.push([path, m]));
    if (engineId) {
      if (seenEngine.has(engineId)) errors.push([path, `has the same engine plan as ${seenEngine.get(engineId)}`]);
      seenEngine.set(engineId, path);
    }
  }
  for (const id of presets.keys()) {
    if (!seenEngine.has(id)) errors.push(["engine/catalog.json", `plan "${id}" has no file under rules/`]);
  }

  const listed = new Map((index?.plans ?? []).map((p) => [p.path, p]));
  if (!index) errors.push(["index.json", "is missing"]);
  for (const [path, file] of files) {
    const entry = listed.get(path);
    if (!entry) errors.push(["index.json", `does not list ${path}`]);
    else if (
      entry.id !== file.id ||
      entry.rules_verified !== file.rules_verified ||
      entry.prices_verified !== file.prices_verified ||
      entry.firm !== file.firm?.name ||
      entry.plan !== file.plan?.name
    ) {
      errors.push(["index.json", `its entry for ${path} does not match the file`]);
    }
  }
  for (const path of listed.keys()) if (!files.has(path)) errors.push(["index.json", `lists ${path}, which does not exist`]);

  return { errors, notices, counts: { plans: files.size, errors: errors.length, notices: notices.length } };
}
