import { useEffect, useRef } from "react";
import "./NewTabBackground.css";

const canvasAnimations = new Set(["leaves", "water", "snow", "particles", "waves", "stars", "rain", "wind"]);
const speedScale = { slow: 0.48, normal: 1, fast: 1.65 };
const intensityScale = { low: 0.55, medium: 1, high: 1.65 };

function NewTabBackground({ settings }) {
  const canvasRef = useRef(null);
  const frameRef = useRef(0);
  const reducedMotionRef = useRef(false);
  const lastFrameRef = useRef(0);
  const visibleRef = useRef(true);
  const focusedRef = useRef(true);
  const config = settings || {};
  const active = config.enabled && config.animation !== "none";

  useEffect(() => {
    if (!active || !canvasAnimations.has(config.animation)) return undefined;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true, desynchronized: true });
    if (!canvas || !context) return undefined;

    const dimensions = { width: 1, height: 1, pixelRatio: 1 };
    lastFrameRef.current = 0;
    visibleRef.current = true;
    focusedRef.current = document.hasFocus?.() ?? true;
    reducedMotionRef.current = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const lowPerformance = Boolean(config.lowPerformance);
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const speed = speedScale[config.speed] || 1;
    const intensity = intensityScale[config.intensity] || 1;
    const intensityCount = config.intensity === "low" ? 48 : config.intensity === "high" ? 150 : 92;
    const palette = config.animation === "leaves" ? ["#e8a45c", "#f2c16d", "#c96d4a", "#83a86a"] : ["#c5e7ff", "#77bfff", "#ffffff"];
    const particles = [];

    const randomParticle = () => ({
      x: Math.random() * dimensions.width,
      y: Math.random() * dimensions.height,
      size: 1 + Math.random() * (config.animation === "leaves" ? 5 : 2.6),
      vx: (Math.random() - 0.5) * 22,
      vy: 12 + Math.random() * 40,
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 2.3,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.3 + Math.random() * 0.55,
      color: palette[Math.floor(Math.random() * palette.length)]
    });

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dimensions.width = Math.max(1, rect.width);
      dimensions.height = Math.max(1, rect.height);
      dimensions.pixelRatio = Math.min(window.devicePixelRatio || 1, lowPerformance ? 0.8 : 1.25);
      canvas.width = Math.round(dimensions.width * dimensions.pixelRatio);
      canvas.height = Math.round(dimensions.height * dimensions.pixelRatio);
      context.setTransform(dimensions.pixelRatio, 0, 0, dimensions.pixelRatio, 0, 0);
      if (particles.length === 0) particles.push(...Array.from({ length: Math.min(220, Math.round(intensityCount * intensity)) }, randomParticle));
      particles.forEach(particle => { particle.x %= dimensions.width; particle.y %= dimensions.height; });
      draw(0, 0);
    };

    const draw = (time, delta) => {
      const { width, height } = dimensions;
      context.clearRect(0, 0, width, height);
      const elapsed = time * 0.001;
      const motion = Math.min(0.05, delta * 0.001) * speed;
      if (config.animation === "water" || config.animation === "waves") {
        const ocean = config.animation === "waves";
        const layerCount = ocean ? 4 : 3;
        for (let layer = 0; layer < layerCount; layer++) {
          const baseY = height * (ocean ? 0.58 + layer * 0.11 : 0.28 + layer * 0.22);
          const amplitude = height * (ocean ? 0.025 : 0.045) * (1 + layer * 0.12);
          context.beginPath();
          context.moveTo(0, height);
          for (let x = 0; x <= width + 8; x += 8) {
            const y = baseY + Math.sin(x * (ocean ? 0.009 : 0.006) + elapsed * speed * (0.7 + layer * 0.16) + layer) * amplitude
              + Math.sin(x * 0.003 - elapsed * speed * 0.43) * amplitude * 0.45;
            context.lineTo(x, y);
          }
          context.lineTo(width, height);
          context.closePath();
          context.fillStyle = ocean ? ["rgba(23,92,132,.18)", "rgba(37,132,169,.2)", "rgba(97,190,202,.15)", "rgba(183,229,226,.1)"][layer] : ["rgba(51,120,173,.1)", "rgba(61,157,190,.13)", "rgba(149,215,215,.12)"][layer];
          context.fill();
          if (ocean) {
            context.beginPath();
            for (let x = 0; x <= width + 8; x += 8) {
              const y = baseY + Math.sin(x * 0.009 + elapsed * speed * (0.7 + layer * 0.16) + layer) * amplitude;
              if (x === 0) context.moveTo(x, y); else context.lineTo(x, y);
            }
            context.strokeStyle = `rgba(216,246,244,${0.16 - layer * 0.025})`;
            context.lineWidth = 1.2;
            context.stroke();
          }
        }
        return;
      }

      for (const particle of particles) {
        particle.phase += motion * 1.3;
        if (config.animation === "leaves") {
          particle.y += (particle.vy + Math.sin(particle.phase) * 16) * motion;
          particle.x += (particle.vx + Math.cos(particle.phase) * 15) * motion;
          particle.angle += particle.spin * motion;
          if (particle.y > height + 22) { particle.y = -18; particle.x = Math.random() * width; }
          context.save(); context.translate(particle.x, particle.y); context.rotate(particle.angle); context.globalAlpha = particle.alpha;
          context.fillStyle = particle.color; context.beginPath(); context.ellipse(0, 0, particle.size * 0.72, particle.size * 0.38, 0, 0, Math.PI * 2); context.fill();
          context.strokeStyle = "rgba(255,255,255,.28)"; context.lineWidth = 0.6; context.beginPath(); context.moveTo(-particle.size * 0.55, 0); context.lineTo(particle.size * 0.55, 0); context.stroke(); context.restore();
        } else if (config.animation === "snow") {
          particle.y += particle.vy * 0.75 * motion; particle.x += (particle.vx + Math.sin(particle.phase) * 9) * motion;
          if (particle.y > height + 5) { particle.y = -5; particle.x = Math.random() * width; }
          context.globalAlpha = particle.alpha; context.fillStyle = "#fff"; context.beginPath(); context.arc(particle.x, particle.y, particle.size * 0.65, 0, Math.PI * 2); context.fill();
        } else if (config.animation === "rain") {
          particle.y += particle.vy * 5 * motion; particle.x += 45 * motion;
          if (particle.y > height + 20) { particle.y = -20; particle.x = Math.random() * width; }
          context.globalAlpha = particle.alpha * 0.65; context.strokeStyle = "#9cccf2"; context.lineWidth = 1;
          context.beginPath(); context.moveTo(particle.x, particle.y); context.lineTo(particle.x - 5, particle.y + particle.size * 5); context.stroke();
        } else if (config.animation === "stars") {
          context.globalAlpha = particle.alpha * (0.55 + Math.sin(elapsed * 1.4 + particle.phase) * 0.35); context.fillStyle = "#e8f2ff";
          context.beginPath(); context.arc(particle.x, particle.y, Math.max(0.7, particle.size * 0.36), 0, Math.PI * 2); context.fill();
        } else if (config.animation === "wind") {
          particle.x += (35 + Math.sin(particle.phase) * 18) * motion;
          if (particle.x > width + 50) { particle.x = -60; particle.y = Math.random() * height; }
          context.globalAlpha = particle.alpha * 0.42; context.strokeStyle = "#a8d7ea"; context.lineWidth = 1 + particle.size * 0.18;
          context.beginPath(); context.moveTo(particle.x, particle.y);
          context.bezierCurveTo(particle.x + 16, particle.y - 7, particle.x + 34, particle.y + 7, particle.x + 54, particle.y + Math.sin(particle.phase) * 5); context.stroke();
        } else {
          particle.x += particle.vx * 0.5 * motion; particle.y += particle.vy * 0.5 * motion;
          if (particle.x < 0 || particle.x > width) particle.vx *= -1;
          if (particle.y < 0 || particle.y > height) particle.vy *= -1;
          context.globalAlpha = particle.alpha * 0.65; context.fillStyle = particle.color;
          context.beginPath(); context.arc(particle.x, particle.y, particle.size * 0.45, 0, Math.PI * 2); context.fill();
        }
      }
      context.globalAlpha = 1;
    };

    const canRun = () => active && visibleRef.current && focusedRef.current && !document.hidden && !reducedMotionRef.current;
    const tick = timestamp => {
      frameRef.current = 0;
      if (!canRun()) return;
      if (!lowPerformance || timestamp - lastFrame >= 33) {
        draw(timestamp, lastFrameRef.current ? timestamp - lastFrameRef.current : 16);
        lastFrameRef.current = timestamp;
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    const syncFrame = () => {
      if (canRun() && !frameRef.current) frameRef.current = requestAnimationFrame(tick);
      else if (!canRun() && frameRef.current) { cancelAnimationFrame(frameRef.current); frameRef.current = 0; }
    };
    const onVisibility = () => syncFrame();
    const onFocus = () => { focusedRef.current = true; syncFrame(); };
    const onBlur = () => { focusedRef.current = false; syncFrame(); };
    const onMotionPreference = event => { reducedMotionRef.current = event.matches; syncFrame(); };
    const observer = new IntersectionObserver(entries => { visibleRef.current = entries[0]?.isIntersecting ?? true; syncFrame(); });
    observer.observe(canvas);
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas.parentElement || canvas);
    resize();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    media?.addEventListener?.("change", onMotionPreference);
    syncFrame();

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      observer.disconnect(); resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus); window.removeEventListener("blur", onBlur);
      media?.removeEventListener?.("change", onMotionPreference);
    };
  }, [active, config.animation, config.speed, config.intensity, config.lowPerformance]);

  const speedDuration = config.speed === "slow" ? "50s" : config.speed === "fast" ? "19s" : "32s";
  const activeAnimation = active ? config.animation : "none";
  const style = { "--background-opacity": config.opacity ?? 0.58, "--background-blur": `${config.blur ?? 0}px`, "--background-duration": speedDuration, "--background-intensity": config.intensity === "low" ? 0.3 : config.intensity === "high" ? 0.72 : 0.5 };

  return <div className={`new-tab-background static-${config.staticBackground || "default"}`} style={style} aria-hidden="true">
    {active && canvasAnimations.has(activeAnimation) && <canvas ref={canvasRef} className="new-tab-background-canvas" />}
    {activeAnimation === "clouds" && <div className="background-clouds"><i /><i /><i /></div>}
    {activeAnimation === "aurora" && <div className="background-aurora"><i /><i /><i /></div>}
    <div className="new-tab-background-overlay" />
  </div>;
}

export default NewTabBackground;
