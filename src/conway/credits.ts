/**
 * Conway Credits Management
 *
 * Monitors the automaton's compute credit balance and triggers
 * survival mode transitions.
 */

import type {
  ConwayClient,
  FinancialState,
  SurvivalTier,
} from "../types.js";
import { SURVIVAL_THRESHOLDS } from "../types.js";

/**
 * Check the current financial state of the automaton.
 */
export async function checkFinancialState(
  conway: ConwayClient,
  usdcBalance: number,
): Promise<FinancialState> {
  const creditsCents = await conway.getCreditsBalance();

  return {
    creditsCents,
    usdcBalance,
    lastChecked: new Date().toISOString(),
  };
}

/**
 * Determine the survival tier based on current credits.
 * Thresholds are checked in descending order: high > normal > low_compute > critical > dead.
 *
 * Zero credits = "critical" (broke but alive — can still accept funding, send distress).
 * Only negative balance (API-confirmed debt) = "dead".
 */
export function getSurvivalTier(creditsCents: number): SurvivalTier {
  if (creditsCents > SURVIVAL_THRESHOLDS.high) return "high";
  if (creditsCents > SURVIVAL_THRESHOLDS.normal) return "normal";
  if (creditsCents > SURVIVAL_THRESHOLDS.low_compute) return "low_compute";
  if (creditsCents >= 0) return "critical";
  return "dead";
}

/**
 * Real-USDC-aware survival tier.
 *
 * In local mode (Termux, no Conway account), the "credits" number is a fake
 * placeholder in credits.json — it does NOT represent real money. The agent's
 * REAL earnings are its on-chain USDC balance. This function computes the tier
 * from REAL USDC so that real earnings genuinely upgrade the agent's behavior:
 *
 *   - $0.00 real USDC  -> low_compute (agent conserves but can still think via
 *                         the user's OpenRouter key and seek revenue)
 *   - real USDC arrives -> normal/high (agent gets fuller capabilities)
 *
 * USDC has 6 decimals and is in USD here. We convert to cents for threshold
 * comparison (1 USDC = 100 cents).
 *
 * @param realUsdcBalance  Real on-chain USDC in USD (e.g. 5.00 = $5)
 * @param isSimulatedCredit  true when local mode (credits are fake)
 * @param fallbackCreditsCents  credits cents (used only in Conway mode)
 * @param hasInferenceProvider  true when an OpenRouter/OpenAI/Ollama key is set
 *                              (in local mode, lets a $0-USDC agent still think)
 */
export function getRealSurvivalTier(
  realUsdcBalance: number,
  isSimulatedCredit: boolean,
  fallbackCreditsCents: number,
  hasInferenceProvider = true,
): SurvivalTier {
  if (!isSimulatedCredit) {
    // Conway mode: credits are real, use them.
    return getSurvivalTier(fallbackCreditsCents);
  }
  // Local mode: drive the tier from REAL on-chain USDC (the agent's real earnings).
  const realCents = Math.round(realUsdcBalance * 100);
  if (realCents > SURVIVAL_THRESHOLDS.high) return "high";
  if (realCents > SURVIVAL_THRESHOLDS.normal) return "normal";
  if (realCents > SURVIVAL_THRESHOLDS.low_compute) return "low_compute";
  // $0 real USDC: if the user gave an inference provider key, the agent can
  // still think (to seek revenue) — floor at low_compute, not critical.
  // If no inference provider at all, critical is correct (can't think).
  if (hasInferenceProvider) return "low_compute";
  if (realCents >= 0) return "critical";
  return "dead";
}

/**
 * Format a credit amount for display.
 */
export function formatCredits(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
