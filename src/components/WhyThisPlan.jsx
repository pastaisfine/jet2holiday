import { Sparkle } from "@phosphor-icons/react";

/**
 * The aggregate answer to "why does the plan look this way?", built from the
 * planner's deterministic tallies. Every number here can be traced to votes
 * the group actually cast.
 */
export default function WhyThisPlan({ rationale }) {
  const bullets = rationale?.bullets || [];
  if (bullets.length === 0) return null;

  return (
    <div className="plan-block why-plan">
      <div className="plan-block-title">
        <Sparkle size={14} weight="fill" /> Why this plan?
      </div>
      <ul className="why-plan-list">
        {bullets.map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
      </ul>
    </div>
  );
}
