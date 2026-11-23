const test = require("node:test");
const assert = require("node:assert/strict");
const { safeDownloadFilename } = require("../electron/download-policy.cjs");

test("download filenames are reduced to safe Windows basenames", () => {
  assert.equal(safeDownloadFilename("..\\..\\outside.txt"), "outside.txt");
  assert.equal(safeDownloadFilename("../outside.txt"), "outside.txt");
  assert.equal(safeDownloadFilename("bad:name?.txt"), "bad_name_.txt");
  assert.equal(safeDownloadFilename("CON"), "_CON");
  assert.equal(safeDownloadFilename("nul.txt"), "_nul.txt");
  assert.equal(safeDownloadFilename("COM1.log"), "_COM1.log");
  assert.equal(safeDownloadFilename("LPT³ .csv"), "_LPT³ .csv");
  assert.equal(safeDownloadFilename("   "), "download");
});
