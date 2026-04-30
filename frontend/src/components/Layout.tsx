import { NavLink, Outlet } from "react-router-dom";

const tabs = [
  { to: "/", label: "Risk Triage", end: true },
  { to: "/wafers", label: "Wafer Map" },
  { to: "/lots", label: "Lot Analysis" },
];

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col bg-sf-bg">
      {/* 타이틀바 */}
      <div className="bg-gradient-to-b from-[#4a5b6c] to-[#2c3845] text-white px-3 py-1 text-[12px] flex items-center gap-2 border-b border-black">
        <span className="font-bold">Wafer Health Dashboard.dxp</span>
        <span className="text-slate-300">— SK Hynix × ASAC · Team 올인원</span>
      </div>

      {/* 메뉴바 */}
      <div className="bg-sf-bg border-b border-sf-border px-2 py-0.5 text-[11px] flex gap-3">
        {["File", "Edit", "View", "Insert", "Tools", "Help"].map((m) => (
          <span
            key={m}
            className="px-1.5 py-0.5 hover:bg-[#316ac5] hover:text-white cursor-default"
          >
            <u>{m[0]}</u>
            {m.slice(1)}
          </span>
        ))}
      </div>

      {/* 페이지 탭 */}
      <div className="tab-bar">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) => `tab ${isActive ? "active" : ""}`}
          >
            {t.label}
          </NavLink>
        ))}
      </div>

      {/* 본문 */}
      <main className="flex-1 p-2 overflow-x-auto">
        <Outlet />
      </main>

      {/* 상태 바 */}
      <footer className="bg-sf-bg border-t border-sf-border text-[11px] px-3 py-1 flex justify-between text-slate-700">
        <span>Online</span>
        <span>ZITboost · die 174,572 / unit 43,643 / wafers 431</span>
      </footer>
    </div>
  );
}
