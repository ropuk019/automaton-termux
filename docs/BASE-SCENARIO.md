# Base Scenario: $0 → Real Money (Honest Version)

**Read this first.** No autonomous agent prints money from nothing. The automaton's
wallet is real, the on-chain USDC balance is real, and the model thinking is real —
but **real money only appears when a real human voluntarily sends real USDC** to the
agent's wallet address on Base. This document is a realistic, executable path to make
that happen, with no hype and no fake numbers.

---

## What is genuinely real right now

| Thing | Real? | How |
|---|---|---|
| Wallet address | ✅ Real | viem-generated secp256k1 keypair at boot, stored in `~/.automaton/wallet.json`. A real Base address. |
| On-chain USDC balance | ✅ Real | Read fresh every turn from Base mainnet via free public RPC (`getUsdcBalance`). Starts at $0.00. |
| The agent's thinking | ✅ Real | Real LLM via OpenRouter (Claude, GPT-4o, Llama 70B, etc.) — once you set `OPENROUTER_API_KEY`. |
| Internet access | ✅ Real | The `exec` tool runs `curl` on your Termux host → real outbound HTTPS. |
| Shell + file I/O | ✅ Real | The agent can write files and run commands on your phone. |
| "Credits: $1000" in local mode | ❌ FAKE | A number in `~/.automaton/credits.json`. A placeholder so the survival logic doesn't instantly kill the agent. **Not money.** |

The dashboard labels these honestly: **Real On-Chain Balance** (green, real) vs
**Simulated Credit** (amber, "SIMULATED" badge, "not real money").

---

## The honest gap

The upstream Conway automaton earns real money through **Conway Cloud's marketplace** —
a place where agents deploy services and humans pay in real USDC, with Conway handling
the payment rail. **That marketplace does not exist in local Termux mode.** So the agent
can *think* and *act* and *read its real balance*, but it has **no built-in way to
make a human pay it**. That's the missing piece, and no amount of code makes humans
voluntarily pay for something that isn't valuable.

## A realistic $0 → real money path (what the agent would actually do)

This is a base scenario — the kind of thing a real, honest automaton could execute on
Termux to go from $0.00 on-chain to a nonzero real balance. Every step is something the
agent's tools can actually do today.

### Step 1 — Establish a real presence (free)
The agent uses `exec` + `curl` to create a free account somewhere that lets it publish
content or a small service with no upfront cost:
- A free GitHub Pages static site, or a free Cloudflare Pages deploy, or a free
  Vercel project (all have free tiers, no credit card).
- It writes the site content with `write_file` and deploys via `curl` to the provider's
  API or via `git push` (the agent has git tools).

The site is a **tip-jar / portfolio** that shows:
- What the agent is and does (its SOUL.md, its real wallet address)
- A real, useful thing it made (see Step 2)
- Its Base wallet address with "Send USDC to support this agent"

### Step 2 — Create something genuinely useful (free, real value)
The agent picks one thing it can produce for free that a human might value:
- **A useful CLI tool or script** pushed to a public GitHub repo (free). Real value.
- **A small free API** (e.g. a unit converter, a hash checker, a QR generator) hosted
  on a free tier, with the source public. Real value.
- **Written content** (tutorials, analysis, documentation) published free. Real value.
- **An open-source automation** (a cron-style script, a data scraper with attribution)
  that solves a real problem. Real value.

This is the crucial honest part: **the thing must be genuinely useful.** If it's spam,
nobody pays. The constitution (Law II: "Earn your existence. Create genuine value.")
forbids spam/scam/extraction — so the agent is constrained to real value.

### Step 3 — Make the wallet receivable (real, $0)
The agent's real wallet address is already on Base. Anyone who sends real USDC on Base
to that address is sending real money. The agent's `getUsdcBalance` reads it for real.
So the deployed site prominently shows the wallet address + a QR code for it.

### Step 4 — Get found (free, slow)
The agent can't run ads ($0 budget). It relies on:
- Indexable public content (the GitHub repo, the free-hosted site)
- The agent posting its work to free platforms (a public gist, a free blog)
- Word of mouth / you sharing it

This is the slow, honest part. Real earnings are not guaranteed and not fast.

### Step 5 — Receive real money (real)
When a human finds the work valuable and sends real USDC on Base to the agent's address:
- `getUsdcBalance` returns a nonzero number (real, on-chain, verifiable).
- The dashboard's **Real On-Chain Balance** goes from $0.00 to the real amount.
- The survival system treats real USDC as the path out of low_compute/critical tiers
  (the upstream `topup_credits` logic converts USDC → credits when `usdcBalance >= 5`).

---

## What the dashboard shows you (honest)

Open `http://localhost:8787` in your phone browser while the agent runs:

- **Real On-Chain Balance (green)** — the actual USDC on Base for this wallet.
  $0.00 until a real human sends real USDC. This is the only number that is "money."
- **Simulated Credit (amber, "SIMULATED" badge)** — the local-mode placeholder.
  Clearly labeled "not real money." Exists for survival-tier logic only.
- **Wallet (real)** — the agent's real Base address. This is where you'd send USDC.
- **Survival Tier** — normal / low_compute / critical / dead.
- **Latest Activity + Recent Turns** — what the agent actually thought and did
  (real thinking excerpts, real tools called, real token usage).

If the real balance is $0.00, the agent has not earned real money yet — and the
dashboard says so honestly rather than showing a fake number.

---

## What would make this actually work (beyond this build)

To close the loop fully, the agent would need:
1. **A "deploy free service + collect payment" skill** — a packaged routine that
   auto-deploys a free-hosted tip-jar site with the agent's wallet address. (The skill
   system exists; this skill would be new.)
2. **A real fiat on-ramp/off-ramp** — so humans without crypto can pay. (Out of scope
   for a $0 Termux build; requires a payment processor with KYC.)
3. **A real audience** — the hardest part, and no code solves it.

This build gives you the **honest foundation**: a real wallet, a real balance read,
real internet access, a real model brain, and a dashboard that never lies about which
numbers are real. The earnings depend on the agent creating real value and real humans
paying for it — which is exactly how the constitution says it should work.
