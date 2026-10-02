import { ThumbsUp, ThumbsDown, CheckCircle } from "@phosphor-icons/react";
import { tallyDayVotes, majorityNeeded, votesForDay } from "../services/planCollaboration";

/**
 * Per-day group vote: named avatars (the same social texture as the group's
 * live swipes), a thumbs control for the current member, and the turnout the
 * majority rule needs. Votes are mutable until the leader closes voting.
 */
export default function DayVoteBar({
  dayIndex,
  votes,
  members,
  myId,
  disabled = false,
  onVoteUp,
  onVoteDown,
}) {
  const { cast, up, down } = tallyDayVotes(votes, dayIndex);
  const needed = majorityNeeded(members.length);
  const approved = cast >= needed && up > down;
  const rejected = cast >= needed && down > up;
  const mine = votesForDay(votes, dayIndex).find((v) => v.user_id === myId);

  return (
    <div className={`day-vote ${approved ? "approved" : ""} ${rejected ? "rejected" : ""}`}>
      <div className="day-vote-main">
        <div className="day-vote-avatars" aria-label="How the group voted">
          {members.map((member) => {
            const vote = votesForDay(votes, dayIndex).find((v) => v.user_id === member.userId);
            return (
              <span
                key={member.userId}
                className={`day-vote-avatar ${vote?.vote || ""} ${member.userId === myId ? "me" : ""}`}
                style={vote ? { background: member.avatarColor } : undefined}
                title={`${member.username}${vote ? (vote.vote === "up" ? " approved" : " rejected") : " hasn't voted"}`}
              >
                {vote?.vote === "down" ? (
                  <ThumbsDown size={12} weight="fill" />
                ) : vote?.vote === "up" ? (
                  <ThumbsUp size={12} weight="fill" />
                ) : (
                  (member.username || "?").slice(0, 1).toUpperCase()
                )}
              </span>
            );
          })}
        </div>
        <div className="day-vote-status">
          {approved ? (
            <>
              <CheckCircle size={14} weight="fill" /> Approved
            </>
          ) : rejected ? (
            "The group asked for a rebuild"
          ) : cast === 0 ? (
            "No votes yet"
          ) : (
            `${up} up · ${down} down — waiting on the rest`
          )}
          <span className="day-vote-turnout">
            {cast}/{members.length} voted · needs {needed}
          </span>
        </div>
      </div>

      <div className="day-vote-actions" role="group" aria-label="Vote on this day">
        <button
          className={`day-vote-btn up ${mine?.vote === "up" ? "sel" : ""}`}
          disabled={disabled}
          aria-pressed={mine?.vote === "up"}
          aria-label="Approve this day"
          onClick={() => onVoteUp(dayIndex)}
        >
          <ThumbsUp size={16} weight={mine?.vote === "up" ? "fill" : "regular"} />
          Like
        </button>
        <button
          className={`day-vote-btn down ${mine?.vote === "down" ? "sel" : ""}`}
          disabled={disabled}
          aria-pressed={mine?.vote === "down"}
          aria-label="Reject this day with reasons"
          onClick={() => onVoteDown(dayIndex)}
        >
          <ThumbsDown size={16} weight={mine?.vote === "down" ? "fill" : "regular"} />
          Rebuild
        </button>
      </div>
    </div>
  );
}
