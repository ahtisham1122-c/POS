import type { Config } from "tailwindcss";

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#0f4c35",
          light: "#1a6b4a",
          glow: "rgba(15,76,53,0.3)"
        },
        accent: {
          DEFAULT: "#d4a017",
          light: "#f0b429"
        },
        surface: {
          1: "#0d1117",
          2: "#161b22",
          3: "#21262d",
          4: "#30363d"
        },
        text: {
          primary: "#e6edf3",
          secondary: "#8b949e",
          muted: "#484f58"
        },
        success: "#2ea043",
        danger: "#f85149",
        warning: "#d29922",
        info: "#388bfd"
      },
      borderRadius: {
        sm: "6px",
        DEFAULT: "8px",
        md: "10px",
        lg: "12px",
        xl: "16px",
        full: "9999px"
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"]
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.3)",
        float: "0 8px 24px rgba(0,0,0,0.5)",
        glow: "0 0 20px rgba(15,76,53,0.4)"
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" }
        },
        "pulse-dot": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.5", transform: "scale(1.25)" }
        },
        "slide-in-right": {
          "0%": { transform: "translateX(100%)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" }
        },
        "slide-up": {
          "0%": { transform: "translateY(20px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" }
        },
        "count-up": {
          "0%": { transform: "translateY(10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" }
        },
        "bounce-in": {
          "0%": { transform: "scale(0.8)", opacity: "0" },
          "50%": { transform: "scale(1.05)" },
          "100%": { transform: "scale(1)", opacity: "1" }
        }
      },
      animation: {
        shimmer: "shimmer 2s infinite linear",
        "pulse-dot": "pulse-dot 1.2s infinite",
        "slide-in-right": "slide-in-right 0.3s ease-out forwards",
        "slide-up": "slide-up 0.3s ease-out forwards",
        "count-up": "count-up 0.5s ease-out forwards",
        "bounce-in": "bounce-in 0.3s ease-out forwards"
      }
    },
  },
  plugins: [],
} satisfies Config;
