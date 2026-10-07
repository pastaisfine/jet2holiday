import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import StyleCard from "../components/StyleCard";
import InfiniteSpiral from "../components/InfiniteSpiral";
import {
  getLikedSwipes,
  getPreferenceSummary,
  readPreferenceHandoff,
  getTripPreferenceSummaries,
} from "../services/preference";
import { getTripMembers } from "../services/tripService";
import {
  CATEGORIES,
  toInterestBars,
  toLegacyTally,
  topCategoryFromTally,
  toEvidenceLine,
  toReasonHighlights,
  toIdealDay,
  toGroupInsight,
  resolveStyleName,
  describeCategory,
  statedPreferenceValue,
  normalisePreferenceValue,
  normaliseDietary,
} from "../lib/preferenceProfile";

const LISBON_FALLBACK = "Lisbon, Portugal";

// The stored row speaks snake_case, the agent and this screen speak camelCase.
// Kept next to the screen so both shapes of the same analysis are visible in
// one place, and so a column added to the table has exactly one reader to update.
function fromRow(row) {
  return {
    summary: {
      styleName: row.style_name,
      tagline: row.tagline,
      pace: row.pace,
      budgetPreference: row.budget_preference,
      diningPreference: row.dining_preference,
      interests: row.interests,
      dislikes: row.dislikes,
      priorities: row.priorities,
      reasoningInsights: row.reasoning_insights,
    },
    metadata: {
      swipeCount: row.swipe_count,
      categoryTally: row.category_tally,
      reasonTally: row.reason_tally,
      reasonedSwipeCount: row.reasoned_swipe_count,
    },
  };
}

export default function StyleScreen({ useAppState }) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { markStyleSeen, allCards, preferenceProfiles, tripId, dest } =
    useAppState;
  const userName = profile?.username || "Alice";
  const preferenceId = profile?.id || profile?.username || "guest";
  const preferences = preferenceProfiles?.[preferenceId];

  // The profile can resolve after first paint. Deriving the hand-off per scope
  // rather than capturing it in state means the scoped copy is read as soon as
  // the traveller is known, and an empty analysis stands in until then -- never
  // the previous traveller's summary. The helper owns the key and the shape.
  const handoff = useMemo(
    () =>
      readPreferenceHandoff({
        userId: profile?.id,
        tripId,
        destination: dest || LISBON_FALLBACK,
      }) || { summary: {}, metadata: {} },
    [profile?.id, tripId, dest]
  );

  // The evidence is tagged with the scope it was fetched for, so a scope change
  // (account or destination) cannot let the previous scope's durable row mask
  // the new scope's hand-off while the refetch is in flight.
  const evidenceScope = `${profile?.id || "guest"}::${tripId || ""}::${dest || LISBON_FALLBACK}`;
  const [storedEvidence, setStoredEvidence] = useState(null);
  const [crewMembers, setCrewMembers] = useState([]);

  const evidence =
    storedEvidence?.scope === evidenceScope ? storedEvidence : null;
  const likedSwipes = useMemo(() => evidence?.rows || [], [evidence]);
  const stored = evidence?.row || null;

  // The sessionStorage copy is what the swipe screen wrote on its way past: it
  // is immediate but tab-scoped, and it is missing everything that arrived
  // after the last analysis. The stored row is durable and is what the group
  // planner reads, so it wins where both exist.
  const { summary, metadata } = stored ? fromRow(stored) : handoff;

  // Load the durable evidence for the signed-in traveller. Kept separate from
  // the crew load so a failure here does not blank the crew card.
  useEffect(() => {
    let cancelled = false;
    const destination = dest || LISBON_FALLBACK;

    Promise.all([
      getLikedSwipes({ tripId, destination }),
      getPreferenceSummary({ tripId, destination }),
    ])
      .then(([rows, row]) => {
        if (cancelled) return;
        setStoredEvidence({ scope: evidenceScope, rows, row });
      })
      // A failed read costs the durable-evidence upgrade and nothing else: the
      // sessionStorage copy and the prose fallback still render a full profile.
      .catch((error) => {
        console.error("Failed to load stored preference evidence:", error);
      });

    return () => {
      cancelled = true;
    };
  }, [tripId, dest, evidenceScope]);

  // Load the real crew and their preference labels. A failure here is logged
  // and leaves the crew section empty; it does not affect the traveller's own
  // profile.
  useEffect(() => {
    let cancelled = false;
    if (!tripId) return;

    getTripMembers(tripId)
      .then((members) =>
        getTripPreferenceSummaries(tripId).then((summaries) => {
          if (cancelled) return;

          const summaryMap = {};
          summaries.forEach((s) => {
            summaryMap[s.user_id] = s.style_name || s.tagline || "Still deciding";
          });

          const formattedCrew = members
            .filter((m) => m.userId !== profile?.id)
            .map((m) => ({
              id: m.membershipId,
              name: m.username,
              label: summaryMap[m.userId] || "Still deciding",
            }));

          setCrewMembers(formattedCrew);
        })
      )
      .catch((error) => {
        console.error("Failed to load crew members:", error);
      });

    return () => {
      cancelled = true;
    };
  }, [profile?.id, tripId]);

  // Every planning constraint on the screen, resolved once.
  //
  // The traveller's own answer wins over the agent's inference for every field:
  // they are the one who filled in the form, and an inference that contradicts
  // it produces a screen showing the same row twice with two different values.
  // The agent is the fallback for fields they left blank, which is the only
  // place it has something to add.
  //
  // Both the identity card's chips and the preferences table read this, so the
  // two cannot drift apart.
  const planning = useMemo(
    () => ({
      pace:
        statedPreferenceValue(preferences?.density) ??
        normalisePreferenceValue(summary.pace),
      budget:
        statedPreferenceValue(preferences?.foodBudget) ??
        normalisePreferenceValue(summary.budgetPreference),
      food: normalisePreferenceValue(preferences?.dining),
      dietary: normaliseDietary(preferences?.dietary),
    }),
    [preferences, summary]
  );

  const style = useMemo(
    () => ({
      name: summary.styleName || "Curious Explorer",
      tagline:
        summary.tagline ||
        "Your travel personality is inferred from your swipe decisions",
      pace: planning.pace,
      budget: planning.budget,
    }),
    [summary, planning]
  );

  // The agent's exact category tally when this analysis carries one, and the
  // prose-derived approximation only for a summary written before the metadata
  // hand-off. Both go through toInterestBars, so a category nobody liked is
  // absent in either case rather than rendered as a 0% row.
  const tally = useMemo(
    () =>
      Array.isArray(metadata.categoryTally) && metadata.categoryTally.length > 0
        ? metadata.categoryTally
        : toLegacyTally(summary.interests || []),
    [metadata.categoryTally, summary.interests]
  );

  // Every category, not the default top four: the label above these bars is
  // "Share of your likes", and a truncated set silently reads as a claim about
  // all of them while the shares add up to less than 100%.
  const interestBreakdown = useMemo(
    () => toInterestBars(tally, { limit: CATEGORIES.length }),
    [tally]
  );

  // Checked against the same tally the bars are drawn from, so the title and the
  // bars cannot disagree -- see resolveStyleName.
  //
  // The agent's own name, not style.name: "Curious Explorer" is the neutral
  // fallback this function also returns, and "curious" reads as a claim on
  // culture, so passing the pre-defaulted name would have a traveller who never
  // said anything renamed to their top category.
  const styleName = useMemo(
    () => resolveStyleName(summary.styleName, tally),
    [summary.styleName, tally]
  );

  const evidenceLine = useMemo(
    () =>
      toEvidenceLine({
        swipeCount: metadata.swipeCount || 0,
        reasonedSwipeCount: metadata.reasonedSwipeCount || 0,
      }),
    [metadata.swipeCount, metadata.reasonedSwipeCount]
  );

  const reasonHighlights = useMemo(
    () => toReasonHighlights(metadata.reasonTally),
    [metadata.reasonTally]
  );

  const idealDay = useMemo(
    () => toIdealDay(likedSwipes, tally),
    [likedSwipes, tally]
  );

  // Derive group insight from the real crew members instead of the hardcoded
  // demo crew. A member whose label cannot be read into a category is skipped
  // rather than guessed at -- see toGroupInsight.
  const groupInsight = useMemo(
    () => toGroupInsight(crewMembers, topCategoryFromTally(tally)),
    [crewMembers, tally]
  );

  useEffect(() => {
    markStyleSeen(styleName);
  }, [styleName, markStyleSeen]);

  const spiralItems = useMemo(
    () => allCards.map((card) => ({ id: card.id, src: card.img, alt: card.name })),
    [allCards]
  );

  const reasoning = summary.reasoningInsights || [];
  const dislikes = summary.dislikes || [];
  const priorities = summary.priorities || [];
  const hasPreferences =
    preferences && (preferences.completed || preferences.skipped);
  const hasReasons =
    reasonHighlights.liked.length > 0 ||
    reasonHighlights.skipped.length > 0;

  return (
    <section className="screen active spiral-screen spiral-screen--style">
      <div className="spiral-backdrop" aria-hidden="true">
        <InfiniteSpiral
          items={spiralItems}
          speed={0.1}
          radius={225}
          cardWidth={156}
          cardHeight={204}
          verticalSpacing={108}
          cardsPerTurn={7}
          rotation={30}
          cardTilt={-6}
          cardRadius={22}
          centerScale={1.04}
          edgeFade={0.2}
          edgeBlur={9}
          grayscale={0.62}
          pauseOnHover={false}
        />
      </div>

      <div className="style-wrap">
        <StyleCard
          style={style}
          userName={userName}
          styleName={styleName}
          interestBreakdown={interestBreakdown}
          evidenceLine={evidenceLine}
        />

        {hasPreferences && (
          <div className="bento-card">
            <div className="section-title">Your planning preferences</div>

            {preferences.skipped ? (
              <p className="section-sub">
                Not set yet. You can add these anytime.
              </p>
            ) : (
              <dl className="prefgrid">
                {[
                  ["Pace", planning.pace],
                  ["Budget", planning.budget],
                  ["Food", planning.food],
                  ["Dietary", planning.dietary],
                ].map(([label, value]) => (
                  <div className="prefrow" key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {preferences.note && (
              <p className="prefnote">
                <strong>Note:</strong> {preferences.note}
              </p>
            )}

            <button
              className="btn btn-secondary edit-prefs"
              onClick={() => {
                sessionStorage.setItem("edit-preferences", "true");
                navigate("/swipe");
              }}
            >
              Edit preferences
            </button>
          </div>
        )}

        {/*
          The evidence behind the claim, folded away. It is here rather than on
          the card because it is the part that is interesting once and
          disposable after -- and because on a generated trip it can be thin, so
          a collapsed section sets the right expectation before it is opened.
        */}
        {(reasoning.length > 0 || dislikes.length > 0 || hasReasons) && (
          <details className="bento-card evidence-card">
            <summary className="section-title">Why we learned this</summary>

            {/*
              The traveller's own words, not the agent's paraphrase of them. The
              reason chips are the differentiator this product has over a
              category grid, so showing what was actually chosen is the one thing
              here that a bare percentage cannot substitute for.
            */}
            {hasReasons && (
              <>
                {reasonHighlights.liked.length > 0 && (
                  <>
                    <div className="subhead">
                      You chose places because
                    </div>
                    <div className="reasonchips">
                      {reasonHighlights.liked.map((row) => (
                        <span className="chip chip--liked" key={row.reason}>
                          “{row.reason}”
                        </span>
                      ))}
                    </div>
                  </>
                )}
                {reasonHighlights.skipped.length > 0 && (
                  <>
                    <div className="subhead">You passed because</div>
                    <div className="reasonchips">
                      {reasonHighlights.skipped.map((row) => (
                        <span className="chip chip--skipped" key={row.reason}>
                          “{row.reason}”
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}

            {reasoning.length > 0 && (
              <ul className="insightlist">
                {reasoning.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            {dislikes.length > 0 && (
              <>
                <div className="subhead">Ruled out</div>
                <ul className="insightlist insightlist--muted">
                  {dislikes.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </>
            )}
          </details>
        )}

        {priorities.length > 0 && (
          <div className="bento-card">
            <div className="section-title">We'll prioritise</div>
            <div className="chipsline">
              {priorities.map((priority) => (
                <span className="chip" key={priority}>
                  {priority}
                </span>
              ))}
            </div>
          </div>
        )}

        {idealDay.length > 0 && (
          <div className="bento-card">
            <div className="section-title">Your ideal day</div>
            <p className="section-sub">
              Built from the {idealDay.length === 1 ? "place" : "places"} you
              liked most
            </p>
            <ol className="idealday">
              {idealDay.map((stop) => (
                <li key={stop.name}>
                  <span className="idealday-name">{stop.name}</span>
                  <span className="idealday-tag">
                    {describeCategory(stop.category)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="bento-card">
          <div className="section-title">Everyone else in the crew</div>
          <div className="crewlist">
            {crewMembers.map((member) => (
              <div className="crewrow" key={member.id}>
                <span className="crewname">{member.name}</span>
                <span className="crewtag">{member.label}</span>
              </div>
            ))}
          </div>

          {/*
            Only rendered when there is something true to say. The previous
            hardcoded line asserted a nature-versus-nightlife conflict on every
            load, so a traveller whose own bars said food sat directly under a
            sentence claiming they wanted nature.
          */}
          {groupInsight && groupInsight.tradeoffs.length > 0 && (
            <div className="groupinsight">
              {groupInsight.agrees.length > 0 && (
                <p>
                  <strong>You agree with</strong>{" "}
                  {groupInsight.agrees.map((m) => m.name).join(", ")} on{" "}
                  {describeCategory(groupInsight.topCategory).toLowerCase()}.
                </p>
              )}
              <p>
                <strong>Worth splitting hairs over:</strong>{" "}
                {groupInsight.tradeoffs
                  .map((m) => `${m.name} leans ${describeCategory(m.category).toLowerCase()}`)
                  .join(", ")}
                .
              </p>
            </div>
          )}
        </div>

        <button
          className="btn btn-primary btn-block"
          onClick={() => navigate("/plan")}
        >
          Show me the shared plan →
        </button>
      </div>
    </section>
  );
}
