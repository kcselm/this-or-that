/**
 * This or That — Design System
 * "Warm Playful" aesthetic: coral primary, cream backgrounds, teal accents
 */

export const colors = {
  // Brand
  coral: "#FF6B6B",
  coralDark: "#E85454",
  coralLight: "#FFF0EF",

  // Accent
  teal: "#2EC4B6",
  tealDark: "#25A99D",
  tealLight: "#E8FAF8",

  // Warm amber (for highlights, badges)
  amber: "#FFB347",
  amberLight: "#FFF4E3",

  // Backgrounds
  cream: "#FFF8F0",
  warmWhite: "#FFFFFF",

  // Text
  charcoal: "#2D3436",
  slate: "#636E72",
  mist: "#B2BEC3",

  // Surfaces & borders
  sand: "#F0E6DE",
  sandLight: "#F7F2EC",

  // Semantic
  yes: "#2EC4B6",
  yesBg: "#D4F5F0",
  no: "#FF6B6B",
  noBg: "#FFE0E0",
  error: "#E85454",

  // Swipe card
  swipeYesBg: "#D4F5F0",
  swipeNoBg: "#FFE0E0",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  pill: 999,
} as const;

export const typography = {
  hero: {
    fontSize: 42,
    fontWeight: "800" as const,
    letterSpacing: -1,
  },
  h1: {
    fontSize: 28,
    fontWeight: "700" as const,
    letterSpacing: -0.5,
  },
  h2: {
    fontSize: 22,
    fontWeight: "700" as const,
    letterSpacing: -0.3,
  },
  h3: {
    fontSize: 18,
    fontWeight: "600" as const,
  },
  body: {
    fontSize: 16,
    fontWeight: "400" as const,
  },
  bodyBold: {
    fontSize: 16,
    fontWeight: "600" as const,
  },
  caption: {
    fontSize: 13,
    fontWeight: "500" as const,
  },
  tiny: {
    fontSize: 11,
    fontWeight: "600" as const,
    letterSpacing: 0.5,
    textTransform: "uppercase" as const,
  },
} as const;

export const shadows = {
  card: {
    shadowColor: "#C4A882",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  button: {
    shadowColor: "#FF6B6B",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  soft: {
    shadowColor: "#C4A882",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
} as const;
