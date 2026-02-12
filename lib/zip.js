import archiver from 'archiver';
import { createWriteStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';

import { getSkillsDirectory, getZipDirectory } from './config.js';
import { listSubdirectoryNames } from './io.js';

/**
 * Zip a single skill directory
 * @param {string} skillName - Name of the skill to zip
 * @param {object} config - Config object
 * @param {object} options - Options
 * @param {string} options.output - Override output directory
 * @param {object} [deps] - Optional dependencies for testing
 * @returns {Promise<string>} Path to created zip file
 */
export async function zipSkill(skillName, config, options = {}, deps = {}) {
  const {
    createWriteStream: doCreateWriteStream = createWriteStream,
    createArchiver = () => archiver('zip', { zlib: { level: 9 } }),
    access = fs.access,
    mkdir = fs.mkdir,
    getSkillsDirectory: getSkillsDir = getSkillsDirectory,
    getZipDirectory: getZipDir = getZipDirectory
  } = deps;

  const skillsDir = getSkillsDir(config);
  const skillPath = path.join(skillsDir, skillName);

  // Verify skill exists
  try {
    await access(skillPath);
  } catch {
    throw new Error(`Skill not found: ${skillName}`);
  }

  // Determine output directory
  const outputDir = options.output || getZipDir(config);
  await mkdir(outputDir, { recursive: true });

  const zipPath = path.join(outputDir, `${skillName}.zip`);

  return new Promise((resolve, reject) => {
    const output = doCreateWriteStream(zipPath);
    const archive = createArchiver();

    output.on('close', () => resolve(zipPath));
    archive.on('error', (err) => reject(err));

    archive.pipe(output);

    // Add skill directory with the skill name as the root folder
    // This creates: skill-name/SKILL.md, skill-name/references/, etc.
    archive.directory(skillPath, skillName);

    archive.finalize();
  });
}

/**
 * Zip all skills in the skills directory
 * @param {object} config - Config object
 * @param {object} options - Options
 * @param {string} options.output - Override output directory
 * @param {object} [deps] - Optional dependencies for testing
 * @returns {Promise<string[]>} Paths to created zip files
 */
export async function zipAllSkills(config, options = {}, deps = {}) {
  const {
    zipSkill: doZipSkill = zipSkill,
    getSkillsDirectory: getSkillsDir = getSkillsDirectory,
    listSubdirectoryNames: listSubdirs = listSubdirectoryNames
  } = deps;

  const skillsDir = getSkillsDir(config);

  let skillDirs;
  try {
    skillDirs = await listSubdirs(skillsDir, deps);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('No skills directory found. Run fetch first.');
      return [];
    }
    throw err;
  }

  if (skillDirs.length === 0) {
    console.log('No skills found to zip.');
    return [];
  }

  console.log(`Zipping ${skillDirs.length} skills...\n`);

  const zipPaths = [];
  for (const skillName of skillDirs) {
    const zipPath = await doZipSkill(skillName, config, options, deps);
    console.log(`  Created: ${zipPath}`);
    zipPaths.push(zipPath);
  }

  return zipPaths;
}
