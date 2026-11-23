const test = require("node:test");
const assert = require("node:assert/strict");
const { isValidIpcArguments, isValidIpcPayload } = require("../electron/ipc-payload.cjs");

test("accepts bounded app payloads used by browser IPC", () => {
  assert.equal(isValidIpcArguments(["https://example.com", { enabled: true, count: 2 }] ), true);
});

test("rejects oversized strings and argument lists", () => {
  assert.equal(isValidIpcPayload("x".repeat(1024 * 1024 + 1)), false);
  assert.equal(isValidIpcArguments(Array(9).fill("x")), false);
});

test("rejects unsafe object keys and non-plain objects", () => {
  assert.equal(isValidIpcPayload(JSON.parse('{"__proto__":{"polluted":true}}')), false);
  assert.equal(isValidIpcPayload(new Date()), false);
});

test("rejects excessive nesting, node counts, and non-finite numbers", () => {
  let deep = "value";
  for (let index = 0; index < 18; index += 1) deep = [deep];
  assert.equal(isValidIpcPayload(deep), false);
  assert.equal(isValidIpcPayload(Number.POSITIVE_INFINITY), false);
  assert.equal(isValidIpcPayload(Array(10001).fill(0)), false);
});
