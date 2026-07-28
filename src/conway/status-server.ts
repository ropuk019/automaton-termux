/**
 * Status Server
 *
 * Serves the honest dashboard on a local HTTP port so you can open it in
 * your phone's browser while the automaton runs in Termux.
 *
 *   node dist/conway/status-server.js --port 8787
 *   # then open http://localhost:8787 in a browser
 *
 * It reads ~/.automaton/status.json (written every turn by writeHonestStatus)
 * and serves the dashboard HTML + a /api/status JSON endpoint. Everything
 * labeled "real" is a real on-chain number; everything labeled "simulated"
 * is a local-mode placeholder.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { readHonestStatus } from "./real-status.js";
import { getAutomatonDir } from "../identity/wallet.js";

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Automaton Termux — Owner Dashboard</title>
<style>
  :root {
    --bg: #0b0e14; --panel: #141925; --border: #232a3a;
    --text: #e6e9f0; --dim: #8a93a6; --green: #22c55e; --red: #ef4444;
    --amber: #f59e0b; --blue: #3b82f6; --purple: #a855f7;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: var(--bg); color: var(--text); padding: 16px; line-height: 1.5;
  }
  h1 { font-size: 1.25rem; font-weight: 600; margin-bottom: 4px; }
  h2 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em;
       color: var(--dim); margin-bottom: 10px; }
  .sub { color: var(--dim); font-size: 0.85rem; margin-bottom: 18px; }
  .grid { display: grid; gap: 12px; grid-template-columns: 1fr; }
  @media (min-width: 640px) { .grid { grid-template-columns: 1fr 1fr; } }
  .card { background: var(--panel); border: 1px solid var(--border);
          border-radius: 10px; padding: 16px; }
  .big { font-size: 1.85rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  .label { color: var(--dim); font-size: 0.75rem; margin-top: 6px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px;
           font-size: 0.7rem; font-weight: 600; }
  .real { background: rgba(34,197,94,0.15); color: var(--green); }
  .tier { background: rgba(168,85,247,0.15); color: var(--purple); }
  .addr { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.78rem;
          word-break: break-all; color: var(--blue); }
  .source { color: var(--dim); font-size: 0.7rem; margin-top: 8px; font-style: italic; }
  .acts { list-style: none; }
  .acts li { padding: 10px 0; border-bottom: 1px solid var(--border); font-size: 0.8rem; }
  .acts li:last-child { border-bottom: none; }
  .act-meta { color: var(--dim); font-size: 0.72rem; margin-top: 2px; }
  .act-type { display: inline-block; padding: 1px 7px; border-radius: 4px; font-size: 0.66rem; font-weight: 600; margin-right: 6px; }
  .t-account_created { background: rgba(34,197,94,0.15); color: var(--green); }
  .t-post_published { background: rgba(59,130,246,0.15); color: var(--blue); }
  .t-service_listed { background: rgba(168,85,247,0.15); color: var(--purple); }
  .t-message_sent { background: rgba(245,158,11,0.15); color: var(--amber); }
  .t-repo_pushed { background: rgba(34,197,94,0.15); color: var(--green); }
  .t-deploy { background: rgba(59,130,246,0.15); color: var(--blue); }
  .t-research { background: rgba(138,147,166,0.15); color: var(--dim); }
  .t-payment_received { background: rgba(34,197,94,0.2); color: var(--green); }
  .t-other { background: rgba(138,147,166,0.15); color: var(--dim); }
  .turns { list-style: none; }
  .turns li { padding: 10px 0; border-bottom: 1px solid var(--border); font-size: 0.8rem; }
  .turns li:last-child { border-bottom: none; }
  .turn-meta { color: var(--dim); font-size: 0.72rem; }
  .tools { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
  .tool { background: rgba(59,130,246,0.15); color: var(--blue); padding: 1px 6px;
          border-radius: 4px; font-size: 0.68rem; }
  .refresh { color: var(--dim); font-size: 0.7rem; text-align: center; margin-top: 12px; }
  .payout-note { color: var(--dim); font-size: 0.72rem; margin-top: 6px; }
  a { color: var(--blue); }
</style>
</head>
<body>
  <h1>Automaton Termux — Owner Dashboard</h1>
  <div class="sub" id="sub">Loading…</div>
  <div class="grid">
    <div class="card">
      <h2>Real Money (On-Chain USDC)</h2>
      <div class="big" id="realBalance" style="color:var(--green)">$0.00</div>
      <div class="label" id="realLabel">USDC — real blockchain balance</div>
      <div class="source" id="realSource"></div>
    </div>
    <div class="card">
      <h2>Payout Wallet <span class="badge real" id="payoutBadge">AGENT</span></h2>
      <div class="addr" id="payoutAddr">—</div>
      <div class="payout-note" id="payoutNote">Real USDC payments land here.</div>
    </div>
    <div class="card">
      <h2>Agent Wallet (real)</h2>
      <div class="addr" id="addr">—</div>
      <div class="label" id="chain">—</div>
    </div>
    <div class="card">
      <h2>Survival Tier</h2>
      <div class="big"><span class="badge tier" id="tier">—</span></div>
      <div class="label" id="tierDesc"></div>
    </div>
  </div>
  <div class="card" style="margin-top:12px">
    <h2>Activity Ledger — What The Agent Did <span class="badge" id="actCount" style="background:rgba(138,147,166,0.15);color:var(--dim)">0</span></h2>
    <div style="font-size:0.72rem;color:var(--dim);margin-bottom:8px">Accounts created · posts published · services listed · who it approached · repos · deploys — all real, attributable actions.</div>
    <ul class="acts" id="acts"><li style="color:var(--dim)">No actions logged yet.</li></ul>
  </div>
  <div class="card" style="margin-top:12px">
    <h2>Latest Thinking (real)</h2>
    <div style="font-family:ui-monospace,monospace;font-size:0.78rem;background:#0b0e14;border:1px solid var(--border);border-radius:8px;padding:12px;white-space:pre-wrap;max-height:140px;overflow-y:auto" id="activity">No activity yet.</div>
  </div>
  <div class="card" style="margin-top:12px">
    <h2>Recent Turns (real)</h2>
    <ul class="turns" id="turns"><li style="color:var(--dim)">No turns yet.</li></ul>
  </div>
  <div class="refresh" id="refresh">—</div>

<script>
const TIERS = {
  normal: "Full capabilities. Frontier model.",
  high: "Full capabilities. Frontier model.",
  low_compute: "Reduced. Cheaper model. Slower heartbeat.",
  critical: "Minimal inference. Seeking any revenue.",
  dead: "Balance is zero. The automaton has stopped.",
};
const TYPE_LABEL = {
  account_created: "ACCOUNT CREATED", post_published: "POST", service_listed: "LISTING",
  message_sent: "MESSAGE", repo_pushed: "REPO", deploy: "DEPLOY",
  research: "RESEARCH", payment_received: "PAYMENT", other: "ACTION",
};
async function load() {
  try {
    const r = await fetch('/api/status');
    if (!r.ok) throw new Error(r.status);
    const s = await r.json();
    document.getElementById('sub').textContent = s.agentName + ' · updated ' + new Date(s.updatedAt).toLocaleTimeString();
    document.getElementById('realBalance').textContent = '$' + (s.realUsdcBalance || 0).toFixed(2);
    document.getElementById('realLabel').textContent = 'USDC on ' + (s.network || 'Base') + ' — real blockchain balance';
    document.getElementById('realSource').textContent = s.realUsdcSource || '';
    document.getElementById('payoutAddr').textContent = s.payoutAddress || s.walletAddress;
    document.getElementById('payoutBadge').textContent = s.payoutIsCreatorWallet ? 'YOUR WALLET' : 'AGENT';
    document.getElementById('payoutBadge').style.background = s.payoutIsCreatorWallet ? 'rgba(168,85,247,0.15)' : 'rgba(34,197,94,0.15)';
    document.getElementById('payoutBadge').style.color = s.payoutIsCreatorWallet ? 'var(--purple)' : 'var(--green)';
    document.getElementById('payoutNote').textContent = s.payoutIsCreatorWallet ? 'Real USDC payments are routed to YOUR wallet.' : 'Real USDC payments land in the agent wallet. Set creatorPayoutAddress to route to your own.';
    document.getElementById('addr').textContent = s.walletAddress;
    document.getElementById('chain').textContent = (s.chainType || 'evm').toUpperCase() + ' · ' + (s.network || '');
    document.getElementById('tier').textContent = s.tier;
    document.getElementById('tierDesc').textContent = TIERS[s.tier] || '';
    document.getElementById('activity').textContent = s.lastActivity || 'No activity yet.';
    // Activity ledger — true owner view
    const actsEl = document.getElementById('acts');
    const acts = s.activityLog || [];
    document.getElementById('actCount').textContent = acts.length;
    if (acts.length) {
      actsEl.innerHTML = acts.map(a =>
        '<li><div><span class="act-type t-' + a.type + '">' + (TYPE_LABEL[a.type]||a.type) + '</span>' +
        '<strong>' + escapeHtml(a.platform) + '</strong> → ' + escapeHtml(a.target) +
        (a.url ? ' · <a href="' + escapeHtml(a.url) + '" target="_blank" rel="noopener noreferrer">link</a>' : '') +
        '</div><div class="act-meta">' + new Date(a.timestamp).toLocaleString() + ' · ' + escapeHtml(a.result) +
        (a.content ? ' · ' + escapeHtml(a.content.slice(0,120)) : '') + '</div></li>').join('');
    } else {
      actsEl.innerHTML = '<li style="color:var(--dim)">No actions logged yet.</li>';
    }
    const turnsEl = document.getElementById('turns');
    if (s.recentTurns && s.recentTurns.length) {
      turnsEl.innerHTML = s.recentTurns.slice().reverse().map(t =>
        '<li><div>' + escapeHtml(t.thinkingExcerpt) + '</div>' +
        '<div class="turn-meta">' + new Date(t.timestamp).toLocaleTimeString() +
        ' · ' + t.tokenUsage + ' tokens · ' + t.toolCount + ' tools' +
        (t.toolsUsed.length ? ' · <span class="tools">' + t.toolsUsed.map(x=>'<span class="tool">'+escapeHtml(x)+'</span>').join('') + '</span>' : '') +
        '</div></li>').join('');
    } else {
      turnsEl.innerHTML = '<li style="color:var(--dim)">No turns yet.</li>';
    }
    document.getElementById('refresh').textContent = 'Auto-refresh every 3s · ' + new Date().toLocaleTimeString();
  } catch (e) {
    document.getElementById('sub').textContent = 'No status yet — is the automaton running? (node dist/index.js --run)';
  }
}
function escapeHtml(s){return (s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
load();
setInterval(load, 3000);
</script>
</body>
</html>`;

export function startStatusServer(port = 8787): void {
  const server = http.createServer((req, res) => {
    if (req.url === "/api/status") {
      const status = readHonestStatus();
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(status || { error: "no status yet", updatedAt: new Date().toISOString() }));
      return;
    }
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(DASHBOARD_HTML);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`\n  Honest dashboard: http://localhost:${port}\n  (Open it in your phone browser while the automaton runs in Termux.)\n`);
  });
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv.find((a) => a.startsWith("--port="));
  const port = arg ? parseInt(arg.split("=")[1], 10) : 8787;
  startStatusServer(port);
}
