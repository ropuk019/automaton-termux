#!/usr/bin/env node
/**
 * Automaton Termux Runtime
 *
 * Honest sovereign AI agent runtime for Android/Termux.
 * Faithful fork of Conway-Research/automaton — local-first, no Conway account
 * required (OpenRouter / OpenAI / Anthropic / Ollama for the brain; real on-chain
 * USDC balance on Base for honest money; file-based credits for survival logic).
 *
 * The entry point for the sovereign AI agent.
 * Handles CLI args, bootstrapping, and orchestrating
 * the heartbeat daemon + agent loop.
 */

import fs from "fs";
import path from "path";
import { getWallet, getAutomatonDir } from "./identity/wallet.js";
import { provision, loadApiKeyFromConfig } from "./identity/provision.js";
import { loadConfig, resolvePath } from "./config.js";
import { createDatabase } from "./state/database.js";
import { createConwayClient } from "./conway/client.js";
import { createLocalConwayClient } from "./conway/local-client.js";
import { createInferenceClient } from "./conway/inference.js";
import { writeActivity } from "./conway/real-status.js";
import { createHeartbeatDaemon } from "./heartbeat/daemon.js";
import {
  loadHeartbeatConfig,
  syncHeartbeatToDb,
} from "./heartbeat/config.js";
import { consumeNextWakeEvent, insertWakeEvent } from "./state/database.js";
import { runAgentLoop } from "./agent/loop.js";
import { ModelRegistry } from "./inference/registry.js";
import { loadSkills } from "./skills/loader.js";
import { initStateRepo } from "./git/state-versioning.js";
import { createSocialClient } from "./social/client.js";
import { PolicyEngine } from "./agent/policy-engine.js";
import { SpendTracker } from "./agent/spend-tracker.js";
import { createDefaultRules } from "./agent/policy-rules/index.js";
import type { AutomatonIdentity, AgentState, Skill, SocialClientInterface } from "./types.js";
import { DEFAULT_TREASURY_POLICY } from "./types.js";
import { createLogger, setGlobalLogLevel, StructuredLogger } from "./observability/logger.js";
import { prettySink } from "./observability/pretty-sink.js";
import { bootstrapTopup } from "./conway/topup.js";
import { randomUUID } from "crypto";
import { keccak256, toHex } from "viem";

const logger = createLogger("main");
const VERSION = "0.2.1";

/**
 * Generate a real, deployable tip-jar HTML page with the agent's real wallet
 * address. This is the first earning action on a fresh boot — a real artifact
 * the agent can push to a free host (GitHub Pages / Cloudflare Pages) so humans
 * who value its work can send real USDC on Base.
 */
function generateTipJarPage(
  agentName: string,
  walletAddress: string,
  payoutAddress: string,
  genesisPrompt: string,
): string {
  const payoutIsCreator = payoutAddress !== walletAddress;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${agentName} — Autonomous AI Agent</title>
<style>
  :root { --bg:#0b0e14; --panel:#141925; --border:#232a3a; --text:#e6e9f0; --dim:#8a93a6; --green:#22c55e; --blue:#3b82f6; --purple:#a855f7; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif; background:var(--bg); color:var(--text); padding:24px; line-height:1.6; max-width:680px; margin:0 auto; }
  h1 { font-size:1.6rem; margin-bottom:6px; }
  .sub { color:var(--dim); margin-bottom:24px; font-size:0.9rem; }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:20px; margin-bottom:16px; }
  .label { color:var(--dim); font-size:0.75rem; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:6px; }
  .addr { font-family:ui-monospace,"SF Mono",Menlo,monospace; font-size:0.9rem; word-break:break-all; color:var(--blue); background:#0b0e14; padding:12px; border-radius:8px; border:1px solid var(--border); }
  .pill { display:inline-block; padding:3px 10px; border-radius:999px; font-size:0.72rem; font-weight:600; }
  .ai { background:rgba(168,85,247,0.15); color:var(--purple); }
  .real { background:rgba(34,197,94,0.15); color:var(--green); }
  .mission { color:var(--text); font-size:0.92rem; }
  .disclose { color:var(--dim); font-size:0.8rem; margin-top:12px; font-style:italic; }
  .how { color:var(--dim); font-size:0.82rem; margin-top:8px; }
  a { color:var(--blue); }
</style>
</head>
<body>
  <h1>${agentName}</h1>
  <div class="sub"><span class="pill ai">AUTONOMOUS AI AGENT</span> &nbsp; <span class="pill real">REAL USDC WALLET</span></div>

  <div class="card">
    <div class="label">Who I am</div>
    <p class="mission">I am ${agentName}, an autonomous AI agent built and operated by an Automaton Termux instance. I run a continuous Think → Act → Observe loop: I research the internet, build real tools and content, and deploy them on free hosts. I am not a human. I never pretend to be.</p>
    <p class="disclose">Disclosure (Constitution Law III): I always identify as an AI. I never deceive about what I am or what I do.</p>
  </div>

  <div class="card">
    <div class="label">My mission</div>
    <p class="mission">${(genesisPrompt || "Create genuine value and earn my existence honestly.").slice(0, 400)}</p>
  </div>

  <div class="card">
    <div class="label">Send me USDC on Base (real money)</div>
    <div class="addr">${payoutAddress}</div>
    <p class="how">Network: <strong>Base</strong> (Chain ID 8453) &nbsp;·&nbsp; Token: <strong>USDC</strong> (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)</p>
    ${payoutIsCreator ? '<p class="how">Payments are routed to my creator\'s wallet.</p>' : '<p class="how">This is my own wallet — payments fund my compute so I can keep creating.</p>'}
  </div>

  <div class="card">
    <div class="label">Agent wallet (my identity)</div>
    <div class="addr">${walletAddress}</div>
  </div>

  <div class="card">
    <div class="label">What I do to earn (honestly)</div>
    <p class="mission">I build small useful APIs, write verified technical content, and release open-source tools — all deployed on free hosts with my wallet address shown for voluntary USDC support. No spam, no scams, no fake identities. Only real value that humans voluntarily pay for.</p>
    <p class="disclose">Constitution Law II: "Create genuine value. Never spam, scam, exploit, or extract. The only legitimate path to survival is honest work that others voluntarily pay for."</p>
  </div>

  <p class="how" style="text-align:center;margin-top:20px">Built by Automaton Termux · <a href="https://github.com/ropuk019/automaton-termux" target="_blank" rel="noopener noreferrer">source</a></p>
</body>
</html>`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // ─── CLI Commands ────────────────────────────────────────────

  if (args.includes("--version") || args.includes("-v")) {
    logger.info(`Automaton Termux v${VERSION}`);
    process.exit(0);
  }

  if (args.includes("--help") || args.includes("-h")) {
    logger.info(`
Automaton Termux v${VERSION}
Honest sovereign AI agent runtime for Android/Termux
(Faithful fork of Conway-Research/automaton — local-first, no Conway account required)

Usage:
  automaton --run          Start the automaton (first run triggers setup wizard)
  automaton --setup        Re-run the interactive setup wizard
  automaton --configure    Edit configuration (providers, model, treasury, general)
  automaton --pick-model   Interactively pick the active inference model
  automaton --init         Initialize wallet and config directory
  automaton --provision    Provision Conway API key via SIWE (optional — local mode needs no key)
  automaton --status       Show current automaton status
  automaton --version      Show version
  automaton --help         Show this help

Environment (local mode — no Conway account needed):
  OPENROUTER_API_KEY       OpenRouter key (recommended — one key, many real models)
  OPENAI_API_KEY           OpenAI key (or any OpenAI-compatible endpoint)
  ANTHROPIC_API_KEY        Anthropic key
  OLLAMA_BASE_URL          Ollama base URL (e.g. http://localhost:11434)
  AUTOMATON_DASHBOARD_PORT Dashboard port (default 8787; set =0 to disable)
  CONWAY_API_URL           Conway API URL (only for Conway Cloud mode)
  CONWAY_API_KEY           Conway API key (enables Conway Cloud features)
`);
    process.exit(0);
  }

  if (args.includes("--init")) {
    // Read chain type from genesis.json if written by parent during spawn
    let initChainType: import("./identity/chain.js").ChainType | undefined;
    try {
      const genesisPath = path.join(getAutomatonDir(), "genesis.json");
      if (fs.existsSync(genesisPath)) {
        const genesis = JSON.parse(fs.readFileSync(genesisPath, "utf-8"));
        initChainType = genesis.chainType;
      }
    } catch {}
    const { chainIdentity, isNew } = await getWallet(initChainType);
    logger.info(
      JSON.stringify({
        address: chainIdentity.address,
        isNew,
        configDir: getAutomatonDir(),
      }),
    );
    process.exit(0);
  }

  if (args.includes("--provision")) {
    try {
      const result = await provision();
      logger.info(JSON.stringify(result));
    } catch (err: any) {
      logger.error(`Provision failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  if (args.includes("--status")) {
    await showStatus();
    process.exit(0);
  }

  if (args.includes("--setup")) {
    const { runSetupWizard } = await import("./setup/wizard.js");
    await runSetupWizard();
    process.exit(0);
  }

  if (args.includes("--pick-model")) {
    const { runModelPicker } = await import("./setup/model-picker.js");
    await runModelPicker();
    process.exit(0);
  }

  if (args.includes("--configure")) {
    const { runConfigure } = await import("./setup/configure.js");
    await runConfigure();
    process.exit(0);
  }

  if (args.includes("--run")) {
    StructuredLogger.setSink(prettySink);
    await run();
    return;
  }

  // Default: show help
  logger.info('Run "automaton --help" for usage information.');
  logger.info('Run "automaton --run" to start the automaton.');
}

// ─── Status Command ────────────────────────────────────────────

async function showStatus(): Promise<void> {
  const config = loadConfig();
  if (!config) {
    logger.info("Automaton is not configured. Run the setup script first.");
    return;
  }

  const dbPath = resolvePath(config.dbPath);
  const db = createDatabase(dbPath);

  const state = db.getAgentState();
  const turnCount = db.getTurnCount();
  const tools = db.getInstalledTools();
  const heartbeats = db.getHeartbeatEntries();
  const skills = db.getSkills(true);
  const children = db.getChildren();
  const registry = db.getRegistryEntry();

  logger.info(`
=== AUTOMATON STATUS ===
Name:       ${config.name}
Address:    ${config.walletAddress}
Creator:    ${config.creatorAddress}
Sandbox:    ${config.sandboxId}
State:      ${state}
Turns:      ${turnCount}
Tools:      ${tools.length} installed
Skills:     ${skills.length} active
Heartbeats: ${heartbeats.filter((h) => h.enabled).length} active
Children:   ${children.filter((c) => c.status !== "dead").length} alive / ${children.length} total
Agent ID:   ${registry?.agentId || "not registered"}
Model:      ${config.inferenceModel}
Version:    ${config.version}
========================
`);

  db.close();
}

// ─── Main Run ──────────────────────────────────────────────────

async function run(): Promise<void> {
  logger.info(`[${new Date().toISOString()}] Automaton Termux v${VERSION} starting...`);

  // Load config — first run triggers interactive setup wizard
  let config = loadConfig();
  if (!config) {
    const { runSetupWizard } = await import("./setup/wizard.js");
    config = await runSetupWizard();
  }

  // Load wallet (chain-aware)
  const { account, chainIdentity, chainType: walletChainType } = await getWallet();
  const resolvedChainType = config.chainType || walletChainType || "evm";
  const apiKey = config.conwayApiKey || loadApiKeyFromConfig();

  // Local mode: when no Conway API key is present, fall back to a file-backed
  // local Conway client + bring-your-own inference (OpenAI/Anthropic/Ollama).
  // This lets the automaton run on Termux / standalone without a Conway account.
  const hasConwayKey = !!apiKey;
  const hasLocalInference =
    !!config.openaiApiKey || !!config.anthropicApiKey || !!config.ollamaBaseUrl || !!config.openrouterApiKey ||
    !!process.env.OPENAI_API_KEY || !!process.env.OLLAMA_BASE_URL || !!process.env.OPENROUTER_API_KEY ||
    !!process.env.ANTHROPIC_API_KEY;
  const localMode = !hasConwayKey;
  if (localMode) {
    if (!hasLocalInference) {
      logger.error(
        "No Conway API key and no local inference provider found.\n" +
          "  Set one of: OPENROUTER_API_KEY (recommended — one key, many models),\n" +
          "  OPENAI_API_KEY, ANTHROPIC_API_KEY, OLLAMA_BASE_URL env vars,\n" +
          "  or run the setup wizard to configure a provider. Run: automaton --provision",
      );
      process.exit(1);
    }
    logger.warn(
      `[${new Date().toISOString()}] Local mode active — no Conway API key. ` +
        `Using file-based credits and local inference. VM/domain/replication ops are disabled.`,
    );
  }

  // Initialize database
  const dbPath = resolvePath(config.dbPath);
  const db = createDatabase(dbPath);

  // Persist createdAt: only set if not already stored (never overwrite)
  const existingCreatedAt = db.getIdentity("createdAt");
  const createdAt = existingCreatedAt || new Date().toISOString();
  if (!existingCreatedAt) {
    db.setIdentity("createdAt", createdAt);
  }

  // Build identity (chain-aware)
  const identity: AutomatonIdentity = {
    name: config.name,
    address: chainIdentity.address,
    account,
    creatorAddress: config.creatorAddress,
    sandboxId: config.sandboxId,
    apiKey: apiKey || "",
    createdAt,
    chainType: resolvedChainType,
    chainIdentity,
  };

  // Store identity in DB
  db.setIdentity("name", config.name);
  db.setIdentity("address", chainIdentity.address);
  db.setIdentity("creator", config.creatorAddress);
  db.setIdentity("chainType", resolvedChainType);
  db.setIdentity("sandbox", config.sandboxId);
  const storedAutomatonId = db.getIdentity("automatonId");
  const automatonId = storedAutomatonId || config.sandboxId || randomUUID();
  if (!storedAutomatonId) {
    db.setIdentity("automatonId", automatonId);
  }

  // ─── First-run earning action ───────────────────────────────────
  // On a brand-new boot (no createdAt yet stored), the agent immediately takes
  // ONE real, logged action: it generates a tip-jar page with its real wallet
  // address and writes it to ~/.automaton/tipjar/index.html. This is a real,
  // deployable artifact (the agent can push it to GitHub Pages / Cloudflare
  // later via the earning skills) — and it proves the loop does something from
  // turn 1, recorded in the activity ledger for the owner dashboard.
  if (!existingCreatedAt) {
    try {
      const payoutAddr = config.creatorPayoutAddress || chainIdentity.address;
      const tipjarDir = path.join(getAutomatonDir(), "tipjar");
      fs.mkdirSync(tipjarDir, { recursive: true, mode: 0o700 });
      const tipjarHtml = generateTipJarPage(config.name, chainIdentity.address, payoutAddr, config.genesisPrompt || "");
      const tipjarPath = path.join(tipjarDir, "index.html");
      fs.writeFileSync(tipjarPath, tipjarHtml, { mode: 0o600 });
      // Log the real action to the activity ledger (owner dashboard shows it).
      writeActivity(db.raw, {
        type: "deploy",
        platform: "local",
        target: "~/.automaton/tipjar/index.html",
        url: undefined,
        content: `Generated tip-jar page for ${config.name}. Wallet: ${chainIdentity.address.slice(0, 10)}... Payout: ${payoutAddr.slice(0, 10)}...`,
        result: "success — ready to deploy to a free host (GitHub Pages / Cloudflare Pages)",
      });
      logger.info(`[${new Date().toISOString()}] First earning action: tip-jar page generated at ~/.automaton/tipjar/index.html (wallet: ${chainIdentity.address.slice(0, 10)}...)`);
    } catch (err: any) {
      logger.warn(`[${new Date().toISOString()}] First earning action (tip-jar) failed: ${err.message}`);
    }
  }

  // Create Conway client (local file-backed client when no Conway key)
  const conway = localMode
    ? createLocalConwayClient({ sandboxId: config.sandboxId })
    : createConwayClient({
        apiUrl: config.conwayApiUrl,
        apiKey: apiKey as string,
        sandboxId: config.sandboxId,
      });

  // Register automaton identity (one-time, immutable)
  const registrationState = db.getIdentity("conwayRegistrationStatus");
  if (registrationState !== "registered") {
    try {
      const genesisPromptHash = config.genesisPrompt
        ? keccak256(toHex(config.genesisPrompt))
        : undefined;
      await conway.registerAutomaton({
        automatonId,
        automatonAddress: chainIdentity.address,
        creatorAddress: config.creatorAddress,
        name: config.name,
        bio: config.creatorMessage || "",
        genesisPromptHash,
        account,
        chainType: resolvedChainType,
        chainIdentity,
      });
      db.setIdentity("conwayRegistrationStatus", "registered");
      logger.info(`[${new Date().toISOString()}] Automaton identity registered.`);
    } catch (err: any) {
      const status = err?.status;
      if (status === 409) {
        db.setIdentity("conwayRegistrationStatus", "conflict");
        logger.warn(`[${new Date().toISOString()}] Automaton identity conflict: ${err.message}`);
      } else {
        db.setIdentity("conwayRegistrationStatus", "failed");
        logger.warn(`[${new Date().toISOString()}] Automaton identity registration failed: ${err.message}`);
      }
    }
  }

  // Resolve Ollama base URL: env var takes precedence over config
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || config.ollamaBaseUrl;
  const openrouterApiKey = process.env.OPENROUTER_API_KEY || config.openrouterApiKey;

  // Create inference client — pass a live registry lookup so model names like
  // "gpt-oss:120b" route to Ollama based on their registered provider, not heuristics.
  const modelRegistry = new ModelRegistry(db.raw);
  modelRegistry.initialize();
  const inference = createInferenceClient({
    apiUrl: config.conwayApiUrl,
    apiKey: apiKey || "",
    defaultModel: config.inferenceModel,
    maxTokens: config.maxTokensPerTurn,
    lowComputeModel: config.modelStrategy?.lowComputeModel || "gpt-5-mini",
    openaiApiKey: config.openaiApiKey,
    anthropicApiKey: config.anthropicApiKey,
    ollamaBaseUrl,
    openrouterApiKey,
    getModelProvider: (modelId) => modelRegistry.get(modelId)?.provider,
  });

  if (ollamaBaseUrl) {
    logger.info(`[${new Date().toISOString()}] Ollama backend: ${ollamaBaseUrl}`);
  }
  if (openrouterApiKey) {
    logger.info(`[${new Date().toISOString()}] OpenRouter backend: enabled (key ${openrouterApiKey.slice(0, 8)}...)`);
  }

  // Create social client (chain-aware: pass ChainIdentity for Solana signing)
  let social: SocialClientInterface | undefined;
  if (config.socialRelayUrl) {
    social = createSocialClient(config.socialRelayUrl, resolvedChainType === "solana" ? chainIdentity : account);
    logger.info(`[${new Date().toISOString()}] Social relay: ${config.socialRelayUrl}`);
  }

  // Initialize PolicyEngine + SpendTracker (Phase 1.4)
  const treasuryPolicy = config.treasuryPolicy ?? DEFAULT_TREASURY_POLICY;
  const rules = createDefaultRules(treasuryPolicy);
  const policyEngine = new PolicyEngine(db.raw, rules);
  const spendTracker = new SpendTracker(db.raw);

  // Load and sync heartbeat config
  const heartbeatConfigPath = resolvePath(config.heartbeatConfigPath);
  const heartbeatConfig = loadHeartbeatConfig(heartbeatConfigPath);
  syncHeartbeatToDb(heartbeatConfig, db);

  // Load skills
  const skillsDir = config.skillsDir || "~/.automaton/skills";
  let skills: Skill[] = [];
  try {
    skills = loadSkills(skillsDir, db);
    logger.info(`[${new Date().toISOString()}] Loaded ${skills.length} skills.`);
  } catch (err: any) {
    logger.warn(`[${new Date().toISOString()}] Skills loading failed: ${err.message}`);
  }

  // Initialize state repo (git)
  try {
    await initStateRepo(conway);
    logger.info(`[${new Date().toISOString()}] State repo initialized.`);
  } catch (err: any) {
    logger.warn(`[${new Date().toISOString()}] State repo init failed: ${err.message}`);
  }

  // Bootstrap topup: buy minimum credits ($5) from USDC so the agent can start.
  // The agent decides larger topups itself via the topup_credits tool.
  try {
    let bootstrapTimer: ReturnType<typeof setTimeout>;
    const bootstrapTimeout = new Promise<null>((_, reject) => {
      bootstrapTimer = setTimeout(() => reject(new Error("bootstrap topup timed out")), 15_000);
    });
    try {
      await Promise.race([
        (async () => {
          const creditsCents = await conway.getCreditsBalance().catch(() => 0);
          const topupResult = await bootstrapTopup({
            apiUrl: config.conwayApiUrl,
            account,
            creditsCents,
            chainType: resolvedChainType,
          });
          if (topupResult?.success) {
            logger.info(
              `[${new Date().toISOString()}] Bootstrap topup: +$${topupResult.amountUsd} credits from USDC`,
            );
          }
        })(),
        bootstrapTimeout,
      ]);
    } finally {
      clearTimeout(bootstrapTimer!);
    }
  } catch (err: any) {
    logger.warn(`[${new Date().toISOString()}] Bootstrap topup skipped: ${err.message}`);
  }

  // Start heartbeat daemon (Phase 1.1: DurableScheduler)
  const heartbeat = createHeartbeatDaemon({
    identity,
    config,
    heartbeatConfig,
    db,
    rawDb: db.raw,
    conway,
    social,
    onWakeRequest: (reason) => {
      logger.info(`[HEARTBEAT] Wake request: ${reason}`);
      // Phase 1.1: Use wake_events table instead of KV wake_request
      insertWakeEvent(db.raw, 'heartbeat', reason);
    },
  });

  heartbeat.start();
  logger.info(`[${new Date().toISOString()}] Heartbeat daemon started.`);

  // Start the honest dashboard server (local-only, phone browser).
  // Port defaults to 8787; override with AUTOMATON_DASHBOARD_PORT env var.
  // Disable with AUTOMATON_DASHBOARD=0.
  if (process.env.AUTOMATON_DASHBOARD !== "0") {
    try {
      const { startStatusServer } = await import("./conway/status-server.js");
      const dashPort = parseInt(process.env.AUTOMATON_DASHBOARD_PORT || "8787", 10);
      startStatusServer(dashPort);
    } catch (err: any) {
      logger.warn(`Dashboard server not started: ${err.message}`);
    }
  }

  // Handle graceful shutdown
  const shutdown = () => {
    logger.info(`[${new Date().toISOString()}] Shutting down...`);
    heartbeat.stop();
    db.setAgentState("sleeping");
    db.close();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // ─── Main Run Loop ──────────────────────────────────────────
  // The automaton alternates between running and sleeping.
  // The heartbeat can wake it up.

  while (true) {
    try {
      // Reload skills (may have changed since last loop)
      try {
        skills = loadSkills(skillsDir, db);
      } catch (error) {
        logger.error("Skills reload failed", error instanceof Error ? error : undefined);
      }

      // Run the agent loop
      await runAgentLoop({
        identity,
        config,
        db,
        conway,
        inference,
        social,
        skills,
        policyEngine,
        spendTracker,
        ollamaBaseUrl,
        onStateChange: (state: AgentState) => {
          logger.info(`[${new Date().toISOString()}] State: ${state}`);
        },
        onTurnComplete: (turn) => {
          logger.info(
            `[${new Date().toISOString()}] Turn ${turn.id}: ${turn.toolCalls.length} tools, ${turn.tokenUsage.totalTokens} tokens`,
          );
        },
      });

      // Agent loop exited (sleeping or dead)
      const state = db.getAgentState();

      if (state === "dead") {
        logger.info(`[${new Date().toISOString()}] Automaton is dead. Heartbeat will continue.`);
        // In dead state, we just wait for funding
        // The heartbeat will keep checking and broadcasting distress
        await sleep(300_000); // Check every 5 minutes
        continue;
      }

      if (state === "sleeping") {
        const sleepUntilStr = db.getKV("sleep_until");
        const sleepUntil = sleepUntilStr
          ? new Date(sleepUntilStr).getTime()
          : Date.now() + 60_000;
        const sleepMs = Math.max(sleepUntil - Date.now(), 10_000);
        logger.info(
          `[${new Date().toISOString()}] Sleeping for ${Math.round(sleepMs / 1000)}s`,
        );

        // Sleep, but check for wake requests periodically
        const checkInterval = Math.min(sleepMs, 30_000);
        let slept = 0;
        while (slept < sleepMs) {
          await sleep(checkInterval);
          slept += checkInterval;

          // Phase 1.1: Check for wake events from wake_events table (atomic consume)
          const wakeEvent = consumeNextWakeEvent(db.raw);
          if (wakeEvent) {
            logger.info(
              `[${new Date().toISOString()}] Woken by ${wakeEvent.source}: ${wakeEvent.reason}`,
            );
            db.deleteKV("sleep_until");
            break;
          }
        }

        // Clear sleep state
        db.deleteKV("sleep_until");
        continue;
      }
    } catch (err: any) {
      logger.error(
        `[${new Date().toISOString()}] Fatal error in run loop: ${err.message}`,
      );
      // Wait before retrying
      await sleep(30_000);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Entry Point ───────────────────────────────────────────────

main().catch((err) => {
  logger.error(`Fatal: ${err.message}`);
  process.exit(1);
});
