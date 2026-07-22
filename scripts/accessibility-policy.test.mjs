import assert from "node:assert/strict";
import test from "node:test";
import { hasUnsupportedConformanceClaim } from "./accessibility-policy.mjs";

for (const claim of [
  "ADA compliant",
  "ADA-compliant",
  "meets ADA requirements",
  "meets the ADA requirement",
  "WCAG 2.2 Level AA conformant",
  "WCAG 2.1 AA compliant",
  "fully accessible",
]) {
  test(`detects unsupported claim: ${claim}`, () => {
    assert.equal(hasUnsupportedConformanceClaim(claim), true);
  });
}

for (const honestStatus of [
  "Target: WCAG 2.2 Level AA",
  "This is not a claim of legal certification.",
  "Automated tests cannot establish accessibility conformance.",
]) {
  test(`allows honest status: ${honestStatus}`, () => {
    assert.equal(hasUnsupportedConformanceClaim(honestStatus), false);
  });
}
