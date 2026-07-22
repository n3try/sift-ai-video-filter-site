import assert from "node:assert/strict";
import test from "node:test";
import { validatePublishedDownloadNames, validatePublishedManifest } from "./release-policy.mjs";

function validManifest() {
  return {
    manifest_version: 3,
    name: "Sift: AI Video Filter",
    short_name: "Sift",
    version: "0.5.0",
    minimum_chrome_version: "120",
    description: "Warn about and skip likely AI-generated videos on YouTube and TikTok.",
    icons: {
      "16": "assets/icon-16.png",
      "32": "assets/icon-32.png",
      "48": "assets/icon-48.png",
      "128": "assets/icon-128.png",
    },
    permissions: ["storage"],
    host_permissions: [
      "https://www.youtube.com/*",
      "https://youtube.com/*",
      "https://www.tiktok.com/*",
    ],
    optional_host_permissions: [
      "https://*/*",
      "http://localhost/*",
      "http://127.0.0.1/*",
    ],
    background: { service_worker: "background.js" },
    action: {
      default_title: "Sift",
      default_popup: "popup.html",
      default_icon: {
        "16": "assets/icon-16.png",
        "32": "assets/icon-32.png",
      },
    },
    options_page: "settings.html",
    content_scripts: [
      {
        matches: [
          "https://www.youtube.com/*",
          "https://youtube.com/*",
          "https://www.tiktok.com/*",
        ],
        js: ["content.js"],
        run_at: "document_idle",
      },
      {
        matches: ["https://sift-api.leo-r-green.workers.dev/v1/auth/google/callback*"],
        js: ["auth-callback.js"],
        run_at: "document_start",
      },
    ],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
  };
}

test("accepts the exact approved public manifest", () => {
  assert.doesNotThrow(() => validatePublishedManifest(validManifest()));
});

for (const [name, mutate] of [
  ["broad required permission", (manifest) => manifest.permissions.push("tabs")],
  ["all-URLs required host", (manifest) => manifest.host_permissions.push("<all_urls>")],
  ["external messaging", (manifest) => { manifest.externally_connectable = { matches: ["<all_urls>"] }; }],
  ["web-accessible resources", (manifest) => { manifest.web_accessible_resources = [{ resources: ["assets/*"], matches: ["<all_urls>"] }]; }],
  ["development signing key", (manifest) => { manifest.key = "not-a-real-key"; }],
  ["unapproved update URL", (manifest) => { manifest.update_url = "https://example.test/update.xml"; }],
  ["broader content script", (manifest) => { manifest.content_scripts[0].matches = ["<all_urls>"]; }],
]) {
  test(`rejects ${name}`, () => {
    const manifest = validManifest();
    mutate(manifest);
    assert.throws(() => validatePublishedManifest(manifest));
  });
}

test("accepts only the approved public download files", () => {
  assert.doesNotThrow(() => validatePublishedDownloadNames([
    "sift-extension-v0.5.0.zip",
    "checksums.txt",
    "sift-extension-latest.zip",
  ], "0.5.0"));
});

for (const unexpected of ["old.ZIP", "archive.Zip", "secrets.txt", ".env", "nested-directory"]) {
  test(`rejects unexpected download entry ${unexpected}`, () => {
    assert.throws(() => validatePublishedDownloadNames([
      "checksums.txt",
      "sift-extension-latest.zip",
      "sift-extension-v0.5.0.zip",
      unexpected,
    ], "0.5.0"));
  });
}
