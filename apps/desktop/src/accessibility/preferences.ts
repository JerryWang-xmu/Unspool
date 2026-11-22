export type ThemePreference = "system" | "light" | "dark" | "high_contrast";
export type DensityPreference = "comfortable" | "compact";

export interface AccessibilityPreferences {
  readonly theme: ThemePreference;
  readonly density: DensityPreference;
  readonly reduceMotion: boolean;
}

export const DEFAULT_ACCESSIBILITY_PREFERENCES: AccessibilityPreferences = {
  theme: "system",
  density: "comfortable",
  reduceMotion: false,
};

export function accessibilityClassName(preferences: AccessibilityPreferences): string {
  return [
    `theme-${preferences.theme}`,
    `density-${preferences.density}`,
    preferences.reduceMotion ? "reduce-motion" : "motion-allowed",
  ].join(" ");
}

export const RISK_TEXT_CUES = Object.freeze({
  approvalRequired: "Approval required before any side effect",
  unknownOutcome: "Outcome unknown; do not retry automatically",
  staleConnection: "Content may be stale",
  invalidatedApproval: "Approval invalidated; do not execute",
});
