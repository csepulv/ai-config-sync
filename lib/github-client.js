import { execFileSync } from 'child_process';
import ky from 'ky';

const githubApi = ky.create({
  prefixUrl: 'https://api.github.com',
  headers: {
    'User-Agent': 'ai-config-sync',
    'Accept': 'application/vnd.github.v3+json'
  }
});

// Lazy gh CLI availability check — runs once on first use, not at import time
let _ghCliChecked = false;
let _ghCliAvailable = false;

function checkGhCli() {
  if (!_ghCliChecked) {
    try {
      execFileSync('gh', ['auth', 'status'], { stdio: 'pipe' });
      _ghCliAvailable = true;
    } catch {
      _ghCliAvailable = false;
    }
    _ghCliChecked = true;
  }
  return _ghCliAvailable;
}

/**
 * Check if gh CLI is available and authenticated
 */
export function isGhCliAvailable() {
  return checkGhCli();
}

/**
 * Parse GitHub tree/blob URL into API components
 * @param {string} url - GitHub URL
 * @returns {object|null} - { owner, repo, ref, path } or null if invalid
 */
export function parseGitHubUrl(url) {
  if (!url) return null;

  // Try tree/blob URL first (specific path in repo)
  const pathMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/(tree|blob)\/([^/]+)\/(.+)/);
  if (pathMatch) {
    const [, owner, repo, , ref, pathInRepo] = pathMatch;
    return { owner, repo, ref, path: pathInRepo };
  }

  // Try repo root URL (e.g., https://github.com/owner/repo)
  // ref: null signals that default branch should be resolved
  const rootMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/?$/);
  if (rootMatch) {
    const [, owner, repo] = rootMatch;
    return { owner, repo, ref: null, path: '.' };
  }

  return null;
}

// ============ gh CLI (authenticated) ============

function fetchJsonWithGh(apiPath) {
  try {
    const output = execFileSync('gh', ['api', apiPath], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024
    });
    return JSON.parse(output);
  } catch (err) {
    throw new Error(`GitHub API error: ${err.message}`, { cause: err });
  }
}

function fetchRawWithGh(owner, repo, ref, filePath) {
  try {
    const output = execFileSync(
      'gh',
      ['api', `repos/${owner}/${repo}/contents/${filePath}?ref=${ref}`, '--jq', '.content'],
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 10 * 1024 * 1024
      }
    );
    return Buffer.from(output.trim(), 'base64').toString('utf-8');
  } catch (err) {
    throw new Error(`Failed to fetch ${filePath}: ${err.message}`, { cause: err });
  }
}

// ============ High-level GitHub operations ============

/**
 * Get the default branch for a GitHub repository
 * @returns {Promise<string>} The default branch name
 */
export async function getDefaultBranch(owner, repo) {
  if (checkGhCli()) {
    const repoInfo = fetchJsonWithGh(`repos/${owner}/${repo}`);
    return repoInfo.default_branch;
  }
  const repoInfo = await githubApi.get(`repos/${owner}/${repo}`).json();
  return repoInfo.default_branch;
}

/**
 * Fetch directory listing from GitHub contents API
 * @returns {Promise<Array>} Array of { name, type, path, download_url } items
 */
export async function fetchGitHubContents(owner, repo, ref, dirPath) {
  if (checkGhCli()) {
    return fetchJsonWithGh(`repos/${owner}/${repo}/contents/${dirPath}?ref=${ref}`);
  }
  return githubApi.get(`repos/${owner}/${repo}/contents/${dirPath}`, {
    searchParams: { ref }
  }).json();
}

/**
 * Fetch raw file content from GitHub
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} ref - Branch or commit ref
 * @param {string} filePath - Path within the repo (used for gh CLI)
 * @param {string} downloadUrl - Direct download URL (used for HTTPS fallback)
 * @returns {Promise<string>} File content as string
 */
export async function fetchGitHubRaw(owner, repo, ref, filePath, downloadUrl) {
  if (checkGhCli()) {
    return fetchRawWithGh(owner, repo, ref, filePath);
  }
  return ky.get(downloadUrl, {
    headers: { 'User-Agent': 'ai-config-sync' }
  }).text();
}

/**
 * Fetch latest commit date for a path in a GitHub repo
 * @returns {Promise<Date|null>} Commit date or null on error
 */
export async function fetchCommitDate(owner, repo, ref, repoPath) {
  if (checkGhCli()) {
    try {
      const output = execFileSync(
        'gh',
        ['api', `repos/${owner}/${repo}/commits?path=${repoPath}&per_page=1&sha=${ref}`],
        {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe']
        }
      );
      const commits = JSON.parse(output);
      if (commits.length > 0) {
        return new Date(commits[0].commit.committer.date);
      }
    } catch {
      return null;
    }
  } else {
    try {
      const commits = await githubApi.get(`repos/${owner}/${repo}/commits`, {
        searchParams: { path: repoPath, per_page: 1, sha: ref }
      }).json();
      if (commits.length > 0) {
        return new Date(commits[0].commit.committer.date);
      }
    } catch {
      return null;
    }
  }
  return null;
}
