import { NavLink, Outlet } from "react-router-dom";
import NotificationBell from "./NotificationBell";
import ChatbotWidget from "./ChatbotWidget";

const tabs = [
  {
    to: "/",
    label: "Overview",
    end: true,
    icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    to: "/wafers",
    label: "Wafer Map",
    icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" strokeLinecap="round" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M5.6 18.4l12.8-12.8" />
      </svg>
    ),
  },
  {
    to: "/data",
    label: "Data",
    icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    ),
  },
];

export default function Layout() {
  return (
    <div className="min-h-screen flex bg-brand-bg">
      {/* 사이드바 */}
      <aside
        className="w-60 text-white flex flex-col flex-shrink-0"
        style={{
          background: "linear-gradient(180deg, #4c1d95 0%, #2e1065 100%)",
        }}
      >
        {/* 프로필 영역 */}
        <div className="px-6 py-6 border-b border-white/15 flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-full bg-white/15 ring-2 ring-white/25 flex items-center justify-center mb-3">
            <svg className="w-9 h-9 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 12c2.7 0 4.9-2.2 4.9-4.9S14.7 2.2 12 2.2 7.1 4.4 7.1 7.1 9.3 12 12 12zm0 2.4c-3.3 0-9.8 1.6-9.8 4.9v2.4h19.6v-2.4c0-3.3-6.5-4.9-9.8-4.9z" />
            </svg>
          </div>
          <div className="font-bold text-[16px] tracking-wide text-white">SK HYNIX</div>
          <div className="text-[11px] text-white/70 mt-1">Wafer Health · ASAC</div>
        </div>

        {/* 메뉴 */}
        <nav className="py-4 flex-1">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
            >
              {t.icon}
              <span>{t.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* 하단 상태 */}
        <div className="px-5 py-4 border-t border-white/15 text-[10px] text-white/70">
          <div className="font-semibold text-white/90 mb-0.5">ZITboost Model</div>
          <div>die 174,572 · unit 43,643</div>
        </div>
      </aside>

      {/* 본문 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 상단 바 */}
        <header className="bg-white border-b border-brand-border px-7 py-4 flex items-center justify-between">
          <div>
            <div className="text-[18px] font-bold text-brand-text">Dashboard</div>
            <div className="text-[11px] text-brand-textMuted mt-0.5">
              Wafer Test 기반 Field Health Data 예측
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-[11px] text-brand-textMuted">
              <span className="inline-block w-2 h-2 rounded-full bg-brand-success mr-1.5 align-middle"></span>
              Online
            </div>
            <div className="w-px h-6 bg-brand-border"></div>
            <NotificationBell />
          </div>
        </header>

        <main className="flex-1 p-6 overflow-x-auto">
          <Outlet />
        </main>
      </div>

      <ChatbotWidget />
    </div>
  );
}
