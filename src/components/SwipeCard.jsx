import { motion, useMotionValue, useTransform } from "framer-motion";
import { useRef } from "react";

export default function SwipeCard({ card, onVerdict, onDetail, stacked }) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-300, 300], [-18, 18]);
  const yesOpacity = useTransform(x, [0, 120], [0, 1]);
  const noOpacity = useTransform(x, [-120, 0], [1, 0]);
  const dragShift = useRef(0);

  const transform = stacked
    ? `translateY(${stacked * 10}px) scale(${1 - stacked * 0.035})`
    : undefined;

  return (
    <motion.div
      className={`swcard ${stacked ? `back${stacked}` : ""}`}
      style={{ x, rotate, zIndex: 30 - (stacked || 0), transform }}
      drag={stacked === 0 ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.7}
      onDragEnd={(_, info) => {
        const dx = info.offset.x;
        const vel = info.velocity.x;
        const fast = Math.abs(vel) > 500;
        dragShift.current = dx;
        if (Math.abs(dx) > 84 || (fast && Math.abs(dx) > 34)) {
          onVerdict(dx > 0 ? "yes" : "no");
        } else {
          x.set(0);
        }
      }}
      onClick={() => {
        if (Math.abs(dragShift.current) < 8 && stacked === 0) onDetail();
        dragShift.current = 0;
      }}
    >
      <div className="ph" style={{ position: "absolute", inset: 0, zIndex: 0 }}>
        <img src={card.img} alt={`${card.name} in Lisbon`} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <div className="veil" style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(46, 39, 35, 0.1) 0%, transparent 20%, rgba(29, 44, 26, 0.4) 60%, rgba(29, 44, 26, 0.95) 100%)" }} />
        <div className="topline">
          <span className="chip" style={chipInline}>{card.cat.join(" · ")}</span>
          <span className="chip" style={chipInline}>{card.cost}</span>
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
}

const chipInline = {
  background: "rgba(255,255,255,.22)",
  borderColor: "rgba(255,255,255,.34)",
  color: "var(--on-photo)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  fontWeight: 600,
};
