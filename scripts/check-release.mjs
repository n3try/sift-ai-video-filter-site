import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { validatePublishedDownloadNames, validatePublishedManifest } from "./release-policy.mjs";
import { validateGeneratedIcon, zipEntries } from "./zip-policy.mjs";

const root = resolve(import.meta.dirname, "..");
const downloads = resolve(root, "downloads");
const failures = [];
const APPROVED_PACKAGE_SHA256 = "164b133ffb123a0ebabf2a5ad32eb81f784bf7874ec14ced464ea25339e1480d";

function fail(message) {
  failures.push(message);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function scanPackage(entries) {
  const allowedRoot = new Set([
    "manifest.json", "background.js", "content.js", "auth-callback.js",
    "popup.html", "settings.html", "onboarding.html", "privacy.html"
  ]);
  const names = new Set(entries.map((entry) => entry.name));
  for (const required of ["manifest.json", "background.js", "content.js", "popup.html", "settings.html"]) {
    assert(names.has(required), `Package is missing ${required}.`);
  }

  for (const entry of entries) {
    const lower = entry.name.toLowerCase();
    if (entry.name.includes("/")) {
      assert(/^assets\/[^/]+\.(?:js|css)$/.test(entry.name) || /^assets\/icon-(?:16|32|48|128)\.png$/.test(entry.name), `Unexpected packaged asset: ${entry.name}`);
    } else {
      assert(allowedRoot.has(entry.name), `Unexpected packaged root file: ${entry.name}`);
    }
    assert(!/(?:^|\/)(?:src|tests?|backend|node_modules|\.git)(?:\/|$)/.test(lower), `Development path leaked into package: ${entry.name}`);
    assert(!/\.(?:map|ts|tsx|env|pem|key|p12|pfx|crt|cer|log)$/i.test(lower), `Forbidden file type in package: ${entry.name}`);

    if (/\.(?:js|css|html|json)$/.test(lower)) {
      const source = entry.data.toString("utf8");
      const forbidden = [
        [/sourceMappingURL/i, "source-map reference"],
        [/\beval\s*\(/, "eval call"],
        [/\bnew\s+Function\s*\(/, "dynamic Function constructor"],
        [/<(?:script|link)\b[^>]*(?:src|href)\s*=\s*["'](?:https?:)?\/\//i, "remote script or stylesheet"],
        [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
        [/\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}\b/, "GitHub token"],
        [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key"],
        [/\bAIza[0-9A-Za-z_-]{35}\b/, "Google API key"],
        [/\bxox[baprs]-[0-9A-Za-z-]{10,}\b/, "Slack token"],
        [/\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}\b/, "Stripe secret"],
        [/\bBearer\s+[A-Za-z0-9._~+\/-]{20,}={0,2}\b/, "hard-coded bearer credential"],
        [/(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/:@]+:[^\s/@]+@/i, "credential-bearing database URL"],
        [/\b[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'`]+/i, "private Windows path"],
        [/(?:^|["'`\s])\/(?:Users|home)\/[^/\s"'`]+(?:\/|(?=["'`\s]))/, "private Unix path"]
      ];
      for (const [pattern, description] of forbidden) assert(!pattern.test(source), `${entry.name} contains a ${description}.`);
    }
    if (lower.endsWith(".png")) validateGeneratedIcon(entry.name, entry.data);
  }
}

try {
  const latestPath = resolve(downloads, "sift-extension-latest.zip");
  const latest = readFileSync(latestPath);
  const { entries, legacyBackslashes } = zipEntries(latest);
  scanPackage(entries);
  const manifestEntry = entries.find((entry) => entry.name === "manifest.json");
  const manifest = JSON.parse(manifestEntry.data.toString("utf8"));
  validatePublishedManifest(manifest);
  const version = manifest.version;
  assert(/^\d+\.\d+\.\d+$/.test(version), "Packaged manifest has an invalid version.");
  assert(manifest.manifest_version === 3 && manifest.minimum_chrome_version === "120", "Packaged browser compatibility metadata is unexpected.");
  assert(manifest.content_security_policy?.extension_pages === "script-src 'self'; object-src 'self'", "Packaged extension CSP is unexpected.");

  const versionedName = `sift-extension-v${version}.zip`;
  const versioned = readFileSync(resolve(downloads, versionedName));
  assert(latest.equals(versioned), "Latest package alias is not byte-identical to the versioned package.");
  const latestHash = sha256(latest);
  assert(!legacyBackslashes, "Published ZIP entries must use portable forward-slash paths.");
  assert(latestHash === APPROVED_PACKAGE_SHA256, "Published package is not the exact approved 0.5.0 Chromium archive.");
  const checksumText = readFileSync(resolve(downloads, "checksums.txt"), "utf8");
  const checksumEntries = new Map();
  for (const line of checksumText.trim().split(/\r?\n/)) {
    const match = line.match(/^([a-f\d]{64})  ([A-Za-z0-9._-]+\.zip)$/);
    assert(match, `Malformed checksum line: ${line}`);
    assert(!checksumEntries.has(match[2]), `Duplicate checksum entry: ${match[2]}`);
    checksumEntries.set(match[2], match[1]);
  }
  const downloadEntries = readdirSync(downloads, { withFileTypes: true });
  assert(downloadEntries.every((entry) => entry.isFile() && !entry.isSymbolicLink()), "Downloads must contain regular files only.");
  validatePublishedDownloadNames(downloadEntries.map((entry) => entry.name), version);
  const zipNames = downloadEntries.map((entry) => entry.name).filter((name) => name.endsWith(".zip")).sort();
  assert(zipNames.length === checksumEntries.size, "Every downloadable ZIP must have exactly one checksum entry.");
  for (const name of zipNames) {
    const publishedArchive = readFileSync(resolve(downloads, name));
    const publishedHash = sha256(publishedArchive);
    assert(checksumEntries.get(name) === publishedHash, `Checksum mismatch for ${name}.`);
    const publishedPackage = zipEntries(publishedArchive);
    scanPackage(publishedPackage.entries);
    const publishedManifestEntry = publishedPackage.entries.find((entry) => entry.name === "manifest.json");
    assert(publishedManifestEntry, `${name} is missing manifest.json.`);
    const publishedManifest = JSON.parse(publishedManifestEntry.data.toString("utf8"));
    validatePublishedManifest(publishedManifest);
    assert(publishedManifest.version === version, `${name} does not contain the current release version.`);
    assert(publishedHash === APPROVED_PACKAGE_SHA256, `Published 0.5.0 package is not the exact approved archive: ${name}.`);
  }
  assert(checksumEntries.get("sift-extension-latest.zip") === latestHash && checksumEntries.get(versionedName) === latestHash, "Current-package checksums disagree.");

  const index = readFileSync(resolve(root, "index.html"), "utf8");
  const privacy = readFileSync(resolve(root, "privacy.html"), "utf8");
  const readme = readFileSync(resolve(root, "README.md"), "utf8");
  const size = `${(latest.length / 1024).toFixed(1)} KiB`;
  for (const required of [
    `releases/tag/v${version}`,
    `downloads/${versionedName}`,
    `sift-extension-v${version}`,
    latestHash,
    size
  ]) assert(index.includes(required), `index.html is missing current release metadata: ${required}`);
  assert(index.match(new RegExp(`href=["']downloads/${versionedName.replaceAll(".", "\\.")}["']`, "g"))?.length === 3, "All three primary download controls must use the locally verified versioned ZIP.");
  for (const [name, source] of [["index.html", index], ["privacy.html", privacy], ["README.md", readme]]) {
    const versions = [...source.matchAll(/\b0\.\d+\.\d+\b/g)].map((match) => match[0]);
    assert(versions.length > 0 && versions.every((candidate) => candidate === version), `${name} contains stale release versions.`);
  }
  assert(readme.includes(latestHash), "README checksum is stale.");

  const hasActiveTab = manifest.permissions?.includes("activeTab");
  assert(hasActiveTab ? index.includes("includes <code>activeTab</code>") : index.includes("no separate <code>activeTab</code> permission"), "Website activeTab disclosure disagrees with the package manifest.");
  assert(!hasActiveTab || !index.includes("There is no separate <code>activeTab</code> permission"), "Website incorrectly denies the packaged activeTab permission.");
  const apiIsRequired = manifest.host_permissions?.includes("https://sift-api.leo-r-green.workers.dev/*");
  assert(apiIsRequired ? index.includes("manifest grants this host at install time") : !index.includes("manifest grants this host at install time"), "Website API permission disclosure disagrees with the package manifest.");

  console.log(`Release checks passed for ${versionedName} (${size}, ${latestHash}).`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (failures.length) {
  console.error(`Release checks failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}
