/**
 * Release helper: bump package.json version, create the vX.Y.Z tag, push both.
 *
 * The pushed tag triggers .github/workflows/release.yml, which typechecks,
 * smoke-tests, cross-compiles the Windows exe, zips it, and publishes a
 * GitHub Release with the zip attached.
 *
 * Usage:
 *   bun run release patch            # 0.1.0 -> 0.1.1
 *   bun run release minor            # 0.1.0 -> 0.2.0
 *   bun run release major            # 0.1.0 -> 1.0.0
 *   bun run release 1.2.3            # explicit semver
 *   bun run release --dry-run patch  # show what would happen, change nothing
 */
import { exit } from "node:process";

type Bump = "major" | "minor" | "patch";

interface PkgJson {
  version: string;
  [key: string]: unknown;
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  exit(1);
}

function run(args: string[], extraEnv: Record<string, string> = {}): string {
  const proc = Bun.spawnSync(args, {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...extraEnv },
  });
  const out = proc.stdout.toString().trim();
  if (proc.exitCode !== 0) {
    console.error(proc.stderr.toString());
    fail(`${args.join(" ")} failed (exit ${proc.exitCode})`);
  }
  return out;
}

/** Read git config without touching the user's global config (per repo policy). */
function gitIdentity(): { name: string; email: string } {
  const name = process.env.RELEASE_GIT_NAME || run(["git", "config", "user.name"]);
  const email = process.env.RELEASE_GIT_EMAIL || run(["git", "config", "user.email"]);
  if (!name) fail("git user.name is not configured (set RELEASE_GIT_NAME)");
  if (!email) fail("git user.email is not configured (set RELEASE_GIT_EMAIL)");
  return { name, email };
}

function bumpVersion(current: string, bump: Bump): string {
  const m = current.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) fail(`package.json version '${current}' is not semver`);
  const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (bump === "major") return `${maj + 1}.0.0`;
  if (bump === "minor") return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

// ---------------------------------------------------------------- main

const args = process.argv.slice(2).filter((a) => a !== "--");
const dryRun = args.includes("--dry-run");
const positional = args.filter((a) => a !== "--dry-run");
const bumpOrVersion = positional[0];

if (!bumpOrVersion || !["major", "minor", "patch"].includes(bumpOrVersion) && !/^\d+\.\d+\.\d+(-[\w.-]+)?$/.test(bumpOrVersion)) {
  fail("usage: bun run release <major|minor|patch|X.Y.Z> [--dry-run]");
}

const pkgPath = new URL("../package.json", import.meta.url);
const pkg = (await Bun.file(pkgPath).json()) as PkgJson;
const current = pkg.version;

const next = ["major", "minor", "patch"].includes(bumpOrVersion)
  ? bumpVersion(current, bumpOrVersion as Bump)
  : bumpOrVersion;

const tag = `v${next}`;

console.log(`release: ${current} -> ${next} (tag ${tag})${dryRun ? " [dry-run]" : ""}`);

// ---- pre-flight checks (skip when dry-run) ----
if (!dryRun) {
  const status = run(["git", "status", "--porcelain"]);
  if (status) fail("working tree is not clean; commit or stash first");

  const branch = run(["git", "rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === "HEAD") fail("detached HEAD; checkout a branch first");

  run(["git", "fetch", "--tags"]);
  const existing = Bun.spawnSync(["git", "rev-parse", "--verify", `refs/tags/${tag}`]);
  if (existing.exitCode === 0) fail(`tag ${tag} already exists`);

  console.log("pre-flight checks passed");
}

if (dryRun) {
  console.log(`dry-run: would write version ${next} to package.json`);
  console.log(`dry-run: would commit "release: v${next}" and tag ${tag}`);
  console.log(`dry-run: would push branch + tag ${tag} to origin`);
  exit(0);
}

// ---- bump package.json ----
pkg.version = next;
await Bun.write(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`updated package.json -> ${next}`);

// ---- commit + tag + push ----
const identity = gitIdentity();
const gitEnv = {
  GIT_AUTHOR_NAME: identity.name,
  GIT_AUTHOR_EMAIL: identity.email,
  GIT_COMMITTER_NAME: identity.name,
  GIT_COMMITTER_EMAIL: identity.email,
};

run(["git", "add", "package.json"]);
run(["git", "commit", "-m", `release: ${tag}`], gitEnv);
run(["git", "tag", "-a", tag, "-m", `Release ${tag}`], gitEnv);
run(["git", "push", "origin", "HEAD"]);
run(["git", "push", "origin", tag]);

console.log(`\nDone. Tag ${tag} pushed — GitHub Actions will build the exe zip and publish the release.`);
console.log("Watch progress: gh run watch   (or the Actions tab on GitHub)");
