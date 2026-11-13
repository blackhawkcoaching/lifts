/**
 * A small JSON Schema subset (draft 2020-12) sufficient for liftplan 0.1.
 * Unknown keywords are ignored. additionalProperties:false is enforced;
 * any other additionalProperties value means extra fields are skipped.
 */

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function typeOk(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "string") return typeof value === "string";
  if (type === "boolean") return typeof value === "boolean";
  return false;
}

function resolveRef(root, ref) {
  if (!ref.startsWith("#/")) {
    return null;
  }
  const parts = ref.slice(2).split("/").map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
  let node = root;
  for (const part of parts) {
    if (node == null || typeof node !== "object") return null;
    node = node[part];
  }
  return node;
}

function checkNumber(data, schema, path, errors) {
  if (typeof data !== "number" || !Number.isFinite(data)) return;
  if (schema.minimum != null && data < schema.minimum) {
    errors.push({ instancePath: path, keyword: "minimum", limit: schema.minimum, actual: data });
  }
  if (schema.maximum != null && data > schema.maximum) {
    errors.push({ instancePath: path, keyword: "maximum", limit: schema.maximum, actual: data });
  }
  if (schema.exclusiveMinimum != null && data <= schema.exclusiveMinimum) {
    errors.push({
      instancePath: path,
      keyword: "exclusiveMinimum",
      limit: schema.exclusiveMinimum,
      actual: data,
    });
  }
  if (schema.exclusiveMaximum != null && data >= schema.exclusiveMaximum) {
    errors.push({
      instancePath: path,
      keyword: "exclusiveMaximum",
      limit: schema.exclusiveMaximum,
      actual: data,
    });
  }
}

function walk(data, schema, path, errors, root) {
  if (!schema || typeof schema !== "object") return;
  if (schema.$ref) {
    const next = resolveRef(root, schema.$ref);
    if (!next) {
      errors.push({ instancePath: path, keyword: "ref", message: `Unknown schema ref ${schema.$ref}` });
      return;
    }
    walk(data, next, path, errors, root);
    return;
  }

  if (Array.isArray(schema.anyOf)) {
    const branches = schema.anyOf.map((branch) => {
      const local = [];
      walk(data, branch, path, local, root);
      return local;
    });
    if (branches.some((branch) => branch.length === 0)) return;
    errors.push({ instancePath: path, keyword: "anyOf", actual: typeOf(data) });
    return;
  }

  if (schema.const !== undefined && data !== schema.const) {
    errors.push({ instancePath: path, keyword: "const", expected: schema.const, actual: data });
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(data)) {
    errors.push({ instancePath: path, keyword: "enum", expected: schema.enum, actual: data });
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const matches = types.some((type) => typeOk(data, type));
    if (!matches) {
      const integerAsked = types.includes("integer") && typeof data === "number";
      errors.push({
        instancePath: path,
        keyword: integerAsked ? "integer" : "type",
        expected: types,
        actual: typeOf(data),
      });
      return;
    }
  }

  if (typeof data === "string") {
    if (schema.minLength != null && data.length < schema.minLength) {
      errors.push({ instancePath: path, keyword: "minLength", limit: schema.minLength });
    }
    if (schema.maxLength != null && data.length > schema.maxLength) {
      errors.push({ instancePath: path, keyword: "maxLength", limit: schema.maxLength });
    }
    if (schema.pattern) {
      const re = new RegExp(schema.pattern);
      if (!re.test(data)) {
        errors.push({ instancePath: path, keyword: "pattern", pattern: schema.pattern });
      }
    }
  }

  checkNumber(data, schema, path, errors);

  if (data && typeof data === "object" && !Array.isArray(data)) {
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (data[key] === undefined) {
          errors.push({
            instancePath: `${path}/${key}`,
            keyword: "required",
            missing: key,
          });
        }
      }
    }
    if (schema.properties) {
      const defined = new Set(Object.keys(schema.properties));
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (data[key] !== undefined) {
          walk(data[key], propSchema, `${path}/${encodePath(key)}`, errors, root);
        }
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(data)) {
          if (!defined.has(key)) {
            errors.push({ instancePath: `${path}/${encodePath(key)}`, keyword: "additionalProperties", key });
          }
        }
      }
    }
  }

  if (Array.isArray(data)) {
    if (schema.minItems != null && data.length < schema.minItems) {
      errors.push({ instancePath: path, keyword: "minItems", limit: schema.minItems, actual: data.length });
    }
    if (schema.maxItems != null && data.length > schema.maxItems) {
      errors.push({ instancePath: path, keyword: "maxItems", limit: schema.maxItems, actual: data.length });
    }
    if (schema.items) {
      data.forEach((item, index) => {
        walk(item, schema.items, `${path}/${index}`, errors, root);
      });
    }
  }
}

function encodePath(key) {
  return String(key).replace(/~/g, "~0").replace(/\//g, "~1");
}

export function validateAgainstSchema(data, schema) {
  const errors = [];
  walk(data, schema, "", errors, schema);
  return errors;
}
