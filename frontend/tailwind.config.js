/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        sf: {
          bg: "#d4d0c8",
          panel: "#fff",
          border: "#808080",
          softBorder: "#aca899",
          headBg: "#ece9d8",
          rowHover: "#fffbe6",
          select: "#316ac5",
          link: "#0050a0",
          magenta: "#d70073",
          blue: "#1f4e8c",
          danger: "#c40000",
          warn: "#c87800",
        },
      },
      fontFamily: {
        sans: ["Segoe UI", "Tahoma", "Malgun Gothic", "sans-serif"],
        mono: ["Consolas", "Courier New", "monospace"],
      },
    },
  },
  plugins: [],
};
