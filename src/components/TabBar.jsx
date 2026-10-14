import { useNavigate } from "react-router-dom";
import { Compass, Cards, MapTrifold, CheckSquareOffset, Users } from "@phosphor-icons/react";
import LineSidebar from "./LineSidebar";

const TABS = [
  { to: "/hub", label: "Trip", icon: Compass },
  { to: "/swipe", label: "Swipe", icon: Cards },
  { to: "/plan", label: "Plan", icon: MapTrifold },
  { to: "/tasks", label: "Tasks", icon: CheckSquareOffset },
  { to: "/group", label: "Group", icon: Users },
];

export default function TabBar({ active }) {
  const navigate = useNavigate();
  const activeIndex = TABS.findIndex((tab) => tab.label.toLowerCase() === active);

  return (
    <>
      <aside className="tabbar tabbar-desktop" aria-label="Desktop Navigation">
        <LineSidebar
          key={active}
          items={TABS.map((tab) => tab.label)}
          accentColor="var(--fg)"
          textColor="var(--muted)"
          markerColor="var(--border)"
          proximityRadius={72}
          maxShift={12}
          markerLength={28}
          tickScale={0.5}
          itemGap={22}
          fontSize={0.9}
          smoothing={100}
          defaultActive={activeIndex >= 0 ? activeIndex : 0}
          onItemClick={(index) => navigate(TABS[index].to)}
        />
      </aside>

      <div className="tabbar tabbar-mobile" aria-label="Bottom Navigation">
        <nav className="bottom-nav">
          {TABS.map((tab) => {
            const isActive = tab.label.toLowerCase() === active;
            const Icon = tab.icon;
            return (
              <button
                key={tab.to}
                className={`nav-item ${isActive ? "active" : ""}`}
                onClick={() => navigate(tab.to)}
                title={tab.label}
                aria-label={tab.label}
              >
                <Icon weight={isActive ? "fill" : "regular"} size={22} />
                {isActive && <div className="nav-indicator" />}
              </button>
            );
          })}
        </nav>
      </div>
    </>
  );
}
