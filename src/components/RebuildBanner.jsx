import { ArrowsClockwise, ArrowRight } from "@phosphor-icons/react";

/**
 * Shown on a day the agent rebuilt from the group's downvote reasons: what the
 * votes said, and which stops the rebuilt day now contains.
 */
export default function RebuildBanner({ info, capReached, isLeader, credit, limit }) {
  if (!info || !info.count) return null;

  return (
    <div className="rebuild-banner" role="status">
      <div className="rebuild-head">
        <ArrowsClockwise size={15} weight="bold" />
        <span>
          Day rebuilt from {info.reasons?.length || 0}{" "}
          {(info.reasons?.length || 0) === 1 ? "vote" : "votes"}
          {info.count > 1 ? ` · rebuild ${info.count} of ${limit}` : ""}
        </span>
      </div>
      {info.reasons?.length > 0 && (
        <div className="rebuild-reasons">
          {info.reasons.map((reason) => (
            <span key={reason} className="rebuild-reason">
              {reason}
            </span>
          ))}
        </div>
      )}
      {info.changed?.length > 0 && (
        <div className="rebuild-changed">
          <ArrowRight size={12} weight="bold" />
          New stops: {info.changed.join(", ")}
        </div>
      )}
      {capReached && (
        <div className="rebuild-cap">
          {isLeader
            ? "The agents have done all they can with this day — edit it by hand, then the group can approve it."
            : `${credit || "The trip creator"} can now settle this day by hand.`}
        </div>
      )}
    </div>
  );
}
