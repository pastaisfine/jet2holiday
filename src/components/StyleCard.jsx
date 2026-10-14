import { useEffect, useState } from "react";

// Stagger increment, in ms. Rows arrive 100ms apart so the block reads as a
// ranked list rather than one flat slab. Matches the project's motion language
// and the gate for it lives in src/motion.css.
const STAGGER_MS = 100;

// The identity card: who the traveller is, how much evidence that is standing
// on, and the categories their likes concentrate in.
//
// What is deliberately not here: the detailed evidence, the planning
// preferences, and the itinerary preview. Those are separate sections on the
// screen. This card's whole job is to answer "what does the app think I am" in
// the first three seconds, and every row it does not need is a row that delays
// that answer.
export default function StyleCard({
  style,
  userName = "Alice",
  styleName,
  interestBreakdown = [],
  evidenceLine = "",
}) {
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setAnimate(true), 60);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="stylecard card">
      <div className="st">{userName} · your travel style</div>

      {/*
        `styleName` arrives already checked against the swipe tally by
        resolveStyleName, so the heading here is the one place the identity is
        rendered and it is never the raw model output.
      */}
      <h2>{styleName || style?.name || "Explorer"}</h2>

      {/*
        The name is the agent's reading of the swipes, not a permanent identity,
        and a bare "Based on 18 swipes" is the cheapest way to say so. It sits
        directly under the claim it qualifies rather than in a footnote, because
        the whole reason this screen exists is that the user should trust the
        interpretation and know what it rests on.
      */}
      {evidenceLine && <div className="evidence">{evidenceLine}</div>}

      <div className="who">
        {style?.tagline ||
          "Your travel personality is inferred from your swipe decisions."}
      </div>

      {interestBreakdown.length > 0 && (
        <>
          <div className="traithead">
            <span>Top matches</span>
            <span className="traithead-note">Share of your likes</span>
          </div>

          <div className="trait">
            {interestBreakdown.map((b, i) => (
              <div key={b.category}>
                <div className="row">
                  <b>{b.label}</b>
                  <span className="v">{b.percent}%</span>
                </div>
                <div className="bar">
                  {/* Per-row delay, so the list reads top-down. The width
                      transition itself is switched off under reduced motion in
                      src/motion.css. */}
                  <i
                    style={
                      animate
                        ? { width: `${b.percent}%`, transitionDelay: `${i * STAGGER_MS}ms` }
                        : { width: 0, transitionDelay: `${i * STAGGER_MS}ms` }
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/*
        Pace and budget only. Dining used to sit here as a third chip, but it
        restated the Food row of the preferences table in longer words, and the
        table is the one the user can go and edit.
      */}
      <div className="chipsline">
        {style?.pace && <span className="chip tag-ok">Pace · {style.pace}</span>}
        {style?.budget && <span className="chip">Budget · {style.budget}</span>}
      </div>
    </div>
  );
}
