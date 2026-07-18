import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { INTERACTIVE_SITE_PAGES, SITE_PAGES } from "../scripts/site-pages.mjs";

const VIEWPORTS = Object.freeze([
  { name: "desktop", width: 1_280, height: 900 },
  { name: "320px-reflow", width: 320, height: 800 },
]);
const WCAG_TAGS = Object.freeze([
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
]);
const EXPECTED_404_CONSOLE_ERROR = "Failed to load resource: the server responded with a status of 404 (Not Found)";

function violationFingerprints(violations) {
  return violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target),
  }));
}

async function layoutBarriers(page) {
  return page.evaluate(() => ({
    horizontalOverflow: Math.max(
      0,
      document.documentElement.scrollWidth - window.innerWidth,
      document.body.scrollWidth - window.innerWidth,
    ),
    clippedText: [...document.querySelectorAll("main *")]
      .filter((element) => {
        if (!(element instanceof HTMLElement)) return false;
        if (!element.textContent?.trim() || element.closest(".visually-hidden, .clipboard-fallback")) return false;
        const style = getComputedStyle(element);
        return ["hidden", "clip"].includes(style.overflowY)
          && element.scrollHeight > element.clientHeight + 1;
      })
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        id: element.id,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      })),
  }));
}

async function openPage(page, pageName) {
  const route = pageName === "404.html" ? "missing-page" : pageName;
  const expectedStatus = pageName === "404.html" ? 404 : 200;
  const errors = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (pageName === "404.html" && message.text() === EXPECTED_404_CONSOLE_ERROR) return;
    errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("requestfailed", (request) => {
    errors.push(`request: ${request.url()} (${request.failure()?.errorText ?? "unknown"})`);
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const isExpectedNotFoundDocument = pageName === "404.html"
      && response.status() === expectedStatus
      && response.request().isNavigationRequest()
      && response.frame() === page.mainFrame();
    if (!isExpectedNotFoundDocument) errors.push(`response: ${response.status()} ${response.url()}`);
  });

  const response = await page.goto(route, { waitUntil: "domcontentloaded" });
  expect(response?.status(), `${pageName} should load from the isolated test server`).toBe(expectedStatus);
  await expect(page.locator("main")).toBeVisible();
  await page.evaluate(() => document.fonts?.ready);
  return errors;
}

for (const viewport of VIEWPORTS) {
  for (const pageName of SITE_PAGES) {
    test(`${pageName} has no automatic WCAG A/AA violations at ${viewport.name}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const browserErrors = await openPage(page, pageName);
      expect(await page.evaluate(() => window.innerWidth)).toBe(viewport.width);
      if (pageName === "index.html") {
        await page.locator("details").evaluateAll((elements) => {
          for (const element of elements) element.open = true;
        });
      }
      const scan = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();

      await testInfo.attach("axe-results", {
        body: Buffer.from(JSON.stringify(scan, null, 2)),
        contentType: "application/json",
      });
      expect(browserErrors, `${pageName} emitted browser errors`).toEqual([]);
      expect(
        violationFingerprints(scan.violations),
        `${pageName} at ${viewport.name} has automatically detectable WCAG violations`,
      ).toEqual([]);
      expect(
        violationFingerprints(scan.incomplete),
        `${pageName} at ${viewport.name} has axe checks that could not reach a result`,
      ).toEqual([]);

      const overflow = await page.evaluate(() => Math.max(
        0,
        document.documentElement.scrollWidth - window.innerWidth,
        document.body.scrollWidth - window.innerWidth,
      ));
      expect(overflow, `${pageName} creates page-level horizontal overflow`).toBeLessThanOrEqual(1);
    });
  }
}

for (const pageName of SITE_PAGES) {
  test(`${pageName} tolerates WCAG text spacing at 320px reflow`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const browserErrors = await openPage(page, pageName);
    await page.evaluate(() => {
      for (const element of document.querySelectorAll("*")) {
        if (!(element instanceof HTMLElement)) continue;
        element.style.setProperty("line-height", "1.5", "important");
        element.style.setProperty("letter-spacing", "0.12em", "important");
        element.style.setProperty("word-spacing", "0.16em", "important");
      }
      for (const paragraph of document.querySelectorAll("p")) {
        if (paragraph instanceof HTMLElement) {
          paragraph.style.setProperty("margin-bottom", "2em", "important");
        }
      }
    });

    expect(browserErrors, `${pageName} emitted browser errors`).toEqual([]);
    const barriers = await layoutBarriers(page);
    expect(barriers.horizontalOverflow, `${pageName} overflows after WCAG text spacing`).toBeLessThanOrEqual(1);
    expect(barriers.clippedText, `${pageName} clips text after WCAG text spacing`).toEqual([]);
  });

  test(`${pageName} supports 200 percent text resizing`, async ({ page }) => {
    await page.setViewportSize({ width: 1_280, height: 900 });
    const browserErrors = await openPage(page, pageName);
    await page.evaluate(() => {
      const sizes = [...document.querySelectorAll("*")].map((element) => [
        element,
        Number.parseFloat(getComputedStyle(element).fontSize),
      ]);
      for (const [element, size] of sizes) {
        if (element instanceof HTMLElement && Number.isFinite(size)) {
          element.style.setProperty("font-size", `${size * 2}px`, "important");
        }
      }
    });

    expect(browserErrors, `${pageName} emitted browser errors`).toEqual([]);
    const barriers = await layoutBarriers(page);
    expect(barriers.horizontalOverflow, `${pageName} overflows at 200 percent text size`).toBeLessThanOrEqual(1);
    expect(barriers.clippedText, `${pageName} clips text at 200 percent text size`).toEqual([]);
  });
}

for (const viewport of VIEWPORTS) {
  for (const pageName of INTERACTIVE_SITE_PAGES) {
    test(`${pageName} skip link moves focus at ${viewport.name}`, async ({ page, browserName }) => {
      test.skip(
        browserName === "webkit",
        "Playwright WebKit does not enable Safari's full keyboard-access preference; real Safari remains a manual gate.",
      );
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openPage(page, pageName);
      const skipLink = page.locator(".skip-link");

      await page.keyboard.press("Tab");
      await expect(skipLink).toBeFocused();
      expect(await skipLink.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
      const box = await skipLink.boundingBox();
      expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);

      await page.keyboard.press("Enter");
      await expect(page.locator("main#main")).toBeFocused();
    });
  }
}

test("404 page exposes its return action as the first keyboard stop", async ({ page, browserName }) => {
  test.skip(
    browserName === "webkit",
    "Playwright WebKit does not enable Safari's full keyboard-access preference; real Safari remains a manual gate.",
  );
  await openPage(page, "404.html");
  await page.keyboard.press("Tab");
  const returnLink = page.getByRole("link", { name: "Return to Sift" });
  await expect(returnLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/sift-ai-video-filter-site\/(?:index\.html)?$/);
  await expect(page.locator("main#main")).toBeVisible();
});

test("checksum copy success is persistent and receives the exact value", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value) => {
          window.__siftCopiedText = value;
        },
      },
    });
  });
  await openPage(page, "index.html");
  const status = page.locator("#copy-status");
  const checksum = (await page.locator("#checksum").textContent())?.trim();
  const copyButton = page.getByRole("button", { name: "Copy SHA-256 checksum" });

  await copyButton.focus();
  await page.keyboard.press("Enter");
  await expect(status).toHaveText("Checksum copied to clipboard.");
  expect(await page.evaluate(() => window.__siftCopiedText)).toBe(checksum);
  const message = await status.textContent();
  await page.keyboard.press("Tab");
  await expect(status).toHaveText(message ?? "");
  await expect(page.locator(".clipboard-fallback")).toHaveCount(0);
});

test("checksum copy denial selects text and keeps fallback instructions", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => { throw new DOMException("Denied", "NotAllowedError"); } },
    });
    document.execCommand = () => false;
  });
  await openPage(page, "index.html");
  const checksum = (await page.locator("#checksum").textContent())?.trim();
  const copyButton = page.getByRole("button", { name: "Copy SHA-256 checksum" });

  await copyButton.focus();
  await page.keyboard.press("Enter");
  const fallbackMessage = "Checksum selected. Use your system's copy shortcut to copy.";
  await expect(page.locator("#copy-status")).toHaveText(fallbackMessage);
  expect(await page.evaluate(() => getSelection()?.toString().trim())).toBe(checksum);
  await page.keyboard.press("Tab");
  await expect(page.locator("#copy-status")).toHaveText(fallbackMessage);
});

test("narrow permissions table scrolls with arrow keys", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openPage(page, "index.html");
  const region = page.locator(".permissions-table-wrap");
  const dimensions = await region.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth + 1);
  await expect(region).toHaveAttribute("aria-describedby", "permissions-scroll-help");

  await region.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBe(0);
});

test("advanced downloads and FAQ disclosures operate from the keyboard", async ({ page }) => {
  await openPage(page, "index.html");
  for (const details of [page.locator(".advanced-downloads"), page.locator(".faq-list details").first()]) {
    const summary = details.locator("summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(details).toHaveJSProperty("open", true);
    await page.keyboard.press("Space");
    await expect(details).toHaveJSProperty("open", false);
  }
});

test("reduced motion collapses authored transition durations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openPage(page, "index.html");
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  expect(await page.locator("html").evaluate((element) => getComputedStyle(element).scrollBehavior)).toBe("auto");
  const durations = await page.locator(".button-primary").first().evaluate((element) => {
    const milliseconds = (value) => value.split(",").map((part) => {
      const duration = part.trim();
      return duration.endsWith("ms") ? Number.parseFloat(duration) : Number.parseFloat(duration) * 1_000;
    });
    const style = getComputedStyle(element);
    return [...milliseconds(style.transitionDuration), ...milliseconds(style.animationDuration)];
  });
  expect(Math.max(...durations)).toBeLessThanOrEqual(0.02);
});

test("forced colors keeps the primary action and skip link operable", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Playwright forced-colors emulation is asserted in Chromium only.");
  await page.emulateMedia({ forcedColors: "active" });
  await openPage(page, "index.html");
  expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);

  const primaryAction = page.getByRole("link", { name: "Download beta (.zip)" }).first();
  await expect(primaryAction).toBeVisible();
  const borderStyle = await primaryAction.evaluate((element) => getComputedStyle(element).borderTopStyle);
  expect(borderStyle).not.toBe("none");

  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();
});
