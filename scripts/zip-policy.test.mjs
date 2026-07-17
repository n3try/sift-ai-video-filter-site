import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import { validateGeneratedIcon, zipEntries } from "./zip-policy.mjs";

const archive = readFileSync(resolve(import.meta.dirname, "..", "downloads", "sift-extension-v0.4.3.zip"));

test("accepts the exact published ZIP structure", () => {
  const parsed = zipEntries(archive);
  assert.equal(parsed.entries.length, 22);
});

test("rejects an archive comment payload", () => {
  const payload = Buffer.from("hidden archive payload");
  const mutated = Buffer.concat([archive, payload]);
  mutated.writeUInt16LE(payload.length, archive.length - 2);
  assert.throws(() => zipEntries(mutated));
});

test("rejects a central-entry comment", () => {
  const mutated = Buffer.from(archive);
  const end = mutated.length - 22;
  const centralOffset = mutated.readUInt32LE(end + 16);
  mutated.writeUInt16LE(1, centralOffset + 32);
  assert.throws(() => zipEntries(mutated));
});

test("rejects a local extra field", () => {
  const mutated = Buffer.from(archive);
  mutated.writeUInt16LE(1, 28);
  assert.throws(() => zipEntries(mutated));
});

test("rejects an unreferenced gap before the central directory", () => {
  const end = archive.length - 22;
  const centralOffset = archive.readUInt32LE(end + 16);
  const payload = Buffer.from("hidden gap payload");
  const mutated = Buffer.concat([
    archive.subarray(0, centralOffset),
    payload,
    archive.subarray(centralOffset),
  ]);
  const mutatedEnd = end + payload.length;
  mutated.writeUInt32LE(centralOffset + payload.length, mutatedEnd + 16);
  assert.throws(() => zipEntries(mutated));
});

test("accepts generated icons and rejects appended PNG data", () => {
  const icon = zipEntries(archive).entries.find((entry) => entry.name === "assets/icon-32.png");
  assert(icon);
  assert.doesNotThrow(() => validateGeneratedIcon(icon.name, icon.data));
  assert.throws(() => validateGeneratedIcon(icon.name, Buffer.concat([icon.data, Buffer.from("hidden")])), /truncated PNG chunk|trailing bytes/);
});
