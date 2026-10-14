import { useCallback, useEffect, useRef, useState } from "react";
import "./LineSidebar.css";

const FALLOFF_CURVES = {
  linear: (proximity) => proximity,
  smooth: (proximity) => proximity * proximity * (3 - 2 * proximity),
  sharp: (proximity) => proximity * proximity * proximity,
};

export default function LineSidebar({
  items,
  accentColor = "#A855F7",
  textColor = "#c4c4c4",
  markerColor = "#6c6c6c",
  showIndex = true,
  showMarker = true,
  proximityRadius = 100,
  maxShift = 30,
  falloff = "smooth",
  markerLength = 60,
  markerGap = 0,
  tickScale = 0.5,
  scaleTick = true,
  itemGap = 20,
  fontSize = 1.1,
  smoothing = 100,
  defaultActive = null,
  onItemClick,
  className = "",
}) {
  const listRef = useRef(null);
  const itemRefs = useRef([]);
  const targetsRef = useRef([]);
  const currentRef = useRef([]);
  const rafRef = useRef(null);
  const lastRef = useRef(0);
  const activeRef = useRef(defaultActive);
  const smoothingRef = useRef(smoothing);
  const [activeIndex, setActiveIndex] = useState(defaultActive);
  const reducedMotionRef = useRef(
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : { matches: false, addEventListener: () => {}, removeEventListener: () => {} },
  );

  const runFrame = useCallback(function runFrame(now) {
    const dt = Math.min((now - lastRef.current) / 1000, 0.05);
    lastRef.current = now;
    const tau = Math.max(smoothingRef.current, 1) / 1000;
    const easing = 1 - Math.exp(-dt / tau);
    let moving = false;

    itemRefs.current.forEach((element, index) => {
      if (!element) return;
      const target = Math.max(targetsRef.current[index] || 0, activeRef.current === index ? 1 : 0);
      const current = currentRef.current[index] || 0;
      const next = current + (target - current) * easing;
      const settled = Math.abs(target - next) < 0.0015;
      const effect = settled ? target : next;

      currentRef.current[index] = effect;
      element.style.setProperty("--effect", effect.toFixed(4));
      if (!settled) moving = true;
    });

    rafRef.current = moving ? requestAnimationFrame(runFrame) : null;
  }, []);

  const startLoop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    lastRef.current = performance.now();
    rafRef.current = requestAnimationFrame(runFrame);
  }, [runFrame]);

  // Pointer proximity is a high-frequency interaction, so under reduced motion
  // the eased rAF loop is skipped entirely and --effect snaps to its discrete
  // 0/1 value. The active row keeps its colour cue; nothing animates.
  const applyDiscrete = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    itemRefs.current.forEach((element, index) => {
      if (!element) return;
      const value = activeRef.current === index ? 1 : 0;
      currentRef.current[index] = value;
      element.style.setProperty("--effect", String(value));
    });
  }, []);

  const handlePointerMove = useCallback((event) => {
    const list = listRef.current;
    if (!list) return;

    if (reducedMotionRef.current.matches) {
      applyDiscrete();
      return;
    }

    const pointerY = event.clientY - list.getBoundingClientRect().top;
    const curve = FALLOFF_CURVES[falloff] ?? FALLOFF_CURVES.linear;

    itemRefs.current.forEach((element, index) => {
      if (!element) return;
      const center = element.offsetTop + element.offsetHeight / 2;
      targetsRef.current[index] = curve(Math.max(0, 1 - Math.abs(pointerY - center) / proximityRadius));
    });
    startLoop();
  }, [falloff, proximityRadius, startLoop, applyDiscrete]);

  // Follow the OS setting live, so toggling it takes effect without a reload.
  useEffect(() => {
    const mq = reducedMotionRef.current;
    const onChange = () => (mq.matches ? applyDiscrete() : undefined);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [applyDiscrete]);

  const handlePointerLeave = useCallback(() => {
    targetsRef.current = targetsRef.current.map(() => 0);
    startLoop();
  }, [startLoop]);

  const handleClick = useCallback((index, label) => {
    setActiveIndex(index);
    onItemClick?.(index, label);
  }, [onItemClick]);

  useEffect(() => {
    activeRef.current = activeIndex;
    smoothingRef.current = smoothing;
  }, [activeIndex, smoothing]);

  useEffect(() => {
    startLoop();
  }, [activeIndex, startLoop]);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <nav
      className={`line-sidebar${showMarker ? " line-sidebar--markers" : ""}${scaleTick ? " line-sidebar--scale-tick" : ""}${className ? ` ${className}` : ""}`}
      aria-label="Primary navigation"
      style={{
        "--accent-color": accentColor,
        "--text-color": textColor,
        "--marker-color": markerColor,
        "--marker-length": `${markerLength}px`,
        "--marker-gap": `${markerGap}px`,
        "--tick-scale": tickScale,
        "--max-shift": `${maxShift}px`,
        "--item-gap": `${itemGap}px`,
        "--font-size": `${fontSize}rem`,
      }}
    >
      <ul ref={listRef} className="line-sidebar__list" onPointerMove={handlePointerMove} onPointerLeave={handlePointerLeave}>
        {items.map((label, index) => (
          <li key={`${label}-${index}`} ref={(element) => { itemRefs.current[index] = element; }} className="line-sidebar__item">
            <button
              className="line-sidebar__button"
              type="button"
              aria-current={activeIndex === index ? "page" : undefined}
              onClick={() => handleClick(index, label)}
            >
              {showMarker && <span className="line-sidebar__marker" aria-hidden="true" />}
              <span className="line-sidebar__label">
                {showIndex && <span className="line-sidebar__index">{String(index + 1).padStart(2, "0")}</span>}
                <span className="line-sidebar__text">{label}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
