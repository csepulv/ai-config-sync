import fs from 'fs/promises';
import yaml from 'js-yaml';
import path from 'path';

/**
 * Load and parse a YAML file. Returns null if file doesn't exist.
 * @param {string} filePath - Absolute path to YAML file
 * @param {object} [deps] - Optional dependencies for testing
 * @returns {Promise<object|null>}
 */
export async function loadYamlFile(filePath, deps = {}) {
  const { readFile = fs.readFile } = deps;
  try {
    const content = await readFile(filePath, 'utf-8');
    return yaml.load(content);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Load and parse a JSON state file. Returns empty object if file doesn't exist.
 * @param {string} filePath - Absolute path to JSON file
 * @param {object} [deps] - Optional dependencies for testing
 * @returns {Promise<object>}
 */
export async function loadJsonState(filePath, deps = {}) {
  const { readFile = fs.readFile } = deps;
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

/**
 * Save data as a YAML file.
 * @param {string} filePath - Absolute path to YAML file
 * @param {object} data - Data to serialize
 * @param {object} [deps] - Optional dependencies for testing
 */
export async function saveYamlFile(filePath, data, deps = {}) {
  const { writeFile = fs.writeFile } = deps;
  const content = yaml.dump(data, { lineWidth: -1 });
  await writeFile(filePath, content, 'utf-8');
}

/**
 * Save an object as formatted JSON.
 * @param {string} filePath - Absolute path to JSON file
 * @param {object} data - Data to serialize
 * @param {object} [deps] - Optional dependencies for testing
 */
export async function saveJsonState(filePath, data, deps = {}) {
  const { writeFile = fs.writeFile } = deps;
  await writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * Get file modification time. Returns null if file doesn't exist.
 * @param {string} filePath - Absolute path to file
 * @param {object} [deps] - Optional dependencies for testing
 * @returns {Promise<Date|null>}
 */
export async function getFileMtime(filePath, deps = {}) {
  const { stat = fs.stat } = deps;
  try {
    const s = await stat(filePath);
    return s.mtime;
  } catch {
    return null;
  }
}

/**
 * Recursively find the newest mtime among all files in a directory.
 * @param {string} dirPath - Directory to scan
 * @param {object} [deps] - Optional dependencies for testing
 * @returns {Promise<Date>} Newest mtime, or epoch zero if empty
 */
export async function getNewestMtime(dirPath, deps = {}) {
  const { readdir = fs.readdir, stat = fs.stat } = deps;
  let newest = new Date(0);
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const sub = await getNewestMtime(fullPath, deps);
      if (sub > newest) newest = sub;
    } else {
      const s = await stat(fullPath);
      if (s.mtime > newest) newest = s.mtime;
    }
  }
  return newest;
}

/**
 * List names of subdirectories in a directory.
 * @param {string} dirPath - Directory to scan
 * @param {object} [deps] - Optional dependencies for testing
 * @returns {Promise<string[]>}
 */
export async function listSubdirectoryNames(dirPath, deps = {}) {
  const { readdir = fs.readdir } = deps;
  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

/**
 * Merge items from multiple source directories, first source wins on name conflicts.
 * @param {string[]} sourceDirs - Source directory paths (priority order)
 * @param {Function} loadFn - async (sourceDir, deps) => loaded data or null
 * @param {string} itemsKey - Key in loaded data containing the items array
 * @param {object} [options]
 * @param {boolean} [options.tagSourceDir] - Add _sourceDir to each item
 * @param {object} [options.deps] - Dependencies passed to loadFn
 * @returns {Promise<Array>} Deduplicated items array
 */
export async function mergeFirstWins(
  sourceDirs,
  loadFn,
  itemsKey,
  { tagSourceDir = false, deps = {} } = {}
) {
  const seen = new Set();
  const merged = [];

  for (const sourceDir of sourceDirs) {
    const data = await loadFn(sourceDir, deps);
    if (!data?.[itemsKey]) continue;

    for (const item of data[itemsKey]) {
      if (!seen.has(item.name)) {
        seen.add(item.name);
        const entry = { ...item };
        if (tagSourceDir) entry._sourceDir = sourceDir;
        merged.push(entry);
      }
    }
  }

  return merged;
}
