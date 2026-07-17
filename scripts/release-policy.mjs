const PLATFORM_MATCHES = [
  "https://www.youtube.com/*",
  "https://youtube.com/*",
  "https://www.tiktok.com/*",
];

const REQUIRED_HOSTS = [
  ...PLATFORM_MATCHES,
  "https://sift-api.leo-r-green.workers.dev/*",
];

const OPTIONAL_HOSTS = [
  "https://*/*",
  "http://localhost/*",
  "http://127.0.0.1/*",
];

const TOP_LEVEL_KEYS = [
  "action",
  "background",
  "content_scripts",
  "content_security_policy",
  "description",
  "host_permissions",
  "icons",
  "manifest_version",
  "minimum_chrome_version",
  "name",
  "optional_host_permissions",
  "options_page",
  "permissions",
  "short_name",
  "version",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function exact(actual, expected, message) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), message);
}

export function validatePublishedManifest(manifest) {
  assert(manifest && typeof manifest === "object" && !Array.isArray(manifest), "Published manifest must be an object.");
  exact(Object.keys(manifest).sort(), TOP_LEVEL_KEYS, "Published manifest has unexpected top-level capabilities.");
  assert(manifest.manifest_version === 3, "Published extension must use Manifest V3.");
  assert(manifest.version === "0.4.3", "Published manifest version is not the approved release.");
  assert(manifest.minimum_chrome_version === "120", "Published minimum Chrome version is unexpected.");
  assert(manifest.name === "Sift: AI Video Filter" && manifest.short_name === "Sift", "Published extension identity is unexpected.");
  assert(manifest.description === "Warn about and skip likely AI-generated videos on YouTube and TikTok.", "Published extension description is unexpected.");
  exact(manifest.permissions, ["storage", "activeTab"], "Published extension has unexpected required permissions.");
  exact(manifest.host_permissions, REQUIRED_HOSTS, "Published extension has unexpected required host permissions.");
  exact(manifest.optional_host_permissions, OPTIONAL_HOSTS, "Published extension has unexpected optional host permissions.");
  exact(manifest.background, { service_worker: "background.js" }, "Published background configuration is unexpected.");
  exact(manifest.action, {
    default_title: "Sift",
    default_popup: "popup.html",
    default_icon: {
      "16": "assets/icon-16.png",
      "32": "assets/icon-32.png",
    },
  }, "Published toolbar action is unexpected.");
  assert(manifest.options_page === "settings.html", "Published options page is unexpected.");
  exact(manifest.icons, {
    "16": "assets/icon-16.png",
    "32": "assets/icon-32.png",
    "48": "assets/icon-48.png",
    "128": "assets/icon-128.png",
  }, "Published icons are unexpected.");
  exact(manifest.content_scripts, [{
    matches: PLATFORM_MATCHES,
    js: ["content.js"],
    run_at: "document_idle",
  }], "Published content-script scope is unexpected.");
  exact(manifest.content_security_policy, {
    extension_pages: "script-src 'self'; object-src 'self'",
  }, "Published extension CSP is unexpected.");
}

export function validatePublishedDownloadNames(names, version) {
  exact([...names].sort(), [
    "checksums.txt",
    "sift-extension-latest.zip",
    `sift-extension-v${version}.zip`,
  ].sort(), "Downloads contain an unexpected or missing public file.");
}
