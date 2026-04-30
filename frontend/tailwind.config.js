/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          // 새 보라 팔레트 (사이드바 잘 보이는 deep purple + 라벤더 포인트)
          primary: "#4c1d95",        // 사이드바 메인 (진한 보라)
          primaryDark: "#2e1065",    // 사이드바 그라데이션 끝
          primaryLight: "#7c3aed",   // hover, 강조 라인
          accent: "#a78bfa",         // 보조 차트 (라벤더)
          accentSoft: "#c4b5fd",     // 더 옅은 라벤더
          mint: "#5eead4",           // 도넛 콘트라스트용
          surface: "#ffffff",
          bg: "#f1f3f9",             // 본문 배경 (살짝 푸른 회색)
          subtle: "#f7f8fc",
          border: "#e2e8f0",
          text: "#1a202c",
          textMuted: "#64748b",
          danger: "#e53e3e",
          warn: "#f59e0b",
          success: "#10b981",
          link: "#7c3aed",
          // 호환용 (기존 코드 깨지지 않게)
          navy: "#4c1d95",
          navyDark: "#2e1065",
        },
        sf: {
          bg: "#f1f3f9",
          panel: "#ffffff",
          border: "#e2e8f0",
          softBorder: "#e2e8f0",
          headBg: "#f7f8fc",
          rowHover: "#f5f3ff",
          select: "#4c1d95",
          link: "#7c3aed",
          magenta: "#d70073",
          blue: "#4c1d95",
          danger: "#e53e3e",
          warn: "#f59e0b",
        },
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "Malgun Gothic", "sans-serif"],
        mono: ["Consolas", "Courier New", "monospace"],
      },
      boxShadow: {
        card: "0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)",
        cardHover: "0 4px 12px rgba(15, 23, 42, 0.08)",
      },
    },
  },
  plugins: [],
};
