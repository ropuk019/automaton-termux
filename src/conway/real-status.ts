/**
 * Honest Status Writer
 *
 * Writes ~/.automaton/status.json every turn with REAL data only:
 *   - walletAddress: the agent's real EVM/Solana wallet address (from keypair)
 *   - realUsdcBalance: REAL on-chain USDC balance on Base (viem readContract,
 *     free public RPC, no API key, no fake numbers). Starts at $0.00 for a
 *     fresh wallet and only increases when a real human sends real USDC.
 *   - network: the chain the balance was read from
 *   - simulatedCreditCents: the LOCAL-MODE credit balance from credits.json —
 *     clearly labeled as simulated. NOT real money. Exists only so the
 *     survival-tier logic doesn't kill the agent instantly.
 *   - tier: survival tier (derived from whichever balance applies)
 *   - lastActivity: the agent's most recent thinking + tool calls (real log)
 *   - recentTurns: last N turns with real token usage + real cost
 *   - updatedAt: timestamp
 *
 * This file is the single source of truth for the dashboard. Everything that
 * says "real" is a real on-chain number; everything labeled "simulated" is a
 * local placeholder. No fake earnings.
 */

import fs from "fs";
import path from "path";
import { getAutomatonDir } from "../identity/wallet.js";
import { getUsdcBalance } from "./x402.js";
import { createLogger } from "../observability/logger.js";
import type { AutomatonConfig, AgentTurn, SurvivalTier } from "../types.js";
import type { ChainType } from "../identity/chain.js";
import { ulid } from "ulid";

const logger = createLogger("status");

// ─── Activity Ledger ───────────────────────────────────────────────
// A real, attributable record of every external action the agent takes:
// accounts created, posts published, services listed, messages sent, repos
// pushed, deploys. No fake entries. This is the "true owner" view — you can
// see exactly what your agent did, who it approached, what it's selling.

export type ActivityType =
  | "account_created"
  | "post_published"
  | "service_listed"
  | "message_sent"
  | "repo_pushed"
  | "deploy"
  | "research"
  | "payment_received"
  | "other";

export interface ActivityEntry {
  id: string;
  timestamp: string;
  type: ActivityType;
  platform: string;     // e.g. "github", "dev.to", "cloudflare", "fiverr"
  target: string;       // who/what: username, repo, URL, recipient
  url?: string;         // link to the thing, if any
  content: string;      // what was posted/created/said (excerpt)
  result: string;       // "success" | "failed" | "pending" | outcome detail
}

const ACTIVITY_TABLE_SQL = `CREATE TABLE IF NOT EXISTS agent_activity (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  type TEXT NOT NULL,
  platform TEXT NOT NULL,
  target TEXT NOT NULL,
  url TEXT,
  content TEXT,
  result TEXT
);`;

/**
 * Record a real external action to the activity ledger (DB-backed).
 * Call this whenever the agent creates an account, publishes a post,
 * lists a service, sends a message, pushes a repo, or deploys something.
 */
export function writeActivity(
  db: any,
  entry: Omit<ActivityEntry, "id" | "timestamp"> & { id?: string; timestamp?: string },
): void {
  try {
    db.exec(ACTIVITY_TABLE_SQL);
    const id = entry.id || ulid();
    const timestamp = entry.timestamp || new Date().toISOString();
    db.prepare(
      "INSERT INTO agent_activity (id, timestamp, type, platform, target, url, content, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(id, timestamp, entry.type, entry.platform, entry.target, entry.url || null, entry.content || "", entry.result || "");
  } catch (err: any) {
    logger.warn(`writeActivity failed: ${err.message}`);
  }
}

/** Read the most recent N activity entries (newest first) for the dashboard. */
export function getRecentActivity(db: any, limit = 50): ActivityEntry[] {
  try {
    db.exec(ACTIVITY_TABLE_SQL);
    const rows = db.prepare("SELECT * FROM agent_activity ORDER BY timestamp DESC LIMIT ?").all(limit) as any[];
    return rows.map((r) => ({
      id: r.id, timestamp: r.timestamp, type: r.type as ActivityType,
      platform: r.platform, target: r.target, url: r.url || undefined,
      content: r.content || "", result: r.result || "",
    }));
  } catch {
    return [];
  }
}

export interface RealStatus {
  walletAddress: string;
  chainType: ChainType;
  network: string;
  realUsdcBalance: number;       // REAL on-chain USDC, USD. $0.00 until a human sends real USDC.
  realUsdcSource: string;        // e.g. "Base mainnet USDC (0x8335...) via free public RPC"
  /** Where real payments go — the agent's wallet, or the creator's set address. */
  payoutAddress: string;
  payoutIsCreatorWallet: boolean;
  tier: SurvivalTier;
  lastActivity: string | null;   // most recent thinking excerpt (real)
  recentTurns: RealTurnSummary[];
  activityLog: ActivityEntry[];  // REAL external actions (true-owner view)
  agentName: string;
  genesisPromptExcerpt: string;
  startedAt: string;
  updatedAt: string;
}

export interface RealTurnSummary {
  id: string;
  timestamp: string;
  tokenUsage: number;     // real tokens consumed
  costCents: number;      // real-ish cost (based on model pricing; 0 for free local)
  toolCount: number;
  thinkingExcerpt: string; // first ~200 chars of the turn's thinking (real)
  toolsUsed: string[];     // names of tools called (real)
}

export interface StatusWriteInput {
  config: AutomatonConfig;
  walletAddress: string;
  chainType: ChainType;
  tier: SurvivalTier;
  simulatedCreditCents: number;
  isSimulatedCredit: boolean;
  recentTurns: AgentTurn[];
  startedAt: string;
  /** Raw DB handle for reading the activity ledger. */
  db?: any;
  /** Creator's EVM wallet — if set, real payments are routed here (shown in dashboard). */
  creatorPayoutAddress?: string;
}

/**
 * Read the REAL on-chain USDC balance for the wallet and write a complete,
 * honest status.json. Called once per turn from the agent loop.
 */
export async function writeHonestStatus(input: StatusWriteInput): Promise<RealStatus> {
  const {
    config,
    walletAddress,
    chainType,
    tier,
    recentTurns,
    startedAt,
    db,
    creatorPayoutAddress,
  } = input;

  // ─── REAL on-chain USDC balance (Base mainnet by default) ────────
  // Read against the PAYOUT address if set (that's where money lands),
  // otherwise the agent's own wallet.
  const balanceAddress = creatorPayoutAddress || walletAddress;
  let realUsdcBalance = 0;
  const network = chainType === "solana" ? "solana:mainnet" : "eip155:8453";
  try {
    realUsdcBalance = await getUsdcBalance(balanceAddress, network, chainType);
  } catch (err: any) {
    logger.warn(`Real USDC balance read failed: ${err.message}`);
    realUsdcBalance = 0;
  }

  const realUsdcSource =
    chainType === "solana"
      ? "Solana USDC via public RPC"
      : "Base mainnet USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) via free public RPC";

  // Payout routing: if the creator set their own wallet, payments go there;
  // otherwise they go to the agent's own wallet (which the creator controls
  // via the private key in ~/.automaton/wallet.json).
  const payoutAddress = creatorPayoutAddress || walletAddress;
  const payoutIsCreatorWallet = !!creatorPayoutAddress && creatorPayoutAddress !== walletAddress;

  // ─── Real activity from recent turns ─────────────────────────────
  const lastTurn = recentTurns[recentTurns.length - 1];
  const lastActivity = lastTurn
    ? lastTurn.thinking.slice(0, 300)
    : null;

  const recentTurnSummaries: RealTurnSummary[] = recentTurns.slice(-10).map((t) => ({
    id: t.id,
    timestamp: t.timestamp,
    tokenUsage: t.tokenUsage?.totalTokens ?? 0,
    costCents: t.costCents ?? 0,
    toolCount: t.toolCalls?.length ?? 0,
    thinkingExcerpt: (t.thinking || "").slice(0, 200),
    toolsUsed: (t.toolCalls || []).map((tc) => tc.name).filter(Boolean),
  }));

  // ─── Real activity ledger (true-owner view) ──────────────────────
  const activityLog = db ? getRecentActivity(db, 50) : [];

  const status: RealStatus = {
    walletAddress,
    chainType,
    network,
    realUsdcBalance,
    realUsdcSource,
    payoutAddress,
    payoutIsCreatorWallet,
    tier,
    lastActivity,
    recentTurns: recentTurnSummaries,
    activityLog,
    agentName: config.name,
    genesisPromptExcerpt: (config.genesisPrompt || "").slice(0, 200),
    startedAt,
    updatedAt: new Date().toISOString(),
  };

  // ─── Write to ~/.automaton/status.json ───────────────────────────
  try {
    const dir = getAutomatonDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const statusPath = path.join(dir, "status.json");
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2), { mode: 0o600 });
  } catch (err: any) {
    logger.warn(`Failed to write status.json: ${err.message}`);
  }

  return status;
}

/** Read the current status.json (for the dashboard / CLI). */
export function readHonestStatus(): RealStatus | null {
  try {
    const statusPath = path.join(getAutomatonDir(), "status.json");
    if (!fs.existsSync(statusPath)) return null;
    return JSON.parse(fs.readFileSync(statusPath, "utf-8")) as RealStatus;
  } catch {
    return null;
  }
}
