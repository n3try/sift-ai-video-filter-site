import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { hasUnsupportedConformanceClaim } from "./accessibility-policy.mjs";
import { SITE_PAGES } from "./site-pages.mjs";

const root = resolve(import.meta.dirname, "..");
const pageNames = SITE_PAGES;
const failures = [];
const INTERACTIVE_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";
const STATIC_CSP = "default-src 'self'; style-src 'self'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";

function fail(file, message) {
  failures.push(`${file}: ${message}`);
}

function parseAttributes(source) {
  const attributes = new Map();
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;

  while ((match = pattern.exec(source))) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  }

  return attributes;
}

function elements(html, tagName) {
  const pattern = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  return [...html.matchAll(pattern)].map((match) => ({
    attributes: parseAttributes(match[1]),
    content: match[2],
  }));
}

function openingTags(html, tagName) {
  const pattern = new RegExp(`<${tagName}\\b([^>]*)>`, "gi");
  return [...html.matchAll(pattern)].map((match) => parseAttributes(match[1]));
}

function plainText(source) {
  return source
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:#\d+|#x[\da-f]+|[a-z]+);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function accessibleName(element) {
  return (
    element.attributes.get("aria-label") ||
    element.attributes.get("aria-labelledby") ||
    plainText(element.content)
  );
}

function checkPage(pageName) {
  const html = readFileSync(resolve(root, pageName), "utf8");
  const ids = openingTags(html, "[a-z][a-z0-9-]*")
    .map((attributes) => attributes.get("id"))
    .filter(Boolean);
  const idSet = new Set(ids);

  if (!/^\s*<!doctype html>/i.test(html)) fail(pageName, "missing HTML doctype");
  if (!/<html\b[^>]*\blang="[^"]+"/i.test(html)) fail(pageName, "html element needs a language");
  if (!/<meta\b[^>]*\bname="viewport"/i.test(html)) fail(pageName, "missing responsive viewport metadata");
  if (!/<meta\b[^>]*\bname="referrer"[^>]*\bcontent="no-referrer"/i.test(html)) fail(pageName, "missing no-referrer privacy policy");
  const csp = openingTags(html, "meta").find((attributes) => (
    attributes.get("http-equiv")?.toLowerCase() === "content-security-policy"
  ))?.get("content");
  const expectedCsp = pageName === "404.html" ? STATIC_CSP : INTERACTIVE_CSP;
  if (csp !== expectedCsp) fail(pageName, "content security policy is missing or broader than the approved policy");
  if (elements(html, "title").filter((title) => plainText(title.content)).length !== 1) {
    fail(pageName, "needs exactly one nonempty title");
  }
  if (elements(html, "main").length !== 1) fail(pageName, "needs exactly one main landmark");
  if (elements(html, "h1").length !== 1) fail(pageName, "needs exactly one h1");

  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length) fail(pageName, `duplicate ids: ${[...new Set(duplicates)].join(", ")}`);

  for (const tagName of ["a", "button", "summary"]) {
    for (const element of elements(html, tagName)) {
      if (!accessibleName(element)) fail(pageName, `<${tagName}> needs an accessible name`);
      const visibleLabel = plainText(element.content).toLocaleLowerCase();
      const ariaLabel = element.attributes.get("aria-label")?.trim().toLocaleLowerCase();
      if (visibleLabel && ariaLabel && !ariaLabel.includes(visibleLabel)) {
        fail(pageName, `<${tagName}> aria-label must contain its visible label`);
      }
    }
  }

  for (const anchor of elements(html, "a")) {
    const href = anchor.attributes.get("href");
    if (!href) {
      fail(pageName, "link is missing href");
      continue;
    }
    if (href === "#") fail(pageName, "link uses an empty fragment");
    if (href.startsWith("#") && !idSet.has(href.slice(1))) {
      fail(pageName, `link target ${href} does not exist`);
    }
    if (anchor.attributes.get("target") === "_blank" && !/\bnoopener\b/.test(anchor.attributes.get("rel") ?? "")) {
      fail(pageName, "new-window link needs rel=noopener");
    }
  }

  for (const attributes of openingTags(html, "img")) {
    if (!attributes.has("alt")) fail(pageName, "image is missing alt text");
  }

  for (const tagName of ["input", "select", "textarea"]) {
    const controls = tagName === "textarea" || tagName === "select" ? elements(html, tagName) : openingTags(html, tagName).map((attributes) => ({ attributes }));
    for (const control of controls) {
      if (control.attributes.get("type") === "hidden") continue;
      const id = control.attributes.get("id");
      const explicitlyLabeled = id && new RegExp(`<label\\b[^>]*\\bfor=["']${id}["']`, "i").test(html);
      if (!explicitlyLabeled && !control.attributes.get("aria-label") && !control.attributes.get("aria-labelledby") && !control.attributes.get("title")) {
        fail(pageName, `<${tagName}> needs a programmatic label`);
      }
    }
  }

  for (const table of elements(html, "table")) {
    if (elements(table.content, "caption").length !== 1) fail(pageName, "table needs a caption");
    for (const header of elements(table.content, "th")) {
      if (!/^(col|row|colgroup|rowgroup)$/.test(header.attributes.get("scope") ?? "")) {
        fail(pageName, "table header needs a valid scope");
      }
    }
  }

  for (const attributes of openingTags(html, "[a-z][a-z0-9-]*")) {
    const tabIndex = attributes.get("tabindex");
    if (tabIndex && Number(tabIndex) > 0) fail(pageName, "positive tabindex changes the natural tab order");

    for (const attributeName of ["aria-labelledby", "aria-describedby", "aria-controls"]) {
      const references = attributes.get(attributeName)?.trim().split(/\s+/).filter(Boolean) ?? [];
      for (const reference of references) {
        if (!idSet.has(reference)) fail(pageName, `${attributeName} references missing id ${reference}`);
      }
    }
  }

  const header = elements(html, "header")[0];
  if (header) {
    const skipLink = elements(html, "a").find((anchor) => anchor.attributes.get("class")?.split(/\s+/).includes("skip-link"));
    const main = elements(html, "main")[0];
    if (!skipLink || skipLink.attributes.get("href") !== "#main") {
      fail(pageName, "pages with a header need a skip link to #main");
    }
    if (!main || main.attributes.get("id") !== "main" || main.attributes.get("tabindex") !== "-1") {
      fail(pageName, "skip-link target must be main#main with tabindex=-1");
    }
    if (!/<script\b[^>]*\bsrc="script\.js(?:\?[^\"]*)?"[^>]*\bdefer\b[^>]*><\/script>/i.test(html)) {
      fail(pageName, "pages with a skip link must load the deferred focus-management script");
    }
  }
}

function channel(value) {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((part) => channel(Number.parseInt(part, 16)));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function checkContrast(name, foreground, background, minimum) {
  const ratio = contrastRatio(foreground, background);
  if (ratio < minimum) fail("styles.css", `${name} contrast is ${ratio.toFixed(2)}:1, expected at least ${minimum}:1`);
}

function checkStyles() {
  const css = readFileSync(resolve(root, "styles.css"), "utf8");
  const variables = new Map([...css.matchAll(/--([\w-]+):\s*(#[\da-f]{6})\s*;/gi)].map((match) => [match[1], match[2].toLowerCase()]));
  const color = (name) => {
    const value = variables.get(name);
    if (!value) fail("styles.css", `missing color token --${name}`);
    return value ?? "#000000";
  };

  if (!/:focus-visible\s*\{[^}]*outline:/is.test(css)) fail("styles.css", "missing visible keyboard focus treatment");
  if (!/\.skip-link:focus\s*\{[^}]*transform:\s*translateY\(0\)/is.test(css)) fail("styles.css", "skip link is not revealed on focus");
  if (!/@media\s*\(prefers-reduced-motion:\s*reduce\)/i.test(css)) fail("styles.css", "missing reduced-motion treatment");
  if (!/@media\s*\(forced-colors:\s*active\)/i.test(css)) fail("styles.css", "missing forced-colors treatment");
  if (!/@media\s*\(max-width:\s*(?:5\d\d|[1-4]\d\d|3[0-1]\d)px\)/i.test(css)) fail("styles.css", "missing narrow-screen reflow breakpoint");
  if (!/@media\s*\(max-width:\s*5\d\dpx\)[\s\S]*?\.privacy-header\s*\{[^}]*flex-direction:\s*column/is.test(css)) fail("styles.css", "policy header must stack at narrow widths");
  if (!/@media\s*\(max-width:\s*5\d\dpx\)[\s\S]*?\.policy-page-nav\s*\{[^}]*flex-wrap:\s*wrap/is.test(css)) fail("styles.css", "policy navigation must wrap at narrow widths");
  if (!/\.file-type\s*\{[^}]*color:\s*var\(--accent-hover\)/is.test(css)) fail("styles.css", "ZIP badge must use the AA contrast color");

  checkContrast("body muted text", color("muted"), color("canvas"), 4.5);
  checkContrast("body faint text", color("faint"), color("canvas"), 4.5);
  checkContrast("primary button text", "#ffffff", color("accent"), 4.5);
  checkContrast("ZIP badge text", color("accent-hover"), color("accent-soft"), 4.5);
  checkContrast("dark-surface secondary text", color("dark-muted"), color("dark"), 4.5);
  checkContrast("focus indicator", "#316ee8", color("canvas"), 3);
}

function checkBehavior() {
  const javascript = readFileSync(resolve(root, "script.js"), "utf8");
  if (/\.style(?:\.|\[)/.test(javascript)) {
    fail("script.js", "inline style mutation is incompatible with the site content security policy");
  }
  if (!/querySelectorAll\(['"]\.skip-link\[href\^=[^\)]*\)/.test(javascript)) {
    fail("script.js", "missing skip-link event binding");
  }
  if (!/target\.focus\(\)/.test(javascript)) {
    fail("script.js", "skip-link handler must move focus to its target");
  }
  if (/setTimeout[\s\S]*copyStatus\.textContent\s*=\s*["']["']/.test(javascript)) {
    fail("script.js", "copy status must not disappear on an automatic timer");
  }
  if (!/permissions-table-wrap\[tabindex=["']0["']\][\s\S]*ArrowLeft[\s\S]*ArrowRight/.test(javascript)) {
    fail("script.js", "scrollable permissions table needs explicit arrow-key support");
  }
}

function checkStatement() {
  const statement = readFileSync(resolve(root, "accessibility.html"), "utf8");
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const playwrightVersion = packageJson.devDependencies?.["@playwright/test"];
  for (const required of [
    "not a claim of legal certification",
    "400 percent",
    "NVDA",
    "VoiceOver",
    "320 CSS pixels",
    `Playwright ${playwrightVersion}`,
    "sift-ai-video-filter-site/issues",
  ]) {
    if (!statement.includes(required)) fail("accessibility.html", `accessibility status is missing: ${required}`);
  }
  for (const pageName of pageNames) {
    if (hasUnsupportedConformanceClaim(readFileSync(resolve(root, pageName), "utf8"))) {
      fail(pageName, "must not claim ADA or WCAG conformance before the manual release gates pass");
    }
  }
}

function checkPageCoverage() {
  const discovered = readdirSync(root)
    .filter((name) => name.endsWith(".html"))
    .sort();
  const expected = [...pageNames].sort();
  if (JSON.stringify(discovered) !== JSON.stringify(expected)) {
    fail(
      "site pages",
      `rendered/source coverage mismatch; found ${discovered.join(", ")}; configured ${expected.join(", ")}`,
    );
  }
}

checkPageCoverage();
for (const pageName of pageNames) checkPage(pageName);
checkStyles();
checkBehavior();
checkStatement();

if (failures.length) {
  console.error(`Accessibility checks failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Accessibility checks passed for ${pageNames.length} pages.`);
}
