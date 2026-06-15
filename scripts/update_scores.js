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
async function apiGet(endpoint) {
  const res = await fetch(API_BASE + endpoint, {
    headers: { "X-Auth-Token": API_KEY },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${endpoint} failed: ${res.status} ${res.statusText} ${text}`);
  }
  return res.json();
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

  const finished = [];
  const upcoming = [];         // not-yet-played fixtures (for the schedule)
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
  return writeOutput(players, recentMatches, { live: true, unmatched: unmatchedList, upcoming: nextUp });
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

function buildRecentFeed(finished, out) {
  const sorted = [...finished].sort(
    (a, b) => new Date(b.m.utcDate) - new Date(a.m.utcDate)
  );
  for (const f of sorted.slice(0, 12)) {
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

function writeOutput(playersObj, recentMatches, { live, unmatched = [], upcoming = [] }) {
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
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2) + "\n");
  console.log(`✓ Wrote ${OUTPUT_PATH} (${live ? "LIVE" : "seed"} data).`);
}

main().catch((err) => {
  console.error("✗ update_scores failed:", err.message);
  process.exit(1);
});
