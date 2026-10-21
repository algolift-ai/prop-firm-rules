// A small JSON Schema validator: exactly the keywords schema.json uses, and no
// others. It refuses a schema that uses a keyword it does not implement, so the
// schema can never rely on a check that nothing runs. No dependencies.
//
// Implemented: type, enum, const, properties, required, additionalProperties,
// items, minItems, minimum, maximum, pattern, format ("date"), anyOf, and $ref
// to "#/$defs/<name>". Annotations ($schema, $id, $defs, title, description,
// $comment) are read and ignored.
//
// SPDX-License-Identifier: MIT

const ANNOTATIONS = new Set(["$schema", "$id", "$defs", "title", "description", "$comment"]);
const KEYWORDS = new Set([
  "type",
  "enum",
  "const",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "minItems",
  "minimum",
  "maximum",
  "pattern",
  "format",
  "anyOf",
  "$ref",
]);

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date in YYYY-MM-DD form. */
export function isDate(s) {
  const m = typeof s === "string" ? DATE.exec(s) : null;
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function typeMatches(v, t) {
  const actual = typeOf(v);
  return actual === t || (t === "number" && actual === "integer");
}

/** Throws if the schema (or any schema inside it) uses a keyword this file does not implement. */
export function assertSupported(schema, where = "#") {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    throw new Error(`${where}: a schema must be an object`);
  }
  for (const [k, v] of Object.entries(schema)) {
    if (ANNOTATIONS.has(k)) {
      if (k === "$defs") for (const [name, sub] of Object.entries(v)) assertSupported(sub, `${where}/$defs/${name}`);
      continue;
    }
    if (!KEYWORDS.has(k)) throw new Error(`${where}: the schema uses "${k}", which scripts/lib/schema.mjs does not implement`);
    if (k === "properties") for (const [name, sub] of Object.entries(v)) assertSupported(sub, `${where}/properties/${name}`);
    if (k === "items" || (k === "additionalProperties" && typeof v === "object")) assertSupported(v, `${where}/${k}`);
    if (k === "anyOf") v.forEach((sub, i) => assertSupported(sub, `${where}/anyOf/${i}`));
    if (k === "format" && v !== "date") throw new Error(`${where}: format "${v}" is not implemented`);
  }
}

/**
 * Validates `value` against `schema` (with `root` holding the $defs). Returns a list of
 * error strings, each naming the JSON path that failed; an empty list means valid.
 */
export function validate(value, schema, root = schema, path = "$") {
  const errors = [];
  if (schema.$ref !== undefined) {
    const m = /^#\/\$defs\/(.+)$/.exec(schema.$ref);
    const target = m ? root.$defs?.[m[1]] : undefined;
    if (!target) {
      errors.push(`${path}: unresolvable $ref ${schema.$ref}`);
      return errors;
    }
    errors.push(...validate(value, target, root, path));
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(value, t))) {
      errors.push(`${path}: expected ${types.join(" or ")}, got ${typeOf(value)}`);
      return errors;
    }
  }
  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    errors.push(`${path}: must be ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum !== undefined && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    errors.push(`${path}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: must be at most ${schema.maximum}`);
  }
  if (typeof value === "string") {
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) {
      errors.push(`${path}: does not match ${schema.pattern}`);
    }
    if (schema.format === "date" && !isDate(value)) errors.push(`${path}: is not a YYYY-MM-DD date`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: needs at least ${schema.minItems} items`);
    }
    if (schema.items !== undefined) value.forEach((v, i) => errors.push(...validate(v, schema.items, root, `${path}[${i}]`)));
  }
  if (typeOf(value) === "object") {
    for (const k of schema.required ?? []) if (!(k in value)) errors.push(`${path}: is missing "${k}"`);
    const props = schema.properties ?? {};
    for (const [k, v] of Object.entries(value)) {
      if (k in props) errors.push(...validate(v, props[k], root, `${path}.${k}`));
      else if (schema.additionalProperties === false) errors.push(`${path}: has an unknown field "${k}"`);
      else if (typeof schema.additionalProperties === "object") {
        errors.push(...validate(v, schema.additionalProperties, root, `${path}.${k}`));
      }
    }
  }
  if (schema.anyOf !== undefined) {
    const branches = schema.anyOf.map((s) => validate(value, s, root, path));
    if (!branches.some((b) => b.length === 0)) {
      // Report the branch that came closest, so the message points at the real problem.
      const best = branches.reduce((a, b) => (b.length < a.length ? b : a));
      errors.push(...best);
    }
  }
  return errors;
}
