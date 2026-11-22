export const NEW_TAB_BACKGROUND_DEFAULTS = Object.freeze({
  enabled: false,
  animation: "leaves",
  speed: "normal",
  intensity: "medium",
  opacity: 0.58,
  blur: 0,
  staticBackground: "default",
  lowPerformance: false
});

const animations = new Set(["none", "leaves", "water", "clouds", "snow", "particles", "waves", "stars", "aurora", "rain", "wind"]);
const speeds = new Set(["slow", "normal", "fast"]);
const intensities = new Set(["low", "medium", "high"]);
const staticBackgrounds = new Set(["default", "midnight", "dawn"]);

export function normalizeNewTabBackground(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : NEW_TAB_BACKGROUND_DEFAULTS.enabled,
    animation: animations.has(source.animation) ? source.animation : NEW_TAB_BACKGROUND_DEFAULTS.animation,
    speed: speeds.has(source.speed) ? source.speed : NEW_TAB_BACKGROUND_DEFAULTS.speed,
    intensity: intensities.has(source.intensity) ? source.intensity : NEW_TAB_BACKGROUND_DEFAULTS.intensity,
    opacity: Number.isFinite(source.opacity) ? Math.min(1, Math.max(0.1, source.opacity)) : NEW_TAB_BACKGROUND_DEFAULTS.opacity,
    blur: Number.isFinite(source.blur) ? Math.min(14, Math.max(0, source.blur)) : NEW_TAB_BACKGROUND_DEFAULTS.blur,
    staticBackground: staticBackgrounds.has(source.staticBackground) ? source.staticBackground : NEW_TAB_BACKGROUND_DEFAULTS.staticBackground,
    lowPerformance: typeof source.lowPerformance === "boolean" ? source.lowPerformance : NEW_TAB_BACKGROUND_DEFAULTS.lowPerformance
  };
}
