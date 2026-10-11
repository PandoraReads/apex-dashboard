/**
 * GitHub skill import: list a repository's skill folders and install the
 * picked ones into the local skill stores. Two API calls per fetch (repo →
 * default branch, git/trees recursive → every path) plus one raw download
 * per installed FILE — no zip handling, no child_process, everything rides
 * Obsidian's requestUrl (proxy-aware). Unauthenticated GitHub limits (60
 * req/h) are plenty for personal use; a 403/429 surfaces as a Notice.
 *
 * URL forms accepted: https://github.com/o/r, github.com/o/r, both with an
 * optional /tree/<branch>/<subfolder> suffix and a trailing .git.
 */

import { requestUrl } from 'obsidian';
import { installToStores, type SkillFs, type SkillImportOutcome, type SkillImportTarget } from './skill-store';

/** Injectable request seam (tests drive listing/downloading offline). */
export type GithubRequest = (url: string, accept: string) => Promise<{ status: number; text: string; bytes: Uint8Array }>;

const defaultRequest: GithubRequest = async (url, accept) => {
	const response = await requestUrl({
		url,
		method: 'GET',
		headers: {
			'User-Agent': 'obsidian-dashboard',
			Accept: accept,
		},
	});
	return { status: response.status, text: response.text, bytes: new Uint8Array(response.arrayBuffer) };
};

export interface GithubRepoRef {
	owner: string;
	repo: string;
	/** Resolved branch ('' until fetchGithubRepo resolves the default). */
	branch: string;
	/** Repo-relative subfolder the URL pointed at ('' = repo root). */
	subPath: string;
}

/** Parse the accepted GitHub URL forms; null when the input isn't one. */
export function parseGithubUrl(input: string): GithubRepoRef | null {
	const trimmed = input.trim();
	if (!trimmed) return null;
	const match = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/\s#?]+)(?:\/([^\s#?]*))?)?\/?$/i);
	if (!match) return null;
	const [, owner, repo, branch, subPath] = match;
	if (!owner || !repo) return null;
	return { owner, repo, branch: branch ?? '', subPath: (subPath ?? '').replace(/^\/+|\/+$/g, '') };
}

interface GithubApiError extends Error {
	status: number;
}

async function githubJson<T>(request: GithubRequest, url: string): Promise<T> {
	const res = await request(url, 'application/vnd.github+json');
	if (res.status !== 200) {
		const err = new Error(`GitHub API ${res.status}`) as GithubApiError;
		err.status = res.status;
		throw err;
	}
	try {
		return JSON.parse(res.text) as T;
	} catch {
		throw new Error('GitHub API: invalid JSON response');
	}
}

/** Resolve the default branch when the URL didn't carry one. */
async function resolveBranch(ref: GithubRepoRef, request: GithubRequest): Promise<GithubRepoRef> {
	if (ref.branch) return ref;
	const repo = await githubJson<{ default_branch?: string }>(request, `https://api.github.com/repos/${ref.owner}/${ref.repo}`);
	return { ...ref, branch: repo.default_branch || 'main' };
}

export interface GithubSkillCandidate {
	/** Destination folder name (repo dir basename). */
	name: string;
	/** Repo-relative folder path. */
	path: string;
}

/** How deep below `subPath` a SKILL.md's folder may sit (repo-root skills
 *  and one nesting level, e.g. skills/<name>/SKILL.md — deeper hits are
 *  almost certainly unrelated projects inside a monorepo). */
const MAX_SKILL_DEPTH = 2;
/** Listing cap — guards accidental mega-repo listing. */
const MAX_CANDIDATES = 100;

/** One recursive tree call → every skill folder under subPath. */
export async function fetchGithubSkillDirs(ref: GithubRepoRef, request: GithubRequest = defaultRequest): Promise<{ ref: GithubRepoRef; skills: GithubSkillCandidate[]; paths: string[] }> {
	const withBranch = await resolveBranch(ref, request);
	const tree = await githubJson<{ tree?: Array<{ path: string; type: string }> }>(
		request,
		`https://api.github.com/repos/${withBranch.owner}/${withBranch.repo}/git/trees/${encodeURIComponent(withBranch.branch)}?recursive=1`,
	);
	const prefix = withBranch.subPath ? `${withBranch.subPath}/` : '';
	const paths: string[] = [];
	const dirs = new Set<string>();
	for (const entry of tree.tree ?? []) {
		if (entry.type !== 'blob') continue;
		paths.push(entry.path);
		if (!entry.path.endsWith('/SKILL.md')) continue;
		const dir = entry.path.slice(0, -'/SKILL.md'.length);
		if (!dir) continue; // SKILL.md at repo root: not a folder skill
		if (prefix && !dir.startsWith(prefix)) continue;
		const rel = prefix ? dir.slice(prefix.length) : dir;
		if (rel.split('/').length > MAX_SKILL_DEPTH) continue;
		if (dirs.size >= MAX_CANDIDATES) continue;
		dirs.add(dir);
	}
	// A SKILL.md under another skill's folder (skill/references/SKILL.md) is
	// a reference doc, not a second skill — drop any dir with a collected
	// ancestor. Order-independent: computed over the full set.
	const skills = [...dirs]
		.filter(dir => {
			const parts = dir.split('/');
			for (let i = 1; i < parts.length; i++) {
				if (dirs.has(parts.slice(0, i).join('/'))) return false;
			}
			return true;
		})
		.map(dir => ({ name: dir.split('/').pop()!, path: dir }))
		.sort((a, b) => a.name.localeCompare(b.name));
	return { ref: withBranch, skills, paths };
}

/** The tree paths under one skill folder (files only, depth-safe). */
export function filesOfSkillDir(treePaths: readonly string[], skillPath: string): string[] {
	const prefix = `${skillPath}/`;
	return treePaths.filter(p => p.startsWith(prefix));
}

/** Install picked GitHub skills into the local stores: per skill, per
 *  target, download every file raw and write through the fs seam. */
export async function importGithubSkills(
	fs: SkillFs,
	ref: GithubRepoRef,
	treePaths: readonly string[],
	picked: readonly GithubSkillCandidate[],
	targets: readonly SkillImportTarget[],
	request: GithubRequest = defaultRequest,
): Promise<Array<{ name: string; outcomes: SkillImportOutcome[] }>> {
	const rawBase = `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${ref.branch}`;
	const results: Array<{ name: string; outcomes: SkillImportOutcome[] }> = [];
	for (const skill of picked) {
		const files = filesOfSkillDir(treePaths, skill.path);
		const outcomes = await installToStores(fs, targets, skill.name, async dest => {
			for (const filePath of files) {
				const res = await request(`${rawBase}/${filePath}`, 'application/octet-stream');
				if (res.status !== 200) throw new Error(`download failed (${res.status}): ${filePath}`);
				const destPath = `${dest}/${filePath.slice(skill.path.length + 1)}`;
				await fs.mkdirRec(destPath.split('/').slice(0, -1).join('/'));
				await fs.writeFile(destPath, res.bytes);
			}
		});
		results.push({ name: skill.name, outcomes });
	}
	return results;
}
