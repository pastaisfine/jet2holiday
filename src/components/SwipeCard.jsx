import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { forwardRef, useImperativeHandle, useRef } from "react";

// The verdict badge is fully opaque well before the commit threshold, so it is
// already decided by the time the card is allowed to leave.
const BADGE_FULLY_VISIBLE = 60;

// How far past the edge the card travels on its way out. Enough to clear the
// viewport so the exit is not visible behind the deck.
const FLY_OUT_DISTANCE = 640;

/**
 * One card in the deck.
 *
 * The parent drives the verdict, but the card owns the motion: it exposes
 * `flyOut` so a button press and a gesture release leave by the same path.
 * Sequencing the database write behind that animation is the parent's job.
 */
const SwipeCard = forwardRef(function SwipeCard(
  { card, onVerdict, onDetail, stacked, disabled },
  ref
) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-300, 300], [-18, 18]);
  const yesOpacity = useTransform(x, [0, BADGE_FULLY_VISIBLE], [0, 1]);
  const noOpacity = useTransform(x, [-BADGE_FULLY_VISIBLE, 0], [1, 0]);
  const dragShift = useRef(0);
  const flyingOut = useRef(false);

  useImperativeHandle(ref, () => ({
    /**
     * Carries the card off screen in `dir` and resolves once it is out of the
     * way, so the caller can commit the verdict at the moment the card leaves
     * rather than the moment it is dismissed. Resolves immediately if a fly-out
     * is already running or has finished, which keeps a fast second tap from
     * starting a second animation.
     */
    flyOut(dir) {
      if (flyingOut.current) return Promise.resolve();
      flyingOut.current = true;

      const target = dir === "yes" ? FLY_OUT_DISTANCE : -FLY_OUT_DISTANCE;
      const controls = animate(x, target, {
        type: "spring",
        stiffness: 260,
        damping: 30,
        velocity: dir === "yes" ? 900 : -900,
      });

      return controls.finished.catch(() => {});
    },
  }));

  const transform = stacked
    ? `translateY(${stacked * 10}px) scale(${1 - stacked * 0.035})`
    : undefined;

  return (
    <motion.div
      className={`swcard ${stacked ? `back${stacked}` : ""}`}
      style={{ x, rotate, zIndex: 30 - (stacked || 0), transform }}
      drag={stacked === 0 && !disabled ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.7}
      onDragEnd={(_, info) => {
        const dx = info.offset.x;
        const vel = info.velocity.x;
        const fast = Math.abs(vel) > 500;

        // Cleared here as well as in onClick: a drag that falls short of the
        // threshold springs the card home, and the stale offset would otherwise
        // swallow the next tap that was meant to open the detail sheet.
        dragShift.current = dx;

        if (Math.abs(dx) > 84 || (fast && Math.abs(dx) > 34)) {
          onVerdict(dx > 0 ? "yes" : "no");
        } else {
          x.set(0);
          dragShift.current = 0;
        }
      }}
      onClick={() => {
        if (Math.abs(dragShift.current) < 8 && stacked === 0 && !flyingOut.current) {
          onDetail();
        }
        dragShift.current = 0;
      }}
    >
      <div className="ph" style={{ position: "absolute", inset: 0, zIndex: 0 }}>
        {card.img ? (
          <img
            src={card.img}
            alt={card.area ? `${card.name}, ${card.area}` : card.name}
            referrerPolicy="no-referrer"
            loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            onError={(e) => {
              // Reveal the .ph gradient underneath rather than showing a broken
              // image icon. The card stays swipeable either way.
              e.currentTarget.style.display = "none";
            }}
          />
        ) : null}
        <div className="veil" style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(46, 39, 35, 0.1) 0%, transparent 20%, rgba(29, 44, 26, 0.4) 60%, rgba(29, 44, 26, 0.95) 100%)" }} />
        <div className="topline">
          <span className="chip" style={chipInline}>{card.cat.join(" · ")}</span>
          <span className="chip" style={chipInline}>{card.cost}</span>
          {card.estimatedDuration != null && (
            <span className="chip" style={chipInline}>
              ⏱ {card.estimatedDuration < 60
                ? `${card.estimatedDuration} min`
                : `${Math.round(card.estimatedDuration / 60 * 10) / 10} hr`}
            </span>
          )}
        </div>
        <motion.div className="sw-verdict no" style={stacked === 0 ? { opacity: noOpacity } : {}}>SKIP</motion.div>
        <motion.div className="sw-verdict yes" style={stacked === 0 ? { opacity: yesOpacity } : {}}>GO</motion.div>
      </div>
      <div className="body" style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 1, background: "transparent", color: "var(--on-photo)", padding: "20px" }}>
        <div className="pname" style={{ position: "relative", bottom: 0, left: 0, right: 0, color: "var(--on-photo)", marginBottom: "12px" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "28px", letterSpacing: "-0.02em", textShadow: "0 2px 12px rgba(29, 44, 26, 0.6)" }}>{card.name}</h2>
          <div className="area" style={{ fontFamily: "var(--font-mono)", fontSize: "11px", letterSpacing: "0.11em", textTransform: "uppercase", opacity: 0.9, marginTop: "6px" }}>{card.area}</div>
        </div>
        <p className="blurb" style={{ fontSize: "14px", color: "rgba(255,255,255,0.85)", lineHeight: 1.4, margin: 0 }}>{card.blurb}</p>
      </div>
    </motion.div>
  );
});

export default SwipeCard;

const chipInline = {
  background: "rgba(255,255,255,.22)",
  borderColor: "rgba(255,255,255,.34)",
  color: "var(--on-photo)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  fontWeight: 600,
};