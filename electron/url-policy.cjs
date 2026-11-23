function isSafeUrl(value) {
  try {
    if (typeof value !== "string" || value.length === 0 || value.length > 8192 || value !== value.trim()) return false;
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function shouldBlockWebsiteNavigation(url, isMainFrame) {
  return Boolean(isMainFrame) && !isSafeUrl(url);
}

module.exports = { isSafeUrl, shouldBlockWebsiteNavigation };
