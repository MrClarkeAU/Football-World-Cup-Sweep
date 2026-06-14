/**
 * ============================================================================
 *  THE LADS' WORLD CUP SWEEP — CENTRAL CONFIG
 * ============================================================================
 *  Edit THIS file to change anything about the comp. The update script and
 *  the seed generator both read from here, so you only ever change it once.
 *
 *  - Tournament -> which competition we pull from football-data.org.
 *  - SCORING -> tweak to match your exact house rules.
 *  - PARTICIPANTS -> who drew which teams (taken from the pink sheet).
 *  - TEAM_ALIASES -> maps our spellings to whatever football-data.org uses.
 * ============================================================================
 */

// --- Which competition to pull -------------------------------------------
// Data source: football-data.org v4 (free tier covers the World Cup).
// "WC" is football-data.org's competition code for the FIFA World Cup.
const TOURNAMENT = {
  name: "FIFA World Cup 2026",
  competitionCode: "WC",
};

// --- Scoring rules --------------------------------------------------------
// TWEAK THESE to match your comp exactly. The 2026 World Cup has 48 teams
// across 12 groups, so the first knockout round is the Round of 32. Each
// knockout value below is the TOTAL bonus a team earns for REACHING that
// stage (they are not added on top of each other — a team in the QF gets the
// QF figure, not R32 + R16 + QF).
const SCORING = {
  groupWin: 3,        // points for a group-stage win
  groupDraw: 1,       // points for a group-stage draw
  goalBonus: 1,       // points per goal the team scores (all stages)

  // Knockout "reached this stage" bonuses
  reachR32: 5,        // qualified out of the group into the Round of 32
  reachR16: 8,        // reached the Round of 16
  reachQF: 12,        // reached the Quarter-Finals
  reachSF: 16,        // reached the Semi-Finals
  reachFinal: 18,     // reached the Final
  winTournament: 20,  // lifted the trophy
};

// --- Who drew what (straight off the sheet) -------------------------------
const PARTICIPANTS = {
  Clarkey: ["Germany", "Brazil", "Austria", "South Africa", "Belgium", "Cape Verde", "Japan", "Haiti"],
  Ben:     ["South Korea", "Argentina", "DR Congo", "Czech Republic", "Scotland", "Curacao", "Colombia", "Ghana"],
  Andre:   ["Sweden", "France", "Turkey", "Qatar", "Paraguay", "Netherlands", "Tunisia", "New Zealand"],
  Gonz:    ["Uruguay", "Portugal", "Switzerland", "Canada", "Norway", "Algeria", "Ecuador", "Iraq"],
  Mark:    ["Saudi Arabia", "England", "USA", "Mexico", "Australia", "Panama", "Croatia", "Senegal"],
  Ray:     ["Cote d'Ivoire", "Spain", "Morocco", "Egypt", "Iran", "Uzbekistan", "Jordan", "Bosnia"],
};

// Optional banter for each player, shown under their name on the leaderboard.
const PARTICIPANT_TAGLINES = {
  Clarkey: "Drew Germany & Brazil, reckons it's already won.",
  Ben:     "Argentina carry merchant.",
  Andre:   "France or bust.",
  Gonz:    "Portugal + a prayer.",
  Mark:    "England 'it's coming home' Mark.",
  Ray:     "Spain and the dark horses.",
};

// --- Name normalisation ---------------------------------------------------
// football-data.org doesn't always spell countries the way we do. Map THEIR name
// (lower-cased) to OUR name so results match the right participant's team.
const TEAM_ALIASES = {
  "korea republic": "South Korea",
  "south korea": "South Korea",
  "usa": "USA",
  "united states": "USA",
  "ivory coast": "Cote d'Ivoire",
  "cote d'ivoire": "Cote d'Ivoire",
  "côte d'ivoire": "Cote d'Ivoire",
  "czechia": "Czech Republic",
  "czech republic": "Czech Republic",
  "congo dr": "DR Congo",
  "dr congo": "DR Congo",
  "democratic republic of congo": "DR Congo",
  "cape verde islands": "Cape Verde",
  "cabo verde": "Cape Verde",
  "cape verde": "Cape Verde",
  "türkiye": "Turkey",
  "turkiye": "Turkey",
  "turkey": "Turkey",
  "bosnia and herzegovina": "Bosnia",
  "bosnia & herzegovina": "Bosnia",
  "bosnia": "Bosnia",
  "curacao": "Curacao",
  "curaçao": "Curacao",
};

// Strip accents so "Côte d'Ivoire" matches "Cote d'Ivoire", etc.
function stripAccents(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Resolve any incoming team name to our canonical spelling.
function canonicalTeamName(apiName) {
  if (!apiName) return null;
  const key = stripAccents(apiName.trim().toLowerCase());
  return TEAM_ALIASES[key] || apiName.trim();
}

module.exports = {
  TOURNAMENT,
  SCORING,
  PARTICIPANTS,
  PARTICIPANT_TAGLINES,
  TEAM_ALIASES,
  canonicalTeamName,
};
