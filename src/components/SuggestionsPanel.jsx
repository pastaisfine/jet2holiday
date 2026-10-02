import { ThumbsUp, ThumbsDown } from "@phosphor-icons/react";
import {
  tallySuggestionVotes,
  majorityNeeded,
  mySuggestionVote,
} from "../services/planCollaboration";

function describeSuggestion(suggestion) {
  const payload = suggestion.payload || {};
  if (suggestion.type === "add") return `Add ${payload.stop?.name || "a place"}`;
  if (suggestion.type === "remove") return `Remove ${payload.name || "a stop"}`;
  if (suggestion.type === "replace") {
    return `Swap ${payload.old_name || "a stop"} for ${payload.place?.name || "another place"}`;
  }
  return "Change";
}

/**
 * Post-confirm change proposals for one day. A suggestion passes when a
 * majority of members back it (with the same turnout floor as day votes), at
 * which point whichever client sees it first applies the edit and re-routes.
 */
export default function SuggestionsPanel({
  suggestions,
  members,
  myId,
  onVote,
  onSuggest,
  busy,
}) {
  const needed = majorityNeeded(members.length);
  const open = suggestions.filter((s) => s.status === "open");
  const applied = suggestions.filter((s) => s.status === "applied");

  return (
    <div className="suggest-panel">
      <div className="suggest-head">
        <div className="suggest-title">Change suggestions</div>
        <button className="btn btn-secondary btn-xs" disabled={busy} onClick={onSuggest}>
          + Suggest a change
        </button>
      </div>

      {open.length === 0 && applied.length === 0 && (
        <p className="plan-empty-note">
          The plan is confirmed. Propose a change and the group votes on it.
        </p>
      )}

      {open.map((suggestion) => {
        const { cast } = tallySuggestionVotes(suggestion);
        const mine = mySuggestionVote(suggestion, myId);
        return (
          <div className="suggest-row" key={suggestion.id}>
            <div className="suggest-main">
              <div className="suggest-text">{describeSuggestion(suggestion)}</div>
              <div className="suggest-meta">
                proposed by {suggestion.proposer_name || "a member"} · {cast}/{members.length} voted · needs {needed}
              </div>
            </div>
            <div className="suggest-votes">
              <button
                className={`suggest-vote up ${mine === "up" ? "sel" : ""}`}
                aria-label="Support this suggestion"
                disabled={busy}
                onClick={() => onVote(suggestion, "up")}
              >
                <ThumbsUp size={14} weight={mine === "up" ? "fill" : "regular"} />
              </button>
              <button
                className={`suggest-vote down ${mine === "down" ? "sel" : ""}`}
                aria-label="Oppose this suggestion"
                disabled={busy}
                onClick={() => onVote(suggestion, "down")}
              >
                <ThumbsDown size={14} weight={mine === "down" ? "fill" : "regular"} />
              </button>
            </div>
          </div>
        );
      })}

      {applied.length > 0 && (
        <div className="suggest-applied">
          {applied.map((suggestion) => (
            <div key={suggestion.id} className="suggest-applied-row">
              ✓ {describeSuggestion(suggestion)} — applied by the group
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
