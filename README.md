# 🏆 The Lads' World Cup Sweep

A self-updating **FIFA World Cup 2026 sweepstake tracker** — a slick, dark,
mobile-first dashboard hosted **free on GitHub Pages**. A GitHub Action quietly
pulls the latest results every couple of hours, re-scores everyone against our
house rules, and pushes the fresh numbers live. No server, no faffing.

> 6 lads · 48 nations · 1 wooden spoon. 🥄

---

## 🧱 How it works (the Jamstack bit)

GitHub Pages only serves static files, so there's no live backend. Instead:

```
 ┌─────────────────────┐   every 2 hrs    ┌──────────────────────────┐
 │  GitHub Action       │ ───────────────▶ │ scripts/update_scores.js │
 │  (.github/workflows) │                  │  • fetch football-data   │
 └─────────────────────┘                   │  • apply our scoring     │
          │ commits                        │  • write the JSON        │
          ▼                                └──────────────────────────┘
 data/sweep_standings.json  ───▶  index.html + js/app.js  ───▶  📱 the lads
        (the "database")            (reads the JSON, renders)
```

| File | Job |
|------|-----|
| `index.html`, `css/styles.css`, `js/app.js` | The dashboard. Reads `data/sweep_standings.json` and renders it. |
| `data/sweep_standings.json` | The "database" — the only thing that changes during the tournament. |
| `scripts/config.js` | **Edit this** to change players, teams, scoring, or aliases. |
| `scripts/update_scores.js` | Fetches results from football-data.org and rebuilds the JSON. |
| `.github/workflows/update.yml` | Runs the script on a schedule and commits the result. |

---

## 🎯 House rules (scoring)

Each team earns its owner:

- **Group win:** 3 pts · **Group draw:** 1 pt
- **+1 pt for every goal** the team scores (all stages)
- **Reaching a knockout stage** (total bonus for the furthest stage reached):
  - Round of 32: **+5** · Round of 16: **+8** · Quarter-Final: **+12**
  - Semi-Final: **+16** · Final: **+18** · **Win it all: +20**

> The 2026 World Cup has **48 teams / 12 groups**, so the first knockout round
> is the **Round of 32** (not 16). Change any number in
> [`scripts/config.js`](scripts/config.js) → `SCORING` to match your exact comp.

---

## 👥 The squads (from the pink sheet)

| Player | Teams |
|--------|-------|
| **Clarkey** | 🇩🇪 Germany · 🇧🇷 Brazil · 🇦🇹 Austria · 🇿🇦 South Africa · 🇧🇪 Belgium · 🇨🇻 Cape Verde · 🇯🇵 Japan · 🇭🇹 Haiti |
| **Ben** | 🇰🇷 South Korea · 🇦🇷 Argentina · 🇨🇩 DR Congo · 🇨🇿 Czech Republic · 🏴 Scotland · 🇨🇼 Curaçao · 🇨🇴 Colombia · 🇬🇭 Ghana |
| **Andre** | 🇸🇪 Sweden · 🇫🇷 France · 🇹🇷 Turkey · 🇶🇦 Qatar · 🇵🇾 Paraguay · 🇳🇱 Netherlands · 🇹🇳 Tunisia · 🇳🇿 New Zealand |
| **Gonz** | 🇺🇾 Uruguay · 🇵🇹 Portugal · 🇨🇭 Switzerland · 🇨🇦 Canada · 🇳🇴 Norway · 🇩🇿 Algeria · 🇪🇨 Ecuador · 🇮🇶 Iraq |
| **Mark** | 🇸🇦 Saudi Arabia · 🏴 England · 🇺🇸 USA · 🇲🇽 Mexico · 🇦🇺 Australia · 🇵🇦 Panama · 🇭🇷 Croatia · 🇸🇳 Senegal |
| **Ray** | 🇨🇮 Côte d'Ivoire · 🇪🇸 Spain · 🇲🇦 Morocco · 🇪🇬 Egypt · 🇮🇷 Iran · 🇺🇿 Uzbekistan · 🇯🇴 Jordan · 🇧🇦 Bosnia |

To change these, edit `PARTICIPANTS` in [`scripts/config.js`](scripts/config.js).

---

## 🚀 Setup — get it live in ~10 minutes

### 1. Get a football-data.org token (free)
1. Sign up at **<https://www.football-data.org/client/register>**.
2. Copy the **API token** they email you. The free tier covers the World Cup
   (10 req/min) — the 2-hourly schedule sits miles under that. Scores are
   slightly delayed and per-match goal scorers aren't included on the free
   tier; everything else (standings, points, eliminations) is full.

### 2. Save the token as a GitHub Secret 🔐 (the important bit)
The token is **never** written into the code. The Action injects it at runtime.

1. Push this repo to GitHub (see step 4) if you haven't already.
2. Go to your repo on GitHub → **Settings**.
3. In the left sidebar: **Secrets and variables → Actions** (the **Secrets** tab).
4. Click **New repository secret** (a *repository* secret, not an *environment* one).
5. **Name:** `FOOTBALL_DATA_API_KEY`  ← must be exactly this.
6. **Secret:** paste your token.
7. Click **Add secret**. Done — the workflow reads it via
   `${{ secrets.FOOTBALL_DATA_API_KEY }}`.

### 3. Turn on GitHub Pages
1. Repo → **Settings → Pages**.
2. **Source:** *Deploy from a branch*.
3. **Branch:** `main` · **Folder:** `/ (root)` → **Save**.
4. After a minute your site is live at
   `https://<your-username>.github.io/<repo-name>/`.

### 4. Push the code
```bash
git add .
git commit -m "Initial sweep tracker"
git push -u origin main
```

### 5. Check the automation
- Repo → **Actions** tab → **Update Sweep Standings** → **Run workflow**
  (this manually triggers a refresh so you don't have to wait for the cron).
- It fetches data, rewrites `data/sweep_standings.json`, commits it, and Pages
  redeploys automatically. Watch the leaderboard fill in. 🎉

---

## 🛠️ Run it locally

```bash
# Regenerate a clean zeroed board (no key needed):
npm run seed

# Pull live data locally (uses your token for this run only):
FOOTBALL_DATA_API_KEY=your_token_here npm run update

# Preview the site at http://localhost:8080
npm run serve
```

---

## ⚙️ Tweaks & troubleshooting

- **Change scoring / players / teams:** edit `scripts/config.js` only.
- **Wrong competition:** football-data.org competition code `WC` = World Cup.
  Adjust `TOURNAMENT` in `config.js` if needed.
- **A team shows 0 / never matches:** football-data.org may spell it differently.
  Add an entry to `TEAM_ALIASES` in `config.js` (maps *their* spelling → *ours*).
  Accents are already ignored automatically.
- **Saving API calls:** the workflow only calls the API between `TOURNAMENT_START`
  and `TOURNAMENT_END` (set in `.github/workflows/update.yml`). Widen/narrow as needed.
- **Run more/less often:** change the `cron` in the workflow (it's in **UTC**).

---

## 🧩 The widgets

- **🏅 Podium** — top 3 with a crown for the leader.
- **📊 Live leaderboard** — tap any name to expand their 8 teams & per-team points.
- **🥄 Wooden Spoon** — calls out whoever's dead last.
- **💀 Wall of Shame** — greys out anyone whose teams are all knocked out.
- **⚡ Latest Results** — recent scorelines with goal scorers.

Enjoy, and may the best lad win. 🍻
