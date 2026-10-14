// `height`, `color` and `bgColor` used to be passed by callers and silently
// dropped here, so the Hub screen's "group alignment" bar rendered with the
// default mint gradient instead of the solid it asked for. The API stays narrow
// on purpose: `accent` is the only variation the design system asks for, and
// the width tween is switched off under reduced motion in src/motion.css.
export default function ProgressBar({ value, accent = false }) {
  return (
    <div className={`progressbar ${accent ? "accent" : ""}`}>
      <i style={{ width: `${value}%`, background: accent ? "var(--fg)" : undefined }} />
    </div>
  );
}
