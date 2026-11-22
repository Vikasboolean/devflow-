import { useState } from "react";
import { NEW_TAB_BACKGROUND_DEFAULTS, normalizeNewTabBackground } from "./newTabBackgroundSettings";

const animations = [
  ["none", "None", "linear-gradient(145deg,#192231,#263a58)"],
  ["leaves", "Falling Leaves", "radial-gradient(ellipse at 25% 80%,#d79a51 0 4%,transparent 6%),radial-gradient(ellipse at 70% 30%,#a85c42 0 5%,transparent 7%),linear-gradient(#243448,#182131)"],
  ["water", "Flowing Water", "repeating-linear-gradient(170deg,transparent 0 14px,#70b8d455 15px 17px),linear-gradient(#34566e,#1b3345)"],
  ["clouds", "Moving Clouds", "radial-gradient(ellipse at 35% 35%,#cbd8e988 0 18%,transparent 44%),linear-gradient(#58728e,#293a51)"],
  ["snow", "Snowfall", "radial-gradient(circle at 25% 30%,white 0 1px,transparent 2px),radial-gradient(circle at 75% 70%,white 0 2px,transparent 3px),linear-gradient(#23354e,#111a2b)"],
  ["particles", "Floating Particles", "radial-gradient(circle at 30% 40%,#93d8ff 0 2px,transparent 4px),radial-gradient(circle at 72% 66%,#acdfff 0 2px,transparent 4px),linear-gradient(#233750,#111a2a)"],
  ["waves", "Ocean Waves", "repeating-linear-gradient(170deg,transparent 0 11px,#a9e8e155 12px 14px),linear-gradient(#4182a2,#153c59)"],
  ["stars", "Starry Night", "radial-gradient(circle at 25% 40%,#fff 0 1px,transparent 2px),radial-gradient(circle at 68% 24%,#fff 0 1px,transparent 2px),linear-gradient(#101a37,#17264a)"],
  ["aurora", "Aurora Borealis", "linear-gradient(130deg,#143f48,#2a6182,#533e7c,#13213d)"],
  ["rain", "Rainfall", "repeating-linear-gradient(105deg,transparent 0 18px,#c6e8ff55 19px 20px),linear-gradient(#354d68,#19283b)"],
  ["wind", "Wind Flow", "repeating-linear-gradient(170deg,transparent 0 13px,#c4e8f766 14px 15px),linear-gradient(#415b73,#1e3044)"]
];
const staticOptions = [["default", "DevFlow"], ["midnight", "Midnight"], ["dawn", "Dawn"]];

function NewTabCustomize({ settings, onPreview, onApply, onClose }) {
  const [draft, setDraft] = useState(() => normalizeNewTabBackground(settings));
  const [saving, setSaving] = useState(false);
  const update = change => {
    const next = normalizeNewTabBackground({ ...draft, ...change });
    setDraft(next);
    onPreview(next);
  };
  const chooseAnimation = animation => update({ animation, enabled: animation !== "none" });

  const apply = async () => {
    setSaving(true);
    try { await onApply(draft); } finally { setSaving(false); }
  };
  const reset = async () => {
    const defaults = { ...NEW_TAB_BACKGROUND_DEFAULTS };
    setDraft(defaults); onPreview(defaults); setSaving(true);
    try { await onApply(defaults); } finally { setSaving(false); }
  };

  return <aside className="new-tab-customize" aria-label="Customize New Tab">
    <header><div><span>DEVFLOW</span><h2>Customize New Tab</h2></div><button type="button" className="customize-close" onClick={onClose} aria-label="Close customization">×</button></header>
    <section className="customize-section"><h3>Static background</h3><div className="static-background-options">{staticOptions.map(([id, label]) => <button type="button" className={`static-background-option static-${id} ${draft.staticBackground === id ? "selected" : ""}`} key={id} onClick={() => update({ staticBackground: id })} aria-pressed={draft.staticBackground === id}><span />{label}</button>)}</div></section>
    <section className="customize-section"><div className="customize-section-heading"><div><h3>Animated backgrounds</h3><p>Choose a subtle motion layer.</p></div><label className="animation-toggle"><input type="checkbox" checked={draft.enabled && draft.animation !== "none"} onChange={event => update({ enabled: event.target.checked, animation: event.target.checked && draft.animation === "none" ? "leaves" : draft.animation })} /><span>Enabled</span></label></div>
      <div className="animation-gallery">{animations.map(([id, label, background]) => <button type="button" key={id} className={`animation-choice ${draft.animation === id ? "selected" : ""}`} onClick={() => chooseAnimation(id)} aria-pressed={draft.animation === id}><span className={`animation-thumbnail animation-${id}`} style={{ background }}><i /></span><span>{label}</span></button>)}</div>
    </section>
    <section className="customize-section customize-controls"><h3>Motion settings</h3>
      <label>Speed<select value={draft.speed} onChange={event => update({ speed: event.target.value })}><option value="slow">Slow</option><option value="normal">Normal</option><option value="fast">Fast</option></select></label>
      <label>Intensity<select value={draft.intensity} onChange={event => update({ intensity: event.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
      <label>Opacity <output>{Math.round(draft.opacity * 100)}%</output><input type="range" min="0.1" max="1" step="0.05" value={draft.opacity} onChange={event => update({ opacity: Number(event.target.value) })} /></label>
      <label>Background blur <output>{draft.blur}px</output><input type="range" min="0" max="14" step="1" value={draft.blur} onChange={event => update({ blur: Number(event.target.value) })} /></label>
      <label className="low-performance-toggle"><input type="checkbox" checked={draft.lowPerformance} onChange={event => update({ lowPerformance: event.target.checked })} /> Low-performance mode <small>Reduces canvas resolution and frame rate.</small></label>
      <p className="reduced-motion-note">System reduced-motion settings pause animated backgrounds.</p>
    </section>
    <footer><button type="button" onClick={reset} disabled={saving}>Reset</button><button type="button" className="customize-preview" onClick={() => onPreview(draft)}>Preview</button><button type="button" className="customize-apply" onClick={apply} disabled={saving}>{saving ? "Saving…" : "Apply"}</button></footer>
  </aside>;
}

export default NewTabCustomize;
