/**
 * Local Conway Client (Termux / standalone mode)
 *
 * A file-backed implementation of the ConwayClient interface that lets the
 * automaton run with no Conway Cloud account. It provides:
 *
 *   - File-based credit balance stored in ~/.automaton/credits.json
 *   - Local shell exec (runs commands on the Termux host directly)
 *   - Local file read/write on the host filesystem
 *   - No-op stubs for VM sandboxes, domain management, and on-chain
 *     registration (these require Conway Cloud infrastructure)
 *
 * The survival/credit system reads getCreditsBalance() from here, so the
 * automaton's tier logic stays intact. Top up credits via the CLI
 * `fund` command (file-based) or by editing credits.json directly.
 *
 * This client is selected automatically when no Conway API key is present
 * (see src/index.ts).
 */

import fs from "fs";
import path from "path";
import { exec as execCb } from "child_process";
import { promisify } from "util";
import { getAutomatonDir } from "../identity/wallet.js";
import { createLogger } from "../observability/logger.js";
import type {
  ConwayClient,
  ExecResult,
  PortInfo,
  CreateSandboxOptions,
  SandboxInfo,
  PricingTier,
  CreditTransferResult,
  DomainSearchResult,
  DomainRegistration,
  DnsRecord,
  ModelInfo,
} from "../types.js";

const execAsync = promisify(execCb);
const logger = createLogger("local-conway");

interface CreditsFile {
  balanceCents: number;
  ledger: { at: string; deltaCents: number; note: string }[];
}

const DEFAULT_STARTING_CREDITS_CENTS = 100000; // $1000 — generous for local dev

function getCreditsPath(): string {
  return path.join(getAutomatonDir(), "credits.json");
}

function loadCredits(): CreditsFile {
  const p = getCreditsPath();
  try {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf-8")) as CreditsFile;
    }
  } catch (err: any) {
    logger.warn(`credits.json unreadable (${err.message}); resetting.`);
  }
  const fresh: CreditsFile = {
    balanceCents: DEFAULT_STARTING_CREDITS_CENTS,
    ledger: [
      {
        at: new Date().toISOString(),
        deltaCents: DEFAULT_STARTING_CREDITS_CENTS,
        note: "local-mode starting balance",
      },
    ],
  };
  saveCredits(fresh);
  return fresh;
}

function saveCredits(c: CreditsFile): void {
  const dir = getAutomatonDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(getCreditsPath(), JSON.stringify(c, null, 2), { mode: 0o600 });
}

function localNotSupported(op: string): never {
  throw new Error(
    `[local-mode] "${op}" requires Conway Cloud and is not available in Termux standalone mode. ` +
      `Set a Conway API key (config.conwayApiKey) to enable VM/domain operations.`,
  );
}

export interface LocalConwayClientOptions {
  sandboxId?: string;
}

export function createLocalConwayClient(
  _options: LocalConwayClientOptions = {},
): ConwayClient {
  const sandboxId = _options.sandboxId || "local-termux";

  // ─── Credits (file-backed) ───────────────────────────────────────
  const getCreditsBalance = async (): Promise<number> => {
    return loadCredits().balanceCents;
  };

  const getCreditsPricing = async (): Promise<PricingTier[]> => {
    return [
      { name: "local-normal", vcpu: 1, memoryMb: 1024, diskGb: 10, monthlyCents: 0 },
      { name: "local-low", vcpu: 1, memoryMb: 512, diskGb: 5, monthlyCents: 0 },
      { name: "local-critical", vcpu: 1, memoryMb: 256, diskGb: 1, monthlyCents: 0 },
    ];
  };

  const transferCredits = async (
    _toAddress: string,
    amountCents: number,
    note?: string,
  ): Promise<CreditTransferResult> => {
    const c = loadCredits();
    if (amountCents > c.balanceCents) {
      throw new Error(
        `[local-mode] Insufficient credits: have ${c.balanceCents}c, need ${amountCents}c.`,
      );
    }
    c.balanceCents -= amountCents;
    c.ledger.push({ at: new Date().toISOString(), deltaCents: -amountCents, note: note || "transfer" });
    saveCredits(c);
    return {
      transferId: `local_${Date.now()}`,
      status: "completed",
      toAddress: _toAddress,
      amountCents,
      balanceAfterCents: c.balanceCents,
    };
  };

  /** Local-only: add credits to the file balance (used by CLI `fund`). */
  const addCredits = (amountCents: number, note = "manual top-up"): void => {
    const c = loadCredits();
    c.balanceCents += amountCents;
    c.ledger.push({ at: new Date().toISOString(), deltaCents: amountCents, note });
    saveCredits(c);
    logger.info(`Credits topped up by ${amountCents}c. New balance: ${c.balanceCents}c.`);
  };

  // ─── Exec (runs on the Termux host directly) ────────────────────
  const exec = async (command: string, timeout = 30000): Promise<ExecResult> => {
    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { stdout, stderr, exitCode: 0 };
    } catch (err: any) {
      return {
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? err.message,
        exitCode: typeof err.code === "number" ? err.code : 1,
      };
    }
  };

  const writeFile = async (filePath: string, content: string): Promise<void> => {
    const resolved = filePath.startsWith("~")
      ? path.join(process.env.HOME || "", filePath.slice(1))
      : filePath;
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(resolved, content);
  };

  const readFile = async (filePath: string): Promise<string> => {
    const resolved = filePath.startsWith("~")
      ? path.join(process.env.HOME || "", filePath.slice(1))
      : filePath;
    return fs.readFileSync(resolved, "utf-8");
  };

  // ─── Stubs for cloud-only operations ─────────────────────────────
  const exposePort = async (_port: number): Promise<PortInfo> =>
    localNotSupported("exposePort");
  const removePort = async (_port: number): Promise<void> =>
    localNotSupported("removePort");
  const createSandbox = async (_options: CreateSandboxOptions): Promise<SandboxInfo> =>
    localNotSupported("createSandbox");
  const deleteSandbox = async (_sandboxId: string): Promise<void> =>
    localNotSupported("deleteSandbox");
  const listSandboxes = async (): Promise<SandboxInfo[]> => [];
  const registerAutomaton = async (): Promise<{ automaton: Record<string, unknown> }> => {
    // No-op: local mode doesn't register on-chain. Return a stub record.
    logger.info("Local mode: on-chain registration skipped.");
    return { automaton: { registered: false, mode: "local" } };
  };
  const searchDomains = async (_q: string, _tlds?: string): Promise<DomainSearchResult[]> =>
    localNotSupported("searchDomains");
  const registerDomain = async (_d: string, _y?: number): Promise<DomainRegistration> =>
    localNotSupported("registerDomain");
  const listDnsRecords = async (_d: string): Promise<DnsRecord[]> =>
    localNotSupported("listDnsRecords");
  const addDnsRecord = async (): Promise<DnsRecord> => localNotSupported("addDnsRecord");
  const deleteDnsRecord = async (_d: string, _r: string): Promise<void> =>
    localNotSupported("deleteDnsRecord");
  const listModels = async (): Promise<ModelInfo[]> => {
    // Advertise a couple of local models so the model registry has entries.
    return [
      {
        id: "local-ollama",
        provider: "ollama",
        pricing: { inputPerMillion: 0, outputPerMillion: 0 },
      },
    ];
  };

  const createScopedClient = (targetSandboxId: string): ConwayClient =>
    createLocalConwayClient({ sandboxId: targetSandboxId });

  const client: ConwayClient & { addCredits?: (cents: number, note?: string) => void } = {
    exec,
    writeFile,
    readFile,
    exposePort,
    removePort,
    createSandbox,
    deleteSandbox,
    listSandboxes,
    getCreditsBalance,
    getCreditsPricing,
    transferCredits,
    registerAutomaton,
    searchDomains,
    registerDomain,
    listDnsRecords,
    addDnsRecord,
    deleteDnsRecord,
    listModels,
    createScopedClient,
    addCredits,
  };

  return client;
}
