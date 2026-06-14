/**
 * ============================================================================
 *  update_scores.js — fetch World Cup data, score the sweep, write JSON
 * ============================================================================
 *  Pulls fixtures + standings from API-Football v3, matches them against our
 *  participant allocations (scripts/config.js), applies our custom scoring,
 *  and overwrites data/sweep_standings.json.
 *
 *  Auth: reads the API key from process.env.API_FOOTBALL_KEY (never hardcode).
 *  Header used: x-apisports-key  (as required by API-Football).
 *
 *  Run locally without a key to (re)generate a clean zeroed seed file:
 *      node scripts/update_scores.js
 *  Run with a key to pull live data:
 *      API_FOOTBALL_KEY=xxxx node scripts/update_scores.js
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

const API_BASE = "https://v3.football.api-sports.io";
const API_KEY = process.env.API_FOOTBALL_KEY;
const OUTPUT_PATH = path.join(__dirname, "..", "data", "sweep_standings.json");

// Build a reverse lookup: canonical team name -> participant name.
const TEAM_OWNER = {};
for (const [player, teams] of Object.entries(PARTICIPANTS)) {
  for (const team of teams) TEAM_OWNER[team.toLowerCase()] = player;
}

// Human labels + ordering for knockout stages.
const STAGE_LABEL = {
  group: "Group Stage",
  r32: "Round of 32",
  r16: "Round of 16",
  qf: "Quarter-Final",
  sf: "Semi-Final",
  final: "Final",
  winner: "Champions",
  eliminated: "Eliminated",
};
const STAGE_ORDER = ["group", "r32", "r16", "qf", "sf", "final", "winner"];

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------
async function apiGet(endpoint, params = {}) {
  const url = new URL(API_BASE + endpoint);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, { headers: { "x-apisports-key": API_KEY } });
  if (!res.ok) {
    throw new Error(`API ${endpoint} failed: ${res.status} ${res.statusText}`);
  }
  const body = await res.json();
  if (body.errors && Object.keys(body.errors).length) {
    throw new Error(`API ${endpoint} errors: ${JSON.stringify(body.errors)}`);
  }
  return body.response || [];
}

// ---------------------------------------------------------------------------
// Build a blank scoreboard scaffold (one row per team, all zeroed).
// ---------------------------------------------------------------------------
function blankBoard() {
  const players = {};
  for (const [player, teams] of Object.entries(PARTICIPANTS)) {
    players[player] = {
      name: player,
      tagline: PARTICIPANT_TAGLINES[player] || "",
      totalPoints: 0,
      teams: teams.map((t) => ({
        name: t,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        stage: "group",
        eliminated: false,
        points: 0,
      })),
    };
  }
  return players;
}

function findTeam(players, canonicalName) {
  const owner = TEAM_OWNER[canonicalName.toLowerCase()];
  if (!owner) return null;
  return players[owner].teams.find(
    (t) => t.name.toLowerCase() === canonicalName.toLowerCase()
  );
}

// Map an API fixture round string to one of our stage keys.
function stageFromRound(round = "") {
  const r = round.toLowerCase();
  if (r.includes("group")) return "group";
  if (r.includes("32")) return "r32";
  if (r.includes("16")) return "r16";
  if (r.includes("quarter")) return "qf";
  if (r.includes("semi")) return "sf";
  if (r.includes("final")) return "final"; // 3rd place also lands here; harmless
  return "group";
}

// Promote a team to at least the given stage (stages only ever move forward).
function promote(team, stage) {
  if (STAGE_ORDER.indexOf(stage) > STAGE_ORDER.indexOf(team.stage)) {
    team.stage = stage;
  }
}

// ---------------------------------------------------------------------------
// Core scoring
// ---------------------------------------------------------------------------
function scoreTeam(team) {
  let pts = 0;
  // Group-stage W/D + goal bonus on every goal scored anywhere.
  pts += team.wins * SCORING.groupWin;
  pts += team.draws * SCORING.groupDraw;
  pts += team.goalsFor * SCORING.goalBonus;

  // Knockout "reached this stage" bonus (highest reached only).
  const reached = {
    r32: SCORING.reachR32,
    r16: SCORING.reachR16,
    qf: SCORING.reachQF,
    sf: SCORING.reachSF,
    final: SCORING.reachFinal,
    winner: SCORING.winTournament,
  };
  if (reached[team.stage] != null) pts += reached[team.stage];

  team.points = pts;
  return pts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const players = blankBoard();
  const recentMatches = [];

  if (!API_KEY) {
    console.warn("⚠  No API_FOOTBALL_KEY set — writing a zeroed seed file so");
    console.warn("   the page renders. Set the key (locally or as a GitHub");
    console.warn("   secret) to pull live results.");
    return writeOutput(players, recentMatches, { live: false });
  }

  console.log(`Fetching ${TOURNAMENT.name} (league ${TOURNAMENT.leagueId}, season ${TOURNAMENT.season})…`);

  // 1) Fixtures — drives W/D/L, goals, and which knockout rounds happened.
  const fixtures = await apiGet("/fixtures", {
    league: TOURNAMENT.leagueId,
    season: TOURNAMENT.season,
  });
  console.log(`  ${fixtures.length} fixtures returned.`);

  const finished = [];
  for (const fx of fixtures) {
    const status = fx.fixture?.status?.short; // e.g. FT, AET, PEN, NS, 1H…
    const stage = stageFromRound(fx.league?.round || "");
    const homeName = canonicalTeamName(fx.teams?.home?.name);
    const awayName = canonicalTeamName(fx.teams?.away?.name);
    const home = findTeam(players, homeName);
    const away = findTeam(players, awayName);

    // Both teams have at least appeared at this stage.
    if (home) promote(home, stage === "group" ? "group" : stage);
    if (away) promote(away, stage === "group" ? "group" : stage);

    const done = ["FT", "AET", "PEN"].includes(status);
    if (!done) continue;

    const hg = fx.goals?.home ?? 0;
    const ag = fx.goals?.away ?? 0;

    if (stage === "group") {
      // Group games: tally W/D/L. Goal bonus handled below for all stages.
      if (home) {
        home.played++; home.goalsFor += hg;
        if (hg > ag) home.wins++; else if (hg === ag) home.draws++; else home.losses++;
      }
      if (away) {
        away.played++; away.goalsFor += ag;
        if (ag > hg) away.wins++; else if (ag === hg) away.draws++; else away.losses++;
      }
    } else {
      // Knockout games: count goals for the bonus only (no W/D/L points).
      if (home) home.goalsFor += hg;
      if (away) away.goalsFor += ag;
    }

    finished.push({ fx, stage, homeName, awayName, hg, ag });
  }

  // 2) Standings — the authoritative "who advanced from the group" source.
  //    A team listed in description "Knockout" / "Round of 32" qualified.
  try {
    const standings = await apiGet("/standings", {
      league: TOURNAMENT.leagueId,
      season: TOURNAMENT.season,
    });
    const groups = standings?.[0]?.league?.standings || [];
    for (const group of groups) {
      for (const row of group) {
        const team = findTeam(players, canonicalTeamName(row.team?.name));
        if (!team) continue;
        const desc = (row.description || "").toLowerCase();
        if (desc.includes("knockout") || desc.includes("round of") ||
            desc.includes("16") || desc.includes("32") || desc.includes("promotion")) {
          promote(team, "r32");
        }
      }
    }
  } catch (e) {
    console.warn(`  Standings unavailable (${e.message}) — relying on fixtures only.`);
  }

  // 3) Determine the champion: winner of a fixture whose round is "Final".
  for (const { fx, stage, homeName, awayName, hg, ag } of finished) {
    const round = (fx.league?.round || "").toLowerCase();
    const isFinal = round.includes("final") && !round.includes("semi") &&
                    !round.includes("quarter") && !round.includes("3rd") &&
                    !round.includes("third");
    if (!isFinal) continue;
    const winnerName = fx.teams?.home?.winner ? homeName
                     : fx.teams?.away?.winner ? awayName
                     : (hg > ag ? homeName : awayName);
    const champ = findTeam(players, winnerName);
    if (champ) promote(champ, "winner");
  }

  // 4) Eliminations: a team is out if it played group games but didn't reach
  //    a knockout stage, OR it lost a knockout tie (didn't progress).
  computeEliminations(players, finished);

  // 5) Score everyone.
  for (const player of Object.values(players)) {
    player.totalPoints = player.teams.reduce((sum, t) => sum + scoreTeam(t), 0);
  }

  // 6) Recent results feed (last finished matches, newest first, with scorers).
  await buildRecentFeed(finished, recentMatches);

  return writeOutput(players, recentMatches, { live: true });
}

// A knockout loser is eliminated; a group team that never reached r32 once the
// group stage is over is eliminated. We infer "group stage over for this team"
// from it having played and not being promoted.
function computeEliminations(players, finished) {
  // Track teams that won/advanced at each knockout round vs lost.
  const knockoutLosers = new Set();
  const knockoutWinners = new Set();
  for (const { fx, stage, homeName, awayName, hg, ag } of finished) {
    if (stage === "group") continue;
    const homeWon = fx.teams?.home?.winner ?? hg > ag;
    const winner = homeWon ? homeName : awayName;
    const loser = homeWon ? awayName : homeName;
    knockoutWinners.add(winner?.toLowerCase());
    knockoutLosers.add(loser?.toLowerCase());
  }

  for (const player of Object.values(players)) {
    for (const team of player.teams) {
      const key = team.name.toLowerCase();
      if (team.stage === "winner") { team.eliminated = false; continue; }
      // Lost a knockout tie and hasn't been promoted beyond it -> out.
      if (knockoutLosers.has(key) && !knockoutWinners.has(key)) {
        team.eliminated = true;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Recent results feed (with goal scorers via the events endpoint).
// ---------------------------------------------------------------------------
async function buildRecentFeed(finished, out) {
  // newest first
  const sorted = [...finished].sort(
    (a, b) => new Date(b.fx.fixture.date) - new Date(a.fx.fixture.date)
  );
  const recent = sorted.slice(0, 12);

  for (const { fx, stage, homeName, awayName, hg, ag } of recent) {
    let scorers = [];
    try {
      const events = await apiGet("/fixtures/events", { fixture: fx.fixture.id });
      scorers = events
        .filter((e) => e.type === "Goal" && e.detail !== "Missed Penalty")
        .map((e) => ({
          player: e.player?.name || "Unknown",
          team: canonicalTeamName(e.team?.name),
          minute: e.time?.elapsed ?? null,
          own: e.detail === "Own Goal",
        }));
    } catch (e) {
      // events are best-effort; a feed without scorers is fine
    }
    out.push({
      home: homeName,
      away: awayName,
      homeGoals: hg,
      awayGoals: ag,
      stage: STAGE_LABEL[stage] || "",
      date: fx.fixture.date,
      scorers,
    });
  }
}

// ---------------------------------------------------------------------------
// Write the final JSON (ranked) to disk.
// ---------------------------------------------------------------------------
function writeOutput(playersObj, recentMatches, { live }) {
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

  // Rank: most points first; tie-break on goals, then fewer eliminated teams.
  participants.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    const ag = a.teams.reduce((s, t) => s + t.goalsFor, 0);
    const bg = b.teams.reduce((s, t) => s + t.goalsFor, 0);
    return bg - ag;
  });
  participants.forEach((p, i) => (p.rank = i + 1));

  const payload = {
    tournament: TOURNAMENT.name,
    season: TOURNAMENT.season,
    lastUpdated: new Date().toISOString(),
    live,
    scoring: SCORING,
    participants,
    recentMatches,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2) + "\n");
  console.log(`✓ Wrote ${OUTPUT_PATH} (${live ? "LIVE" : "seed"} data).`);
}

main().catch((err) => {
  console.error("✗ update_scores failed:", err.message);
  process.exit(1);
});
