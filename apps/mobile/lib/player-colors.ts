import { colors } from "./theme";

export type PlayerColor = {
  base: string;
  tint: string;
  border: string;
  textOnBase: string;
};

export const PLAYER_COLORS: PlayerColor[] = [
  { base: colors.coral, tint: "#FFE7DD", border: colors.coral, textOnBase: "#fff" },
  { base: colors.teal, tint: "#DDF0EE", border: colors.teal, textOnBase: "#fff" },
  { base: colors.amber, tint: "#FFF1D6", border: colors.amber, textOnBase: "#3D2D00" },
  { base: "#7C6EF2", tint: "#E6E3FB", border: "#7C6EF2", textOnBase: "#fff" },
  { base: "#E26EAE", tint: "#FBE3F1", border: "#E26EAE", textOnBase: "#fff" },
  { base: "#5BAE6E", tint: "#DEF0E1", border: "#5BAE6E", textOnBase: "#fff" },
  { base: "#E2A86E", tint: "#FBEDDD", border: "#E2A86E", textOnBase: "#3D2D00" },
  { base: "#6E92E2", tint: "#DDE6F8", border: "#6E92E2", textOnBase: "#fff" },
];

export function getPlayerColor(index: number): PlayerColor {
  return PLAYER_COLORS[index % PLAYER_COLORS.length];
}
