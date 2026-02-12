import os from 'os';

const VAR_PATTERN = /\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * Expand $VAR, ${VAR}, and ~/ in a string value
 * Resolution order: vars object first, then env fallback
 * Unresolved variables are left as-is
 * @param {string} value - String to expand
 * @param {object} vars - Custom variables (e.g. from mcp-vars)
 * @param {object} env - Environment variables (defaults to process.env)
 * @returns {{ result: string, unresolved: string[] }}
 */
export function expandString(value, vars = {}, env = process.env) {
  if (typeof value !== 'string') {
    return { result: value, unresolved: [] };
  }

  const unresolved = [];

  // Expand ~/ at start of string
  let expanded = value;
  if (expanded.startsWith('~/')) {
    expanded = os.homedir() + expanded.slice(1);
  }

  // Expand $VAR and ${VAR}
  expanded = expanded.replace(VAR_PATTERN, (match, bracedName, plainName) => {
    const name = bracedName || plainName;
    if (name in vars) return vars[name];
    if (name in env) return env[name];
    unresolved.push(name);
    return match;
  });

  return { result: expanded, unresolved };
}

const expandIfPresentAndSetField = (target, field, expander) => {
  if (target[field]) {
    target[field] = expander(target[field]);
  }
};

const expandObject = (item, expander) => {
  const expanded = {};
  for (const [key, value] of Object.entries(item)) {
    expanded[key] = expander(value);
  }
  return expanded;
};
const makeObjectExpander = (expander) => (item) => expandObject(item, expander);

/**
 * Expand variables in all string fields of a server definition
 * Expands: command, args items, env values, url, headers values
 * Does NOT expand keys
 * @param {object} server - Server definition object
 * @param {object} vars - Custom variables
 * @param {object} env - Environment variables
 * @returns {{ server: object, unresolved: string[] }}
 */
export function expandServerVars(server, vars = {}, env = process.env) {
  const allUnresolved = [];
  const result = { ...server };

  const expand = (value) => {
    const { result: expanded, unresolved } = expandString(value, vars, env);
    allUnresolved.push(...unresolved);
    return expanded;
  };

  expandIfPresentAndSetField(result, 'command', expand);
  expandIfPresentAndSetField(result, 'url', expand);
  expandIfPresentAndSetField(result, 'args', (targetField) =>
    targetField.map((arg) => expand(arg))
  );
  expandIfPresentAndSetField(result, 'env', makeObjectExpander(expand));
  expandIfPresentAndSetField(result, 'headers', makeObjectExpander(expand));

  return { server: result, unresolved: [...new Set(allUnresolved)] };
}
