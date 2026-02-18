/**
 * Call an async function, returning a fallback value if it throws.
 * Replaces verbose try/catch-with-default patterns.
 * @param {Function} fn - Async function to call
 * @param {*} fallbackValue - Value to return on error
 * @returns {Promise<*>}
 */
export async function withFallback(fn, fallbackValue) {
  try {
    return await fn();
  } catch {
    return fallbackValue;
  }
}
