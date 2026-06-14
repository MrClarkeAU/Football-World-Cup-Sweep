/* =========================================================================
   THE LADS' WORLD CUP SWEEP — frontend (v2)
   Reads data/sweep_standings.json and renders the dashboard. Vanilla JS.
   ========================================================================= */

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
const flag = (n) => FLAGS[n] || "🏳️";
const initials = (n) => n.trim().slice(0, 2).toUpperCase();
const $ = (s) => document.querySelector(s);

async function load() {
  try {
    const res = await fetch(`data/sweep_standings.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(res.status);
    render(await res.json());
  } catch (err) {
    $("#board").innerHTML =
      `<div class="empty">Couldn't load the standings yet.<br><small>${err}</small></div>`;
  }
}

function timeAgo(iso) {
  const d = (Date.now() - new Date(iso)) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} hr ago`;
  return `${Math.floor(d / 86400)} day(s) ago`;
}

function render(data) {
  const players = data.participants || [];
  const champion = findChampion(players);

  // ---- Status pill ----
  $("#status").innerHTML = data.lastUpdated
    ? `<span class="dot"></span> ${data.live ? "Live" : "Pre-tournament"} · updated ${timeAgo(data.lastUpdated)}`
    : `<span class="dot"></span> Awaiting kick-off`;

  renderPrize(players, champion);
  renderPodium(players);
  renderBoard(players, champion);
  renderSpoon(players, champion);
  renderFeed(data.recentMatches || []);
  renderScoring(data.scoring || {});

  $("#updated-foot").innerHTML = data.lastUpdated
    ? `Last synced ${timeAgo(data.lastUpdated)} · source: ${data.source || "live feed"}`
    : "";
}

function findChampion(players) {
  for (const p of players)
    for (const t of p.teams)
      if (t.stage === "winner") return { player: p, team: t };
  return null;
}

function aliveCount(p) { return p.teams.filter((t) => !t.eliminated).length; }

// ---- The objective / champion banner ----
function renderPrize(players, champion) {
  const el = $("#prize");
  if (champion) {
    el.innerHTML = `
      <div class="prize champion">
        <div class="trophy">🏆</div>
        <div class="eyebrow">Sweep Winner</div>
        <h3>🏆 ${champion.player.name} wins the sweep!</h3>
        <p><b>${champion.team.name}</b> are World Champions — the last team standing. Points were just for show. 🍻</p>
      </div>`;
    return;
  }
  const totalAlive = players.reduce((s, p) => s + aliveCount(p), 0);
  el.innerHTML = `
    <div class="prize">
      <div class="trophy">🏆</div>
      <div class="eyebrow">The Real Prize</div>
      <h3>Last team standing wins it</h3>
      <p>The points are just for the banter. <b>${totalAlive}</b> of 48 teams are still in it —
         whoever owns the nation that <b>wins the World Cup</b> takes the sweep.</p>
    </div>`;
}

// ---- Podium ----
function renderPodium(players) {
  const order = [1, 0, 2];                 // visual: 2nd, 1st, 3rd
  const places = { 0: "1st", 1: "2nd", 2: "3rd" };
  $("#podium").innerHTML = order.map((i) => {
    const p = players[i];
    if (!p) return `<div class="spot"></div>`;
    return `
      <div class="spot p${i + 1}">
        <div class="place">${places[i]}</div>
        <div class="avatar">${initials(p.name)}</div>
        <div class="pname">${p.name}</div>
        <div class="ppts num">${p.totalPoints}</div>
        <div class="plabel">pts</div>
      </div>`;
  }).join("");
}

// ---- Leaderboard ----
function renderBoard(players, champion) {
  $("#board").innerHTML = players.map((p, i) => rowHTML(p, i, players.length, champion)).join("");
  document.querySelectorAll(".row-head").forEach((el) =>
    el.addEventListener("click", () => el.parentElement.classList.toggle("open")));
}

function rowHTML(p, idx, total, champion) {
  const alive = aliveCount(p);
  const isChamp = champion && champion.player.name === p.name;
  const isLast = idx === total - 1 && !isChamp;

  let tags = "";
  if (isChamp) tags += ` <span class="tag champ">🏆 WINNER</span>`;
  if (p.allEliminated && !isChamp) tags += ` <span class="tag shame">KNOCKED OUT</span>`;
  if (isLast) tags += ` <span class="tag spoon">🥄 SPOON</span>`;

  const teams = p.teams.slice().sort((a, b) => b.points - a.points).map((t) => {
    const out = t.eliminated ? "out" : "";
    const champ = t.stage === "winner" ? "champ" : "";
    return `
      <div class="team ${out} ${champ}">
        <span class="flag">${flag(t.name)}</span>
        <span class="tname">${t.name}
          <span class="tstage">${t.stageLabel || ""}${t.goalsFor ? ` · ${t.goalsFor}⚽` : ""}</span>
        </span>
        <span class="tpts num">${t.points}</span>
      </div>`;
  }).join("");

  return `
    <div class="row ${idx === 0 ? "r1" : ""} ${p.allEliminated && !isChamp ? "dead" : ""}">
      <div class="row-head">
        <div class="rank num">${p.rank}</div>
        <div class="avatar-sm">${initials(p.name)}</div>
        <div class="who">
          <div class="name">${p.name}${tags}</div>
          <div class="alive ${p.allEliminated && !isChamp ? "dead" : ""}"><b>${alive}</b>/${p.teams.length} teams alive</div>
        </div>
        <div class="ptcol"><div class="n num">${p.totalPoints}</div><div class="l">pts</div></div>
        <div class="chev">▾</div>
      </div>
      <div class="teams">${teams}</div>
    </div>`;
}

// ---- Wooden spoon ----
function renderSpoon(players, champion) {
  const last = players[players.length - 1];
  if (!last || (champion && champion.player.name === last.name)) { $("#spoon").innerHTML = ""; return; }
  const alive = aliveCount(last);
  $("#spoon").innerHTML = `
    <div class="spoon">
      <div class="emoji">🥄</div>
      <div class="txt">
        <b>${last.name}</b> is holding the wooden spoon on <b class="num">${last.totalPoints}</b> pts.
        <small>${last.allEliminated
          ? "All teams wiped out. Grim. 💀"
          : `${alive} team${alive === 1 ? "" : "s"} left to dig them out.`}</small>
      </div>
    </div>`;
}

// ---- Results feed ----
function renderFeed(matches) {
  if (!matches.length) {
    $("#feed").innerHTML = `<div class="empty">No matches yet — this lights up the second the first ball's kicked. ⚽</div>`;
    return;
  }
  $("#feed").innerHTML = matches.map((m) => `
    <div class="match">
      <div class="top">
        <div class="side"><span class="flag">${flag(m.home)}</span><span class="tn">${m.home}</span></div>
        <div class="score num">${m.homeGoals} – ${m.awayGoals}</div>
        <div class="side away"><span class="tn">${m.away}</span><span class="flag">${flag(m.away)}</span></div>
      </div>
      <div class="meta"><span>${m.stage || ""}</span><span>${m.date ? new Date(m.date).toLocaleDateString() : ""}</span></div>
    </div>`).join("");
}

// ---- Scoring explainer ----
function renderScoring(s) {
  const items = [
    { l: "Group-stage win", v: `${s.groupWin ?? 3} pts`, c: "win" },
    { l: "Group-stage draw", v: `${s.groupDraw ?? 1} pt`, c: "" },
    { l: "Every goal scored", v: `+${s.goalBonus ?? 1}`, c: "" },
    { l: "Reach Round of 32", v: `+${s.reachR32 ?? 5}`, c: "" },
    { l: "Reach Round of 16", v: `+${s.reachR16 ?? 8}`, c: "" },
    { l: "Reach Quarter-Final", v: `+${s.reachQF ?? 12}`, c: "" },
    { l: "Reach Semi-Final", v: `+${s.reachSF ?? 16}`, c: "" },
    { l: "Reach the Final", v: `+${s.reachFinal ?? 18}`, c: "" },
    { l: "Win the World Cup", v: `+${s.winTournament ?? 20}`, c: "trophy" },
  ];
  $("#scoring-grid").innerHTML = items.map((i) =>
    `<div class="score-item ${i.c}"><span>${i.l}</span><span class="v num">${i.v}</span></div>`).join("");
}

load();
setInterval(load, 90 * 1000); // self-refresh every 90s while open
