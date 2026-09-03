import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const toPosix = (value) => value.split(path.sep).join("/");
const isLocalAsset = (value) => /^(?:\.\.\/|\.\/).+\.(?:js|css)$/.test(value);

function sourceFilesOnDisk() {
  const files = ["index.html"];
  for (const dir of ["js", "css"]) {
    const absolute = path.join(root, dir);
    if (!fs.existsSync(absolute)) continue;
    for (const name of fs.readdirSync(absolute).sort()) {
      if ((dir === "js" && name.endsWith(".js")) || (dir === "css" && name.endsWith(".css"))) {
        files.push(`${dir}/${name}`);
      }
    }
  }
  return files;
}

function resolveTarget(sourceFile, rawPath) {
  return path.posix.normalize(path.posix.join(path.posix.dirname(sourceFile), rawPath));
}

function collectFromContents(contentsByFile) {
  const refs = new Map();
  for (const [sourceFile, source] of contentsByFile) {
    const pattern = /(["'`])(\.\.?\/[^"'`\s?#]+\.(?:js|css))(?:\?v=(\d+))?\1/g;
    for (const match of source.matchAll(pattern)) {
      const rawPath = match[2];
      if (!isLocalAsset(rawPath)) continue;
      const target = resolveTarget(sourceFile, rawPath);
      if (target.startsWith("../")) continue;
      const record = {
        source: sourceFile,
        rawPath,
        target,
        version: match[3] ? Number(match[3]) : null,
      };
      const bucket = refs.get(target) || [];
      bucket.push(record);
      refs.set(target, bucket);
    }
  }
  return refs;
}

function currentContents() {
  return new Map(sourceFilesOnDisk().map((file) => [file, fs.readFileSync(path.join(root, file), "utf8")]));
}

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function validGitRef(ref) {
  if (!ref || /^0+$/.test(ref)) return false;
  try {
    execFileSync("git", ["cat-file", "-e", `${ref}^{commit}`], { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function contentsAt(ref) {
  if (!validGitRef(ref)) return new Map();
  const listed = git("ls-tree", "-r", "--name-only", ref, "--", "index.html", "js", "css")
    .split("\n")
    .filter(Boolean)
    .filter((file) => file === "index.html" || /^js\/[^/]+\.js$/.test(file) || /^css\/[^/]+\.css$/.test(file));
  const result = new Map();
  for (const file of listed) {
    try {
      result.set(file, git("show", `${ref}:${file}`));
    } catch {
      // A file may have disappeared between refs; absence is fine for comparison.
    }
  }
  return result;
}

function staticCheck(refs, contents) {
  const failures = [];
  const htmlRefs = [...refs.values()].flat().filter((record) => record.source === "index.html");
  for (const record of htmlRefs) {
    if (record.version == null) failures.push(`index.html entry asset is missing ?v=: ${record.rawPath}`);
  }

  for (const [sourceFile, source] of contents) {
    const malformed = [...source.matchAll(/(["'`])(\.\.?\/[^"'`\s?#]+\.(?:js|css))\?v=([^"'`]+)\1/g)];
    for (const match of malformed) {
      if (!/^\d+$/.test(match[3])) failures.push(`${sourceFile}: cache version must be numeric: ${match[2]}?v=${match[3]}`);
    }
  }

  if (failures.length) throw new Error(`cache-buster static check failed:\n- ${failures.join("\n- ")}`);

  const records = [...refs.values()].flat();
  const unversioned = records.filter((record) => record.version == null);
  console.log(`cache-buster static check: ok (${records.length} local refs, ${unversioned.length} legacy unversioned refs)`);
}

function changedAssets(base) {
  if (!validGitRef(base)) return [];
  const output = git("diff", "--name-only", `${base}..HEAD`, "--", "js", "css");
  return output.split("\n").filter((file) => /^(?:js|css)\/[^/]+\.(?:js|css)$/.test(file));
}

function formatRefs(records) {
  return records.map((record) => `${record.source} -> ${record.rawPath}${record.version == null ? "" : `?v=${record.version}`}`).join(", ");
}

function diffCheck(base, currentRefs) {
  if (!validGitRef(base)) {
    console.log("cache-buster diff check: skipped (base ref unavailable)");
    return;
  }

  const baseRefs = collectFromContents(contentsAt(base));
  const failures = [];
  const changed = changedAssets(base);

  for (const target of changed) {
    const current = currentRefs.get(target) || [];
    if (!current.length) continue;

    const unversioned = current.filter((record) => record.version == null);
    if (unversioned.length) {
      failures.push(`${target} changed but has unversioned references: ${formatRefs(unversioned)}. Run: node scripts/cache-buster-regression.mjs --bump ${target}`);
      continue;
    }

    const currentVersions = [...new Set(current.map((record) => record.version))];
    if (currentVersions.length !== 1) {
      failures.push(`${target} has inconsistent current cache versions: ${formatRefs(current)}`);
      continue;
    }

    const previous = baseRefs.get(target) || [];
    if (!previous.length) continue;
    const previousVersions = [...new Set(previous.filter((record) => record.version != null).map((record) => record.version))];
    const previousHadUnversioned = previous.some((record) => record.version == null);
    if (!previousHadUnversioned && previousVersions.length === 1 && previousVersions[0] === currentVersions[0]) {
      failures.push(`${target} changed without a cache-version bump (still v=${currentVersions[0]}). Run: node scripts/cache-buster-regression.mjs --bump ${target}`);
    }
  }

  if (failures.length) throw new Error(`cache-buster diff check failed:\n- ${failures.join("\n- ")}`);
  console.log(`cache-buster diff check: ok (${changed.length} changed JS/CSS assets checked against ${base.slice(0, 12)})`);
}

function bumpTargets(targetArgs) {
  if (!targetArgs.length) throw new Error("--bump requires at least one repo-relative JS/CSS path");
  const targets = new Set(targetArgs.map((value) => toPosix(path.posix.normalize(value.replace(/^\.\//, "")))));
  const contents = currentContents();
  const refs = collectFromContents(contents);
  const nextVersions = new Map();

  for (const target of targets) {
    const records = refs.get(target) || [];
    if (!records.length) {
      console.warn(`cache-buster bump: no local references found for ${target}`);
      continue;
    }
    const highest = Math.max(0, ...records.map((record) => record.version || 0));
    nextVersions.set(target, highest + 1);
  }

  const changedSources = [];
  for (const [sourceFile, original] of contents) {
    const pattern = /(["'`])(\.\.?\/[^"'`\s?#]+\.(?:js|css))(?:\?v=(\d+))?\1/g;
    const updated = original.replace(pattern, (full, quote, rawPath) => {
      if (!isLocalAsset(rawPath)) return full;
      const target = resolveTarget(sourceFile, rawPath);
      const version = nextVersions.get(target);
      if (!version) return full;
      return `${quote}${rawPath}?v=${version}${quote}`;
    });
    if (updated !== original) {
      fs.writeFileSync(path.join(root, sourceFile), updated);
      changedSources.push(sourceFile);
    }
  }

  for (const [target, version] of nextVersions) console.log(`cache-buster bump: ${target} -> v=${version}`);
  console.log(`cache-buster bump: updated ${changedSources.length} source file(s)`);
}

const args = process.argv.slice(2);
if (args[0] === "--bump") {
  bumpTargets(args.slice(1));
} else {
  const contents = currentContents();
  const refs = collectFromContents(contents);
  staticCheck(refs, contents);
  if (args[0] === "--check-diff") diffCheck(args[1], refs);
  else if (args.length) throw new Error(`unknown arguments: ${args.join(" ")}`);
}
