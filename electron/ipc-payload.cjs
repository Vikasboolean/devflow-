const MAX_DEPTH = 16;
const MAX_NODES = 12000;
const MAX_KEYS = 2048;
const MAX_ARRAY_LENGTH = 10000;
const MAX_STRING_LENGTH = 1024 * 1024;

function isValidIpcPayload(value) {
  let nodes = 0;
  let keys = 0;

  function visit(item, depth) {
    nodes += 1;
    if (nodes > MAX_NODES || depth > MAX_DEPTH) return false;
    if (item === null || typeof item === "boolean") return true;
    if (typeof item === "number") return Number.isFinite(item);
    if (typeof item === "string") return item.length <= MAX_STRING_LENGTH;
    if (Array.isArray(item)) {
      return item.length <= MAX_ARRAY_LENGTH && item.every(child => visit(child, depth + 1));
    }
    if (typeof item !== "object") return false;

    const prototype = Object.getPrototypeOf(item);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const ownKeys = Object.keys(item);
    keys += ownKeys.length;
    if (keys > MAX_KEYS) return false;

    return ownKeys.every(key =>
      key.length <= 256 &&
      !["__proto__", "prototype", "constructor"].includes(key) &&
      visit(item[key], depth + 1)
    );
  }

  return visit(value, 0);
}

function isValidIpcArguments(args) {
  return Array.isArray(args) && args.length <= 8 && isValidIpcPayload(args);
}

module.exports = { isValidIpcArguments, isValidIpcPayload };
