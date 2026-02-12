import fs from 'fs/promises';
import yaml from 'js-yaml';

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
