const path = require("node:path");

function safeDownloadFilename(value) {
  const raw = typeof value === "string"
    ? path.win32.basename(value).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[ .]+$/g, "")
    : "";
  if (!raw || raw === "." || raw === "..") return "download";

  // Windows treats these names as devices, including when an extension is present.
  if (/^(con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\s*\..*)?\s*$/i.test(raw)) {
    return `_${raw}`.slice(0, 180);
  }
  return raw.slice(0, 180);
}

module.exports = { safeDownloadFilename };
