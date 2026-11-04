/**
 * Git helpers for the session git-version feature.
 *
 * The plugin records the branch a Session was created on and restores it when
 * the Session is opened again. Every call here is a short-lived child process
 * bound to the Session's own working directory (`git -C <cwd>`), never to the
 * Host process CWD, and only {@link switchBranch} mutates anything.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Hard deadline for one git child process. */
const TIMEOUT_MS = 5000;

/** stdout/stderr ceiling; `git status` on a huge tree stays far below it. */
const MAX_BUFFER = 1024 * 1024;

/**
 * Run one git command inside a working directory.
 * @param cwd - absolute working directory.
 * @param args - git arguments.
 * @returns trimmed stdout.
 * @throws when git is missing, the directory is not a repository, or the command fails.
 */
async function git(cwd, args) {
	const { stdout } = await run("git", ["-C", cwd, ...args], {
		timeout: TIMEOUT_MS,
		maxBuffer: MAX_BUFFER,
		windowsHide: true,
		encoding: "utf8",
	});
	return stdout.trim();
}

/**
 * Current HEAD of one working directory.
 * @param cwd - absolute working directory.
 * @returns `{ branch, detached }`; a detached HEAD reports its short commit as the branch.
 * @throws when the directory is not a readable git repository.
 */
export async function readHead(cwd) {
	const branch = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
	if (branch !== "HEAD") return { branch, detached: false };
	const commit = await git(cwd, ["rev-parse", "--short", "HEAD"]);
	return { branch: commit, detached: true };
}

/**
 * Whether the working tree has no staged, unstaged, or untracked changes.
 * @param cwd - absolute working directory.
 * @returns true when `git status --porcelain` prints nothing.
 */
export async function isClean(cwd) {
	return (await git(cwd, ["status", "--porcelain"])) === "";
}

/**
 * Whether a local branch exists.
 * @param cwd - absolute working directory.
 * @param branch - local branch name.
 * @returns true when `refs/heads/<branch>` resolves.
 */
export async function hasBranch(cwd, branch) {
	if (branch === "" || branch.startsWith("-")) return false;
	try {
		await git(cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
		return true;
	} catch {
		return false;
	}
}

/**
 * List the local branch names of one working directory.
 * @param cwd - absolute working directory.
 * @returns branch names, sorted by refname.
 * @throws when the directory is not a readable git repository.
 */
export async function listBranches(cwd) {
	const output = await git(cwd, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
	return output.split("\n").map((line) => line.trim()).filter((line) => line !== "");
}

/**
 * Switch one working directory back to a local branch.
 * @param cwd - absolute working directory.
 * @param branch - local branch name that {@link hasBranch} already admitted.
 */
export async function switchBranch(cwd, branch) {
	try {
		await git(cwd, ["switch", branch]);
	} catch {
		// Git older than 2.23 has no `switch`.
		await git(cwd, ["checkout", branch]);
	}
}
