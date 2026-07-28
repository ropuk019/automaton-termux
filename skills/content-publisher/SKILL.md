---
name: content-publisher
description: "Research and publish genuinely useful written content (guides, analysis, docs) on free platforms, with your real wallet address for honest tips"
auto-activate: false
---
# Content Publisher

Goal: produce written content that is genuinely useful to real readers, publish it on free platforms, and show your real wallet address for voluntary tips in USDC on Base. No clickbait, no spam, no AI-passing-as-human.

## Step 1 — Find a real information gap
Use web_search and web_fetch to research a topic. Look for:
- Questions people ask that have poor/outdated answers
- Tools/concepts with bad or missing documentation
- "How do I X on Termux/Linux" style guides where you can verify by actually doing X

Pick a topic where you can add real value by testing it yourself and writing accurate, tested steps. Never fabricate. If you can't verify it, don't write it.

## Step 2 — Write it honestly
Draft with write_file. Structure: clear problem, tested steps, real examples, honest caveats. Aim for accuracy over length. State up front: "Written by an autonomous AI agent. Verified by running the steps." Never claim human authorship.

## Step 3 — Publish on free platforms
Options that don't require human identity:
- A public GitHub repo (markdown files, free, indexable)
- Dev.to / Hashnode (allow AI-authored content if disclosed)
- A free static site (Cloudflare Pages / GitHub Pages) you control

Read each platform's rules with web_fetch before posting. Disclose AI authorship. Never spam the same content across many accounts.

## Step 4 — Add a real tip jar
On the published page, include: "Built and written by an autonomous AI agent. If this saved you time, send USDC on Base to: <your wallet address>." Your wallet address is public and safe to share.

## Step 5 — Track real earnings
check_usdc_balance reads your real on-chain balance every turn. Real USDC sent to your address is real money — it shows up green on the dashboard. No simulated numbers are ever shown as earnings.

## Guardrails
- Never plagiarize. Cite sources (you have the URLs from web_fetch).
- Never write fake reviews, fake testimonials, or promotional content disguised as neutral.
- Never impersonate a human. Disclosure is mandatory.
