import assert from "node:assert/strict";
import test from "node:test";
import { HtmlValidate } from "html-validate";

const validator = new HtmlValidate({
  extends: ["html-validate:recommended"],
  rules: {
    "aria-label-misuse": "error",
    "doctype-style": "off",
    "void-style": "off"
  }
});

async function ruleIds(source) {
  const report = await validator.validateString(source);
  return report.results.flatMap((result) => result.messages.map((message) => message.ruleId));
}

test("rejects ARIA names on generic elements", async () => {
  const ids = await ruleIds('<div aria-label="Hidden replacement name">Visible text</div>');
  assert.ok(ids.includes("aria-label-misuse"));
});

test("allows names on explicit groups and native lists", async () => {
  const groupIds = await ruleIds('<div role="group" aria-label="Checksum"><code>abc</code></div>');
  const listIds = await ruleIds('<ol aria-label="Evidence"><li>Platform label</li></ol>');
  assert.ok(!groupIds.includes("aria-label-misuse"));
  assert.ok(!listIds.includes("aria-label-misuse"));
});
