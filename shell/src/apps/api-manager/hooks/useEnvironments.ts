/**
 * useEnvironments Hook
 * Handles variable substitution in requests
 */

import type { Environment, KeyValuePair } from '../types';

/**
 * Replace {{variable}} placeholders with environment values
 */
export function resolveVariables(
  text: string,
  environment: Environment | null
): string {
  if (!environment || !text) return text;

  let result = text;
  for (const variable of environment.variables) {
    if (variable.enabled) {
      const pattern = new RegExp(`\\{\\{${escapeRegExp(variable.key)}\\}\\}`, 'g');
      result = result.replace(pattern, variable.value);
    }
  }
  return result;
}

/**
 * Escape special regex characters
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve variables in a key-value pair array
 */
export function resolveKeyValuePairs(
  pairs: KeyValuePair[],
  environment: Environment | null
): KeyValuePair[] {
  return pairs.map((pair) => ({
    ...pair,
    key: resolveVariables(pair.key, environment),
    value: resolveVariables(pair.value, environment),
  }));
}

/**
 * Extract variable names from a string
 */
export function extractVariables(text: string): string[] {
  const matches = text.match(/\{\{([^}]+)\}\}/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.slice(2, -2)))];
}

/**
 * Check if a string contains unresolved variables
 */
export function hasUnresolvedVariables(
  text: string,
  environment: Environment | null
): boolean {
  const variables = extractVariables(text);
  if (variables.length === 0) return false;

  const envKeys = new Set(
    environment?.variables
      .filter((v) => v.enabled)
      .map((v) => v.key) || []
  );

  return variables.some((v) => !envKeys.has(v));
}
