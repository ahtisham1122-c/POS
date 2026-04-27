---
# DESIGN.md - Structured Design Tokens for Noon Dairy POS

# Structured Design Tokens (YAML)
colors:
  primary:
    base: "#0f4c35"        # Deep Forest Green - Main brand color
    light: "#1a6b4a"       # Lighter Green for hovers
    glow: "rgba(15,76,53,0.3)"
  accent:
    base: "#d4a017"        # Harvest Gold - Secondary/Price color
    light: "#f0b429"       # Lighter Gold for highlights
  surface:
    1: "#0d1117"           # Background (Deepest Navy/Black)
    2: "#161b22"           # Card Background (Navy Gray)
    3: "#21262d"           # UI Elements / Inputs
    4: "#30363d"           # Borders / Dividers
  status:
    success: "#2ea043"     # GitHub Success Green
    danger: "#f85149"      # GitHub Danger Red
    warning: "#d29922"     # GitHub Warning Orange
    info: "#388bfd"        # GitHub Info Blue
  text:
    primary: "#e6edf3"     # High Contrast White/Gray
    secondary: "#8b949e"   # Medium Contrast Gray
    muted: "#484f58"       # Low Contrast Disabled Text

typography:
  family:
    sans: ["Inter", "system-ui", "sans-serif"]
    mono: ["JetBrains Mono", "monospace"]
  size:
    xs: "0.75rem"
    sm: "0.875rem"
    base: "1rem"
    lg: "1.125rem"
    xl: "1.25rem"
    "2xl": "1.5rem"
    "3xl": "1.875rem"
  weight:
    light: 300
    normal: 400
    medium: 500
    semibold: 600
    bold: 700
    black: 900

radii:
  sm: "6px"
  default: "8px"
  md: "10px"
  lg: "12px"
  xl: "16px"
  full: "9999px"

shadows:
  card: "0 1px 3px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.3)"
  float: "0 8px 24px rgba(0,0,0,0.5)"
  glow: "0 0 20px rgba(15,76,53,0.4)"

motion:
  duration:
    fast: "150ms"
    standard: "300ms"
    slow: "500ms"
  easing:
    standard: "ease-out"
    linear: "linear"
  animations:
    shimmer: "shimmer 2s infinite linear"
    pulse: "pulse-dot 1.2s infinite"
    slide_up: "slide-up 0.3s ease-out forwards"
    slide_right: "slide-in-right 0.3s ease-out forwards"
    bounce: "bounce-in 0.3s ease-out forwards"

---

# Design Language: Noon Dairy POS

## Vision & Identity
Noon Dairy is a premium, offline-first POS system designed for high-volume retail environments. The visual identity balances the organic trust of a dairy brand with the precision and speed of a modern financial tool. It utilizes an **"Atmospheric Glassmorphism"** aesthetic—deep, dark backgrounds contrasted with vibrant, glowing functional elements.

## Color Philosophy
The palette is rooted in a **Deep Forest Green** (`#0f4c35`), representing the natural origin of dairy products. This is paired with **Harvest Gold** (`#d4a017`) for financial data (prices, totals), creating a professional yet warm "Cash & Nature" atmosphere. 

- **Dark Mode First**: The interface uses a dark navy base to reduce eye strain for cashiers working long shifts.
- **Functional Color**: Status colors (Success, Danger, Info) are strictly tied to system feedback (Stock levels, Payment status).

## Component Language

### The "Glass" Card
Every major UI block is contained within a Card component.
- **Surface Elevation**: Cards use subtle borders (`surface-4`) rather than heavy backgrounds to separate content.
- **Interactive States**: Interactive elements use a "Glow" shadow on hover, reinforcing the digital-first, tactile feel of the system.

### Typography & Readability
The system uses **Inter** for all UI labels to ensure maximum clarity on various screen sizes. **JetBrains Mono** is reserved for all numeric data (receipts, prices, quantities), ensuring that digits line up vertically for quick mental arithmetic by the cashier.

## Motion & Feedback
Movement is used to provide non-obvious feedback:
- **Slide-Up**: Used for receipts and modals to signify they are temporary layers.
- **Pulse**: Used for background sync indicators, providing a "heartbeat" to let the user know the system is alive and syncing.
- **Bounce**: Applied to notifications to catch the user's eye without being intrusive.

## Experience Principles
1. **Speed Over Decoration**: While the app looks premium, every animation is under 300ms. The UI must never feel like it is waiting for a transition.
2. **High Contrast**: Critical data (Total Amount, Milk Weight) is always rendered in `text-primary` or `accent` to be readable from several feet away.
3. **Tactile Boundaries**: Buttons have distinct active states (`scale-95`) to provide "pseudo-haptic" feedback on touchscreens.
