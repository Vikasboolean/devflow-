const test = require("node:test");
const assert = require("node:assert/strict");
const { isSafeUrl, shouldBlockWebsiteNavigation } = require("../electron/url-policy.cjs");

test("allows standard web URLs and rejects privileged or malformed schemes", () => {
  assert.equal(isSafeUrl("https://example.com/path?q=ok"), true);
  assert.equal(isSafeUrl("http://localhost:8000/test"), true);
  for (const url of ["javascript:alert(1)", "data:text/html,hi", "file:///C:/secret", "devflow://newtab", "https://user:pass@example.com", "https://%zz/", " javascript:alert(1)"]) {
    assert.equal(isSafeUrl(url), false, url);
  }
});

test("blocks unsafe main-frame navigation but does not police subframes", () => {
  assert.equal(shouldBlockWebsiteNavigation("javascript:alert(1)", true), true);
  assert.equal(shouldBlockWebsiteNavigation("file:///C:/secret", true), true);
  assert.equal(shouldBlockWebsiteNavigation("https://example.com/", true), false);
  assert.equal(shouldBlockWebsiteNavigation("file:///C:/frame", false), false);
});
