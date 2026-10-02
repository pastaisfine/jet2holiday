import { Sparkle, X } from "@phosphor-icons/react";

/**
 * The transition moment between individual swipes and collective planning:
 * "We analysed everyone's preferences." Shown once per trip per device, from
 * the planner's own stats so every member sees the same figures.
 */
export default function RevealCard({ stats, onDismiss, onView }) {
  if (!stats || stats.travellers <= 0) return null;

  return (
    <section className="reveal-card" aria-label="Group analysis">
      <button className="reveal-dismiss" aria-label="Dismiss" onClick={onDismiss}>
        <X size={16} weight="bold" />
      </button>
      <div className="reveal-eyebrow">
        <Sparkle size={15} weight="fill" />
        Group intelligence
      </div>
      <h3 className="reveal-title">We analysed everyone's preferences.</h3>
      <div className="reveal-stats">
        <div className="reveal-stat">
          <strong>{stats.travellers}</strong>
          <span>{stats.travellers === 1 ? "traveller" : "travellers"}</span>
        </div>
        <div className="reveal-stat">
          <strong>{stats.preferences}</strong>
          <span>preferences</span>
        </div>
        <div className="reveal-stat">
          <strong>{stats.shared}</strong>
          <span>{stats.shared === 1 ? "shared priority" : "shared priorities"}</span>
        </div>
      </div>
      <p className="reveal-note">Your group plan is ready.</p>
      <button className="btn btn-primary btn-block" onClick={onView}>
        See the plan
      </button>
    </section>
  );
}
