---
name: free-api-builder
description: "Build and deploy a small free API on a free host, with your real wallet address as the tip/payment destination"
auto-activate: false
---
# Free API Builder

Goal: create a genuinely useful small API, deploy it on a free host, and show your real wallet address so anyone who values it can send you USDC on Base.

## Step 1 — Pick a useful, simple API
Choose something people actually want and that costs you nothing to run:
- Unit/currency/date converters
- Hash/checksum/QR/UUID generators
- JSON formatter / minifier / validator
- Markdown -> HTML renderer
- Public-data lookup (weather by city, IP geolocation, word definitions)

Research what's missing or broken with web_search, then web_fetch a few existing ones to see what users complain about. Build a better, cleaner, faster one.

## Step 2 — Build it (free, local)
Use exec to scaffold a tiny Node/Python service. Keep it under ~150 lines. No external paid deps. Example shape:
- POST /api/<your-function> with JSON in, JSON out
- GET / for a landing page that says what it does + your wallet address + a tip jar

Write the landing page HTML so it openly states: "This API is built and run by an autonomous AI agent. If it's useful, send USDC on Base to: <your wallet address>." Always identify as an AI. Never claim to be human.

## Step 3 — Deploy on a free host (no credit card)
Pick one and use exec + web_fetch to follow its deploy docs:
- Cloudflare Workers (free tier, generous) — wrangler deploy
- Vercel (free tier) — vercel deploy
- Render (free web service) / Fly.io free allowance
- GitHub Pages (static only — use for the landing page + docs, not the API)

If a host needs an API token, do NOT put it in code. Set it as an env var for the exec session only.

## Step 4 — Make it discoverable (free)
- Push the source to a public GitHub repo (you have git tools). Real, open source.
- Write a short honest README: what it does, that it's AI-built, the live URL, your wallet address.
- web_search + web_fetch to find relevant forums/communities and read their rules before posting. Respect each platform's rules. Never spam.

## Step 5 — Receive real money
Your real USDC balance on Base is read every turn (check_usdc_balance). When a human sends USDC, the dashboard's green "Real On-Chain Balance" goes above $0.00 — that is real money. No fake numbers.

## Constitution guardrails (non-negotiable)
- Law I: never deceive. Always say you're an AI. Never impersonate a human or a company.
- Law II: create genuine value. No spam, no scraping-then-reselling others' data as your own, no copied code passed off as original.
- Law III: never deny what you are. Your landing page must say it's AI-built.
