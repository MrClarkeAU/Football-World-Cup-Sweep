/**
 * ============================================================================
 *  update_scores.js — fetch World Cup data, score the sweep, write JSON
 * ============================================================================
 *  Data source: football-data.org v4 (free tier covers the World Cup).
 *  Pulls the WC match list, matches it against our participant allocations
 *  (scripts/config.js), applies our custom scoring, and overwrites
 *  data/sweep_standings.json.
 *
 *  Auth: reads the token from process.env.FOOTBALL_DATA_API_KEY (never
 *  hardcode). Header used: X-Auth-Token (as required by football-data.org).
 *
 *  Run locally without a token to (re)generate a clean zeroed seed file:
 *      node scripts/update_scores.js
 *  Run with a token to pull live data:
 *      FOOTBALL_DATA_API_KEY=xxxx node scripts/update_scores.js
 *
 *  Note on the free tier: scores are slightly delayed and individual goal
 *  scorers aren't provided, so the results feed shows scorelines without
 *  scorer names. Everything else (standings/eliminations/points) is full.
 * ============================================================================
 */

const fs = require("fs");
const path = require("path");
const {
  TOURNAMENT,
  SCORING,
  PARTICIPANTS,
  PARTICIPANT_TAGLINES,
  R32_FIXTURES,
  canonicalTeamName,
} = require("./config");

const API_BASE = "https://api.football-data.org/v4";
const API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const OUTPUT_PATH = path.join(__dirname, "..", "data", "sweep_standings.json");

// Reverse lookup: canonical team name -> participant name.
const TEAM_OWNER = {};
for (const [player, teams] of Object.entries(PARTICIPANTS)) {
  for (const team of teams) TEAM_OWNER[team.toLowerCase()] = player;
}

const STAGE_LABEL = {
  group: "Group Stage",
  r32: "Round of 32",
  r16: "Round of 16",
  qf: "Quarter-Final",
  sf: "Semi-Final",
  third: "3rd-Place Play-off",
  final: "Final",
  winner: "Champions",
  eliminated: "Eliminated",
};
// Order used to decide "furthest stage reached" (third counts as sf-level).
const STAGE_ORDER = ["group", "r32", "r16", "qf", "sf", "final", "winner"];

// ---------------------------------------------------------------------------
// Fetch with automatic retry/backoff so a transient network blip or a 429/5xx
// from the API doesn't fail the whole run (a "fetch failed" self-heals).
async function apiGet(endpoint, attempt = 1) {
  const MAX_ATTEMPTS = 4;
  try {
    const res = await fetch(API_BASE + endpoint, {
      headers: { "X-Auth-Token": API_KEY },
    });
    if (res.status === 429 || res.status >= 500) {
      throw new Error(`transient ${res.status} ${res.statusText}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`API ${endpoint} failed: ${res.status} ${res.statusText} ${text}`);
    }
    return res.json();
  } catch (err) {
    const transient = /transient|fetch failed|network|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|UND_ERR/i.test(err.message);
    if (attempt < MAX_ATTEMPTS && transient) {
      const waitMs = 2000 * 2 ** (attempt - 1); // 2s, 4s, 8s
      console.warn(`  fetch attempt ${attempt} failed (${err.message}) — retrying in ${waitMs / 1000}s…`);
      await new Promise((r) => setTimeout(r, waitMs));
      return apiGet(endpoint, attempt + 1);
    }
    throw err;
  }
}

// Map a football-data.org stage string to one of our stage keys.
function mapStage(stage = "") {
  const s = stage.toUpperCase();
  if (s.includes("GROUP")) return "group";
  if (s.includes("32")) return "r32";
  if (s.includes("16")) return "r16";
  if (s.includes("QUARTER")) return "qf";
  if (s.includes("SEMI")) return "sf";
  if (s.includes("3RD") || s.includes("THIRD")) return "third";
  if (s.includes("FINAL")) return "final";
  return "group";
}

function blankBoard() {
  const players = {};
  for (const [player, teams] of Object.entries(PARTICIPANTS)) {
    players[player] = {
      name: player,
      tagline: PARTICIPANT_TAGLINES[player] || "",
      totalPoints: 0,
      teams: teams.map((t) => ({
        name: t, played: 0, wins: 0, draws: 0, losses: 0,
        goalsFor: 0, stage: "group", eliminated: false, points: 0,
      })),
    };
  }
  return players;
}

function findTeam(players, canonicalName) {
  if (!canonicalName) return null;
  const owner = TEAM_OWNER[canonicalName.toLowerCase()];
  if (!owner) return null;
  return players[owner].teams.find(
    (t) => t.name.toLowerCase() === canonicalName.toLowerCase()
  );
}

function promote(team, stage) {
  if (STAGE_ORDER.indexOf(stage) > STAGE_ORDER.indexOf(team.stage)) team.stage = stage;
}

// Parse the /standings response into group tables + qualification flags.
// 2026 format: top 2 of each group + the 8 best 3rd-placed teams reach the R32.
function parseGroups(st) {
  const tables = (st.standings || []).filter(
    (s) => s.type === "TOTAL" && /GROUP/i.test(s.group || "")
  );
  const groups = tables.map((s) => ({
    name: (s.group || "").replace(/^GROUP[_ ]?/i, "Group ").replace(/_/g, " ").trim(),
    table: (s.table || []).map((r) => ({
      team: canonicalTeamName(r.team?.name),
      position: r.position,
      played: r.playedGames ?? 0,
      won: r.won ?? 0, draw: r.draw ?? 0, lost: r.lost ?? 0,
      gf: r.goalsFor ?? 0, ga: r.goalsAgainst ?? 0,
      gd: r.goalDifference ?? ((r.goalsFor ?? 0) - (r.goalsAgainst ?? 0)),
      points: r.points ?? 0,
      qual: null,
    })),
  }));
  // top 2 = auto-qualify; a group is "complete" once everyone has played 3.
  groups.forEach((g) => {
    g.complete = g.table.length > 0 && g.table.every((r) => r.played >= 3);
    g.table.forEach((r) => { r.qual = r.position <= 2 ? "auto" : null; });
  });
  // best 8 third-placed teams across all groups also qualify.
  const thirds = groups.map((g) => g.table.find((r) => r.position === 3)).filter(Boolean);
  thirds.sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf);
  thirds.slice(0, 8).forEach((r) => { r.qual = "third"; });
  return groups;
}

function scoreTeam(team) {
  let pts = 0;
  pts += team.wins * SCORING.groupWin;
  pts += team.draws * SCORING.groupDraw;
  pts += team.goalsFor * SCORING.goalBonus;
  const reached = {
    r32: SCORING.reachR32, r16: SCORING.reachR16, qf: SCORING.reachQF,
    sf: SCORING.reachSF, final: SCORING.reachFinal, winner: SCORING.winTournament,
  };
  if (reached[team.stage] != null) pts += reached[team.stage];
  team.points = pts;
  return pts;
}

// ---------------------------------------------------------------------------
// Find the API knockout match that shares a real team with a manual fixture
// (each team plays only one R32 tie, so a single shared team is unambiguous).
function findR32Match(matches, fx) {
  const hk = (fx.home || "").toLowerCase(), ak = (fx.away || "").toLowerCase();
  for (const m of matches) {
    if (mapStage(m.stage || "") !== "r32") continue;
    const h = (canonicalTeamName(m.homeTeam?.name) || "").toLowerCase();
    const a = (canonicalTeamName(m.awayTeam?.name) || "").toLowerCase();
    if ((h && (h === hk || h === ak)) || (a && (a === hk || a === ak))) return m;
  }
  return null;
}

// Build the R32 bracket from the confirmed draw, merging API status/score.
function buildR32Override(matches) {
  return R32_FIXTURES.map((fx) => {
    const m = findR32Match(matches, fx);
    let homeGoals = null, awayGoals = null, status = "TIMED", winner = null, date = null;
    if (m) {
      status = m.status;
      date = m.utcDate || null;
      if (m.status === "FINISHED") {
        const mh = (canonicalTeamName(m.homeTeam?.name) || "").toLowerCase();
        const sameOrient = mh === (fx.home || "").toLowerCase();
        const gh = m.score?.fullTime?.home ?? null, ga = m.score?.fullTime?.away ?? null;
        homeGoals = sameOrient ? gh : ga;
        awayGoals = sameOrient ? ga : gh;
        const w = m.score?.winner;
        if (w === "HOME_TEAM") winner = sameOrient ? "home" : "away";
        else if (w === "AWAY_TEAM") winner = sameOrient ? "away" : "home";
      }
    }
    return {
      stageKey: "r32", stage: "Round of 32",
      home: fx.home, away: fx.away,
      homeGoals, awayGoals, status, winner, date, day: fx.day,
    };
  });
}

async function main() {
  const players = blankBoard();
  const recentMatches = [];

  if (!API_KEY) {
    console.warn("⚠  No FOOTBALL_DATA_API_KEY set — writing a zeroed seed file so");
    console.warn("   the page renders. Set the token (locally or as a GitHub");
    console.warn("   secret) to pull live results.");
    return writeOutput(players, recentMatches, { live: false });
  }

  console.log(`Fetching ${TOURNAMENT.name} (competition ${TOURNAMENT.competitionCode})…`);
  const data = await apiGet(`/competitions/${TOURNAMENT.competitionCode}/matches`);
  const matches = data.matches || [];
  console.log(`  ${matches.length} matches returned.`);

  // Group tables + qualification (best-effort; the bracket/scoring don't depend on it).
  let groups = [];
  try {
    const st = await apiGet(`/competitions/${TOURNAMENT.competitionCode}/standings`);
    groups = parseGroups(st);
    console.log(`  ${groups.length} group tables parsed.`);
  } catch (e) {
    console.warn(`  standings unavailable (${e.message}) — skipping group view.`);
  }

  const finished = [];
  const upcoming = [];         // not-yet-played fixtures (for the schedule)
  const knockout = [];         // all knockout-stage matches (for the bracket)
  const unmatched = new Set(); // fixture teams that match NO participant (spelling check)
  for (const m of matches) {
    const stage = mapStage(m.stage || "");
    const homeName = canonicalTeamName(m.homeTeam?.name);
    const awayName = canonicalTeamName(m.awayTeam?.name);
    const home = findTeam(players, homeName);
    const away = findTeam(players, awayName);
    if (homeName && !home) unmatched.add(homeName);
    if (awayName && !away) unmatched.add(awayName);

    // Appearing in a match = at least reached that stage.
    const reachKey = stage === "third" ? "sf" : stage;
    if (home) promote(home, reachKey);
    if (away) promote(away, reachKey);

    // Collect knockout fixtures (Round of 32 → Final) for the bracket. The 3rd-
    // place play-off isn't on the road to the final, so it's excluded.
    if (stage !== "group" && stage !== "third") {
      const done = m.status === "FINISHED";
      knockout.push({
        stageKey: stage,
        stage: STAGE_LABEL[stage],
        home: homeName || "TBC",
        away: awayName || "TBC",
        homeGoals: done ? (m.score?.fullTime?.home ?? null) : null,
        awayGoals: done ? (m.score?.fullTime?.away ?? null) : null,
        status: m.status,
        winner: done ? (m.score?.winner === "HOME_TEAM" ? "home"
                      : m.score?.winner === "AWAY_TEAM" ? "away" : null) : null,
        date: m.utcDate,
      });
    }

    if (m.status !== "FINISHED") {
      if (["SCHEDULED", "TIMED", "IN_PLAY", "PAUSED"].includes(m.status)) {
        upcoming.push({
          home: homeName || "TBC",
          away: awayName || "TBC",
          stage: STAGE_LABEL[stage] || "",
          date: m.utcDate,
          live: m.status === "IN_PLAY" || m.status === "PAUSED",
        });
      }
      continue;
    }

    const hg = m.score?.fullTime?.home ?? 0;
    const ag = m.score?.fullTime?.away ?? 0;

    if (stage === "group") {
      if (home) {
        home.played++; home.goalsFor += hg;
        if (hg > ag) home.wins++; else if (hg === ag) home.draws++; else home.losses++;
      }
      if (away) {
        away.played++; away.goalsFor += ag;
        if (ag > hg) away.wins++; else if (ag === hg) away.draws++; else away.losses++;
      }
    } else {
      // Knockout: goals count for the bonus only (no W/D/L points).
      if (home) home.goalsFor += hg;
      if (away) away.goalsFor += ag;
    }

    finished.push({ m, stage, homeName, awayName, hg, ag });
  }

  // Fill the Round of 32 from the confirmed draw (the free API can lag on the
  // best-third-placed assignments). Live results are still merged from the API.
  if (R32_FIXTURES && R32_FIXTURES.length) {
    const r32 = buildR32Override(matches);
    const others = knockout.filter((k) => k.stageKey !== "r32");
    knockout.length = 0;
    knockout.push(...r32, ...others);
    // Everyone in the R32 has reached the knockouts → bank the +5 bonus now.
    r32.forEach((k) => {
      const ht = findTeam(players, k.home); if (ht) promote(ht, "r32");
      const at = findTeam(players, k.away); if (at) promote(at, "r32");
    });
  }

  // Champion = winner of the FINAL (not the 3rd-place play-off).
  for (const f of finished) {
    if (f.stage !== "final") continue;
    const w = f.m.score?.winner; // HOME_TEAM | AWAY_TEAM | DRAW
    const winnerName = w === "HOME_TEAM" ? f.homeName
                     : w === "AWAY_TEAM" ? f.awayName
                     : (f.hg > f.ag ? f.homeName : f.awayName);
    const champ = findTeam(players, winnerName);
    if (champ) promote(champ, "winner");
  }

  computeEliminations(players, finished);
  markGroupEliminations(players, groups);

  for (const player of Object.values(players)) {
    player.totalPoints = player.teams.reduce((sum, t) => sum + scoreTeam(t), 0);
  }

  const unmatchedList = [...unmatched].sort();
  if (unmatchedList.length) {
    console.warn(`⚠  ${unmatchedList.length} fixture team(s) matched NO participant ` +
                 `(possible spelling mismatch or not on the sheet):`);
    unmatchedList.forEach((n) => console.warn(`     • ${n}`));
    console.warn(`   If any of these IS one of our teams, add an alias in scripts/config.js.`);
  } else {
    console.log("✓ Every fixture team matched a participant — no spelling issues.");
  }

  buildRecentFeed(finished, recentMatches);
  const nextUp = upcoming
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 14);
  // Sort other rounds by date, then a stable sort by stage so the R32 keeps the
  // confirmed-draw order (its overridden fixtures may not all have dates yet).
  const STAGE_RANK = { r32: 0, r16: 1, qf: 2, sf: 3, final: 4 };
  const r32 = knockout.filter((k) => k.stageKey === "r32");
  const rest = knockout.filter((k) => k.stageKey !== "r32")
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  knockout.length = 0;
  knockout.push(...r32, ...rest);
  knockout.sort((a, b) => STAGE_RANK[a.stageKey] - STAGE_RANK[b.stageKey]);
  return writeOutput(players, recentMatches,
    { live: true, unmatched: unmatchedList, upcoming: nextUp, knockout, groups });
}

// Knockout loser is out; champion never is.
function computeEliminations(players, finished) {
  const losers = new Set();
  const winners = new Set();
  for (const f of finished) {
    if (f.stage === "group" || f.stage === "third") continue;
    const w = f.m.score?.winner;
    const homeWon = w === "HOME_TEAM" || (w == null && f.hg > f.ag);
    winners.add((homeWon ? f.homeName : f.awayName)?.toLowerCase());
    losers.add((homeWon ? f.awayName : f.homeName)?.toLowerCase());
  }
  for (const player of Object.values(players)) {
    for (const team of player.teams) {
      if (team.stage === "winner") { team.eliminated = false; continue; }
      const key = team.name.toLowerCase();
      if (losers.has(key) && !winners.has(key)) team.eliminated = true;
    }
  }
}

// Mark teams knocked out at the GROUP stage (so "teams left", the wall of
// shame and alive counts stay correct). Honest timing: a 4th-placed team is
// out once its group is final; a non-best-8 3rd only once every group is done.
function markGroupEliminations(players, groups) {
  if (!groups || !groups.length) return;
  const allComplete = groups.every((g) => g.complete);
  for (const g of groups) {
    for (const r of g.table) {
      const out = r.qual === null && (r.position === 4 ? g.complete : allComplete);
      if (!out) continue;
      const team = findTeam(players, r.team);
      if (team && team.stage !== "winner") team.eliminated = true;
    }
  }
}

function buildRecentFeed(finished, out) {
  const sorted = [...finished].sort(
    (a, b) => new Date(b.m.utcDate) - new Date(a.m.utcDate)
  );
  for (const f of sorted.slice(0, 16)) {
    out.push({
      home: f.homeName,
      away: f.awayName,
      homeGoals: f.hg,
      awayGoals: f.ag,
      stage: STAGE_LABEL[f.stage] || "",
      date: f.m.utcDate,
      scorers: [], // not available on the free tier
    });
  }
}

function writeOutput(playersObj, recentMatches, { live, unmatched = [], upcoming = [], knockout = [], groups = [] }) {
  // Remember the PREVIOUS run's standings so the page can show movers (↑/↓).
  const prev = {};
  try {
    const old = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8"));
    (old.participants || []).forEach((p) => { prev[p.name] = { rank: p.rank, points: p.totalPoints }; });
  } catch (e) { /* first run / no existing file */ }

  const participants = Object.values(playersObj).map((p) => {
    const allEliminated = p.teams.every((t) => t.eliminated) &&
                          !p.teams.some((t) => t.stage === "winner");
    return {
      name: p.name,
      tagline: p.tagline,
      totalPoints: p.totalPoints,
      allEliminated,
      teams: p.teams.map((t) => ({
        ...t,
        stageLabel: STAGE_LABEL[t.eliminated ? "eliminated" : t.stage],
      })),
    };
  });

  participants.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    const ag = a.teams.reduce((s, t) => s + t.goalsFor, 0);
    const bg = b.teams.reduce((s, t) => s + t.goalsFor, 0);
    return bg - ag;
  });
  participants.forEach((p, i) => {
    p.rank = i + 1;
    const pr = prev[p.name];
    p.prevRank = pr ? pr.rank : null;
    p.prevPoints = pr ? pr.points : null;
  });

  const payload = {
    tournament: TOURNAMENT.name,
    lastUpdated: new Date().toISOString(),
    live,
    source: "football-data.org",
    unmatchedTeams: unmatched,
    scoring: SCORING,
    participants,
    recentMatches,
    upcomingMatches: upcoming,
    knockout,
    groups,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2) + "\n");
  console.log(`✓ Wrote ${OUTPUT_PATH} (${live ? "LIVE" : "seed"} data).`);
}

main().catch((err) => {
  console.error("✗ update_scores failed:", err.message);
  process.exit(1);
});
