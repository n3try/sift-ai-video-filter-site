# Sift download site

Public GitHub Pages site for downloading the Sift Chrome extension beta.

## Install

1. Download the versioned ZIP from the GitHub Release or use `downloads/sift-extension-latest.zip`.
2. Extract the `sift-extension-v0.4.3` folder.
3. Open `chrome://extensions` and enable Developer mode.
4. Choose **Load unpacked** and select the extracted folder containing `manifest.json`.

Chrome does not allow normal users to install a third-party extension directly from a website. One-click installation requires the Chrome Web Store or an enterprise-managed browser policy.

Only the current versioned ZIP and its byte-identical `latest` alias belong in `downloads/`. The release check scans both archives, verifies every checksum, and rejects any extension manifest capability outside the exact approved public-release policy in `scripts/release-policy.mjs`. Permission or host-scope changes require a deliberate policy and test update.

## Accessibility checks

Run `npm ci --ignore-scripts` and `npm run check` before publishing. The gate combines an exactly pinned standards-aware HTML validator with project-specific checks for page landmarks, skip links and targets, headings, valid ARIA naming, accessible names, visible-label matching, form and table labels, persistent live status, keyboard scrolling for the narrow permissions table, fragment targets, focus treatment, reduced motion, responsive breakpoints, and the site's key text-color contrast pairs.

A passing script is not ADA certification or proof of WCAG 2.2 AA conformance. Before publishing a new release, complete keyboard-only navigation, 200% text zoom, 400% page zoom at 320 CSS pixels, Windows forced-colors, NVDA with Chrome, and VoiceOver with Safari. Record the browsers, assistive-technology versions, findings, and fixes.

`accessibility.html` publishes the current test status, remaining manual checks, and the accessibility-barrier reporting route. Keep it accurate whenever testing changes.

## Current package

- Version: 0.4.3
- SHA-256: `f8594ca16c4cd834dfa5ceaed0819f8865f790d34ed15d1f66c2a8e892463fa6`
- Source repository: private
- Website and compiled beta package: public
