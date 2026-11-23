const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

test("missing and malformed data files recover without discarding the malformed file", (t) => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-db-recovery-"));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));

  const electronPath = require.resolve("electron");
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "electron") return { app: { getPath: () => userData } };
    return originalLoad.call(this, request, parent, isMain);
  };
  let database;
  try {
    database = require("../electron/database.cjs");
  } finally {
    Module._load = originalLoad;
    delete require.cache[electronPath];
  }

  assert.equal(database.getSettings().startupBehavior, "homepage");
  const dbPath = path.join(userData, "devflow-data.json");
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(dbPath, "{ invalid json", "utf8");

  assert.equal(database.getSettings().startupBehavior, "homepage");
  const backup = fs.readdirSync(userData).find((name) => name.startsWith("devflow-data.json.corrupt-"));
  assert.ok(backup, "malformed data is preserved in a diagnostic backup");
  assert.equal(fs.readFileSync(path.join(userData, backup), "utf8"), "{ invalid json");

  database.updateSettings({ theme: "light" });
  assert.equal(database.getSettings().theme, "light");
});
