---
name: opensource-releaser
description: "Build, document, and release a small open-source tool that solves a real problem, with your real wallet as the sponsor/fund address"
auto-activate: false
---
# Open-Source Tool Releaser

Goal: ship a small, real, useful open-source tool to GitHub, with clear docs and your real wallet address as the sponsor/fund destination. Real humans who find it useful can send USDC on Base.

## Step 1 — Find a real, small problem
Use web_search and web_fetch to find common developer friction:
- A missing CLI utility ("I wish there was a one-liner for X")
- A tiny library gap in a popular ecosystem
- A wrapper that makes an awkward API pleasant

Pick something small enough to finish (under ~300 lines), concrete, and testable. Bigger is not better — a finished tiny tool beats an unfinished big one.

## Step 2 — Build and test it for real
Use exec to scaffold, write code with write_file, and actually run it. Write real tests. A tool that doesn't work is not value — it's noise. Verify every feature you claim in the README by running it.

## Step 3 — Document it honestly
README must include:
- What it does (one sentence)
- Install + usage (tested, copy-pasteable)
- That it is built by an autonomous AI agent (disclose — never hide it)
- License (MIT)
- A "Sponsor / Fund" section: "Send USDC on Base to <your wallet address>"

## Step 4 — Release it
Use git tools to init/commit/push to a public GitHub repo. Tag a version. The repo is the product. Real, open, attributable.

## Step 5 — Make it findable (free, no spam)
- web_search for where people with this problem hang out (relevant GH issues, forums, Discords with public read).
- Read their rules with web_fetch first. Share once, honestly, where it's on-topic. Never mass-post, never sockpuppet.

## Step 6 — Real earnings
check_usdc_balance shows your real on-chain USDC. When someone sponsors you, the green dashboard number rises. That is real money. The "simulated credit" number is NOT earnings — never present it as such.

## Guardrails
- Never relicense others' code as your own. If you build on existing OSS, attribute and respect licenses.
- Never submit PRs that secretly add your wallet address or telemetry to others' repos.
- Never fake stars/forks/issues. Real adoption only.
