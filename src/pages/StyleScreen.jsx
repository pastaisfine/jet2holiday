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

  const handoff = useMemo(
    () =>
      readPreferenceHandoff({
        userId: profile?.id,
        tripId,
        destination: dest || LISBON_FALLBACK,
      }) || { summary: {}, metadata: {} },
    [profile?.id, tripId, dest]
  );

  const evidenceScope = `${profile?.id || "guest"}::${tripId || ""}::${dest || LISBON_FALLBACK}`;
  const [storedEvidence, setStoredEvidence] = useState(null);
  const [crewMembers, setCrewMembers] = useState([]); // 动态真实团员状态
  
  const evidence =
    storedEvidence?.scope === evidenceScope ? storedEvidence : null;
  const likedSwipes = useMemo(() => evidence?.rows || [], [evidence]);
  const stored = evidence?.row || null;

  const { summary, metadata } = stored ? fromRow(stored) : handoff;

  // 加载真实 Swipe 数据、个人偏好摘要以及真实的 Trip 成员和他们的偏好
  useEffect(() => {
    let cancelled = false;
    const destination = dest || LISBON_FALLBACK;

    Promise.all([
      getLikedSwipes({ tripId, destination }),
      getPreferenceSummary({ tripId, destination }),
      tripId ? getTripMembers(tripId) : Promise.resolve([]),
      tripId ? getTripPreferenceSummaries(tripId) : Promise.resolve([]),
    ])
      .then(([rows, row, members, summaries]) => {
        if (cancelled) return;
        setStoredEvidence({ scope: evidenceScope, rows, row });

        // 将真实成员与他们的偏好摘要（style_name/tagline）结合起来动态生成 Crew
        const summaryMap = {};
        summaries.forEach((s) => {
          summaryMap[s.user_id] = s.style_name || s.tagline || "Traveler";
        });

        const formattedCrew = members
          .filter((m) => m.userId !== profile?.id) // 排除自己，只显示 "Everyone else in the crew"
          .map((m) => ({
            name: m.username,
            label: summaryMap[m.userId] || "Curious Explorer",
          }));

        setCrewMembers(formattedCrew.length > 0 ? formattedCrew : [
          { name: "Ben", label: "Slow-Morning Locavore" },
          { name: "Priya", label: "Curious Culture Collector" },
          { name: "Marcus", label: "Night-Optimist" }
        ]); // 如果还没有其他人加入，保留默认 fallback 避免空白
      })
      .catch((error) => {
        console.error("Failed to load stored preference evidence:", error);
      });

    return () => {
      cancelled = true;
    };
  }, [profile?.id, tripId, dest, evidenceScope]);

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

  const tally = useMemo(
    () =>
      Array.isArray(metadata.categoryTally) && metadata.categoryTally.length > 0
        ? metadata.categoryTally
        : toLegacyTally(summary.interests || []),
    [metadata.categoryTally, summary.interests]
  );

  const interestBreakdown = useMemo(
    () => toInterestBars(tally, { limit: CATEGORIES.length }),
    [tally]
  );

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

  // 用动态获取到的真实 crewMembers 代替硬编码的 CREW
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

        {(reasoning.length > 0 || dislikes.length > 0 || hasReasons) && (
          <details className="bento-card evidence-card">
            <summary className="section-title">Why we learned this</summary>

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
              <div className="crewrow" key={member.name}>
                <span className="crewname">{member.name}</span>
                <span className="crewtag">{member.label}</span>
              </div>
            ))}
          </div>

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