/* =========================================================================
   THE LADS' WORLD CUP SWEEP — frontend
   Reads data/sweep_standings.json and renders the dashboard. Vanilla JS.
   ========================================================================= */

// Flag emojis (render great on phones, which is where the lads live).
const FLAGS = {
  "Germany": "🇩🇪", "Brazil": "🇧🇷", "Austria": "🇦🇹", "South Africa": "🇿🇦",
  "Belgium": "🇧🇪", "Cape Verde": "🇨🇻", "Japan": "🇯🇵", "Haiti": "🇭🇹",
  "South Korea": "🇰🇷", "Argentina": "🇦🇷", "DR Congo": "🇨🇩", "Czech Republic": "🇨🇿",
  "Scotland": "🏴󠁧󠁢󠁳󠁣󠁴󠁿", "Curacao": "🇨🇼", "Colombia": "🇨🇴", "Ghana": "🇬🇭",
  "Sweden": "🇸🇪", "France": "🇫🇷", "Turkey": "🇹🇷", "Qatar": "🇶🇦",
  "Paraguay": "🇵🇾", "Netherlands": "🇳🇱", "Tunisia": "🇹🇳", "New Zealand": "🇳🇿",
  "Uruguay": "🇺🇾", "Portugal": "🇵🇹", "Switzerland": "🇨🇭", "Canada": "🇨🇦",
  "Norway": "🇳🇴", "Algeria": "🇩🇿", "Ecuador": "🇪🇨", "Iraq": "🇮🇶",
  "Saudi Arabia": "🇸🇦", "England": "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "USA": "🇺🇸", "Mexico": "🇲🇽",
  "Australia": "🇦🇺", "Panama": "🇵🇦", "Croatia": "🇭🇷", "Senegal": "🇸🇳",
  "Cote d'Ivoire": "🇨🇮", "Spain": "🇪🇸", "Morocco": "🇲🇦", "Egypt": "🇪🇬",
  "Iran": "🇮🇷", "Uzbekistan": "🇺🇿", "Jordan": "🇯🇴", "Bosnia": "🇧🇦",
};
const flag = (name) => FLAGS[name] || "🏳️";

const $ = (sel) => document.querySelector(sel);

async function load() {
  try {
    // cache-bust so phones always pull the freshest commit from Pages
    const res = await fetch(`data/sweep_standings.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    render(data);
  } catch (err) {
    $("#board").innerHTML =
      `<div class="empty">Couldn't load the standings yet.<br><small>${err}</small></div>`;
  }
}

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return `${Math.floor(diff / 86400)} day(s) ago`;
}

function render(data) {
  const players = data.participants || [];

  // ---- Header timestamp ----
  $("#updated").innerHTML = data.lastUpdated
    ? `<span class="dot"></span> ${data.live ? "Live" : "Pre-tournament"} · updated ${timeAgo(data.lastUpdated)}`
    : `<span class="dot"></span> Awaiting kickoff`;

  // ---- Podium (top 3) ----
  const order = [1, 0, 2]; // visual: 2nd, 1st, 3rd
  const medals = ["🥇", "🥈", "🥉"];
  $("#podium").innerHTML = order
    .map((i) => {
      const p = players[i];
      if (!p) return `<div class="spot"></div>`;
      const cls = i === 0 ? "spot p1" : "spot";
      return `
        <div class="${cls}">
          <div class="medal">${medals[i]}</div>
          <div class="pname">${p.name}</div>
          <div class="ppts">${p.totalPoints}</div>
          <div class="plabel">points</div>
        </div>`;
    })
    .join("");

  // ---- Wooden spoon (last place) ----
  const last = players[players.length - 1];
  if (last) {
    const aliveCount = last.teams.filter((t) => !t.eliminated).length;
    $("#spoon").innerHTML = `
      <div class="spoon-banner">
        <div class="emoji">🥄</div>
        <div class="txt">
          <b>${last.name}</b> is propping up the table on <b>${last.totalPoints}</b> pts.
          <small>${last.allEliminated
            ? "Completely wiped out. Absolute disaster. 💀"
            : `${aliveCount} team${aliveCount === 1 ? "" : "s"} still clinging on.`}</small>
        </div>
      </div>`;
  }

  // ---- Full leaderboard ----
  $("#board").innerHTML = players.map((p, idx) => rowHTML(p, idx, players.length)).join("");
  document.querySelectorAll(".row-head").forEach((el) => {
    el.addEventListener("click", () => el.parentElement.classList.toggle("open"));
  });

  // ---- Latest results ----
  renderFeed(data.recentMatches || []);

  // ---- Rules footer ----
  renderRules(data.scoring || {});
}

function rowHTML(p, idx, total) {
  const aliveCount = p.teams.filter((t) => !t.eliminated).length;
  const rankCls = idx < 3 ? `r${idx + 1}` : "";
  const deadCls = p.allEliminated ? "dead" : "";
  const isLast = idx === total - 1;

  let tags = "";
  if (p.allEliminated) tags += ` <span class="shame-tag">WALL OF SHAME</span>`;
  if (isLast) tags += ` <span class="spoon-tag">🥄 SPOON</span>`;

  const teams = p.teams
    .slice()
    .sort((a, b) => b.points - a.points)
    .map((t) => {
      const outCls = t.eliminated ? "out" : "";
      const champCls = t.stage === "winner" ? "champ" : "";
      return `
        <div class="team ${outCls} ${champCls}">
          <span class="flag">${flag(t.name)}</span>
          <span class="tname">${t.name}
            <span class="tstage">${t.stageLabel || ""}${t.goalsFor ? ` · ${t.goalsFor}⚽` : ""}</span>
          </span>
          <span class="tpts">${t.points}</span>
        </div>`;
    })
    .join("");

  return `
    <div class="row ${rankCls} ${deadCls}">
      <div class="row-head">
        <div class="rank">${p.rank}</div>
        <div class="who">
          <div class="name">${p.name}${tags}</div>
          ${p.tagline ? `<div class="tag">${p.tagline}</div>` : ""}
          <div class="alive"><b>${aliveCount}</b>/${p.teams.length} teams alive</div>
        </div>
        <div class="pts"><div class="n">${p.totalPoints}</div><div class="l">pts</div></div>
        <div class="chev">▾</div>
      </div>
      <div class="teams">${teams}</div>
    </div>`;
}

function renderFeed(matches) {
  if (!matches.length) {
    $("#feed").innerHTML =
      `<div class="empty">No matches in the books yet — the page lights up the second the first goal goes in. ⚽</div>`;
    return;
  }
  $("#feed").innerHTML = matches
    .map((m) => {
      const scorers = (m.scorers || [])
        .map((s) => `<span class="g">${s.minute ? s.minute + "'" : ""} ${s.player}${s.own ? " (OG)" : ""} <small>${flag(s.team)}</small></span>`)
        .join(" · ");
      return `
        <div class="match">
          <div class="top">
            <div class="side home">
              <span class="flag">${flag(m.home)}</span>
              <span class="tn">${m.home}</span>
            </div>
            <div class="score">${m.homeGoals} – ${m.awayGoals}</div>
            <div class="side away">
              <span class="tn">${m.away}</span>
              <span class="flag">${flag(m.away)}</span>
            </div>
          </div>
          <div class="meta"><span>${m.stage || ""}</span><span>${m.date ? new Date(m.date).toLocaleDateString() : ""}</span></div>
          ${scorers ? `<div class="scorers">⚽ ${scorers}</div>` : ""}
        </div>`;
    })
    .join("");
}

function renderRules(s) {
  $("#rules").innerHTML = `
    <b>🏆 House Rules</b><br>
    Group win <b>${s.groupWin ?? 3}</b> · Group draw <b>${s.groupDraw ?? 1}</b> ·
    <b>+${s.goalBonus ?? 1}</b> per goal scored<br>
    Reach R32 <b>+${s.reachR32 ?? 5}</b> · R16 <b>+${s.reachR16 ?? 8}</b> ·
    QF <b>+${s.reachQF ?? 12}</b> · SF <b>+${s.reachSF ?? 16}</b> ·
    Final <b>+${s.reachFinal ?? 18}</b> · Win it all <b>+${s.winTournament ?? 20}</b>`;
}

load();
// refresh in the background every 5 minutes in case the lads leave it open
setInterval(load, 5 * 60 * 1000);
