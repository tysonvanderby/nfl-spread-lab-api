
import express from "express";
import pg from "pg";
import * as cheerio from "cheerio";

const { Pool } = pg;

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.RUNDOWN_API_KEY;
console.log(
  "DATABASE_URL check:",
  process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL).hostname
    : "MISSING"
);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false,
});

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    name: "NFL Spread Lab API",
    status: "online",
    message: "Backend is running."
  });
});

const NFL_INJURY_URL = "https://amp.nfl.com/injuries/";

const NFL_TEAMS = [
  "49ers", "Bears", "Bengals", "Bills", "Broncos", "Browns",
  "Buccaneers", "Cardinals", "Chargers", "Chiefs", "Colts",
  "Commanders", "Cowboys", "Dolphins", "Eagles", "Falcons",
  "Giants", "Jaguars", "Jets", "Lions", "Packers", "Panthers",
  "Patriots", "Raiders", "Rams", "Ravens", "Saints", "Seahawks",
  "Steelers", "Texans", "Titans", "Vikings"
];

let qbInjuryCache = {
  timestamp: 0,
  players: []
};



app.get("/injuries/quarterbacks", async (req, res) => {
  try {
    // Return the cached report for five minutes.
    if (Date.now() - qbInjuryCache.timestamp < 5 * 60 * 1000) {
      return res.json({
        source: "NFL.com",
        cached: true,
        count: qbInjuryCache.players.length,
        quarterbacks: qbInjuryCache.players
      });
    }

    const response = await fetch(NFL_INJURY_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 NFL-Spread-Lab/1.0"
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      return res.status(502).json({
        error: "NFL injury report could not be retrieved.",
        upstreamStatus: response.status
      });
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const quarterbacks = [];

    const teamAliases = {
      "arizona cardinals": "Cardinals",
      "atlanta falcons": "Falcons",
      "baltimore ravens": "Ravens",
      "buffalo bills": "Bills",
      "carolina panthers": "Panthers",
      "chicago bears": "Bears",
      "cincinnati bengals": "Bengals",
      "cleveland browns": "Browns",
      "dallas cowboys": "Cowboys",
      "denver broncos": "Broncos",
      "detroit lions": "Lions",
      "green bay packers": "Packers",
      "houston texans": "Texans",
      "indianapolis colts": "Colts",
      "jacksonville jaguars": "Jaguars",
      "kansas city chiefs": "Chiefs",
      "las vegas raiders": "Raiders",
      "los angeles chargers": "Chargers",
      "los angeles rams": "Rams",
      "miami dolphins": "Dolphins",
      "minnesota vikings": "Vikings",
      "new england patriots": "Patriots",
      "new orleans saints": "Saints",
      "new york giants": "Giants",
      "new york jets": "Jets",
      "philadelphia eagles": "Eagles",
      "pittsburgh steelers": "Steelers",
      "san francisco 49ers": "49ers",
      "seattle seahawks": "Seahawks",
      "tampa bay buccaneers": "Buccaneers",
      "tennessee titans": "Titans",
      "washington commanders": "Commanders"
    };

    
function identifyTeam(text) {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const fullNameMatch = Object.entries(teamAliases).find(
    ([fullName]) => normalized.includes(fullName)
  );

  if (fullNameMatch) {
    return fullNameMatch[1];
  }

  return NFL_TEAMS.find(team =>
    normalized.split(" ").includes(team.toLowerCase())
  ) || null;
}


    $("table").each((_, table) => {
      const heading = $(table)
        .prevAll("h1, h2, h3, h4")
        .first()
        .text()
        .trim();

      const tableContext = [
  heading,
  $(table).prev().text()
].join(" ");

const team = identifyTeam(tableContext);

      const team = identifyTeam(tableContext);

      $(table).find("tr").each((_, row) => {
        const cells = $(row)
          .find("th, td")
          .map((_, cell) => $(cell).text().trim())
          .get();

        if (
          cells.length < 5 ||
          cells[1].toUpperCase() !== "QB"
        ) {
          return;
        }

        quarterbacks.push({
          team,
          player: cells[0],
          position: cells[1],
          injury: cells[2] || null,
          practiceStatus: cells[3] || null,
          gameStatus: cells[4] || null
        });
      });
    });

    qbInjuryCache = {
      timestamp: Date.now(),
      players: quarterbacks
    };

    return res.json({
      source: "NFL.com",
      cached: false,
      count: quarterbacks.length,
      quarterbacks
    });
  } catch (error) {
    console.error("QB injury endpoint error:", error);

    return res.status(500).json({
      error: "Failed to process quarterback injury report."
    });
  }
});


app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

function cleanEvent(event) {
  const teams = event.teams || [];
  const markets = event.markets || [];

  function getMarket(name) {
    const market = markets.find(m => m.name === name);
    if (!market) return [];

    return (market.participants || []).map(participant => {
      const line = participant.lines?.[0];

      return {
        selection: participant.name,
        line: line?.value ?? null,
        prices: line?.prices
          ? Object.fromEntries(
              Object.entries(line.prices).map(([book, data]) => [
                book,
                data.price
              ])
            )
          : {}
      };
    });
  }

  return {
    eventId: event.event_id,
    date: event.event_date,
    awayTeam: teams.find(t => t.is_away)?.name,
    homeTeam: teams.find(t => t.is_home)?.name,
    awayAbbreviation: teams.find(t => t.is_away)?.abbreviation,
    homeAbbreviation: teams.find(t => t.is_home)?.abbreviation,
    spread: getMarket("handicap"),
    total: getMarket("totals"),
    moneyline: getMarket("moneyline")
  };
}

app.get("/odds", async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(500).json({
        error: "Missing RUNDOWN_API_KEY environment variable."
      });
    }

    const base = "https://therundown.io/api/v2";
    const headers = { "X-TheRundown-Key": API_KEY };

    const datesResponse = await fetch(
      `${base}/sports/dates?sport_ids=2&format=epoch&exclude_canceled=true`,
      { headers }
    );

    const datesData = await datesResponse.json();

    if (!datesResponse.ok) {
      return res.status(datesResponse.status).json({
        error: "Failed to retrieve NFL game dates.",
        details: datesData
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const endDate = new Date(Date.now() + 7 * 86400000)
      .toISOString()
      .slice(0, 10);

    const dates = [...new Set(
      (datesData["2"]?.dates || [])
        .map(stamp =>
          new Date(Number(stamp) * 1000).toISOString().slice(0, 10)
        )
        .filter(date => date >= today && date <= endDate)
    )].sort();

    if (dates.length === 0) {
      return res.json({
        source: "TheRundown",
        date: today,
        datesQueried: [],
        count: 0,
        events: []
      });
    }

    const params = new URLSearchParams({
      market_ids: "1,2,3",
      affiliate_ids: "19,22,23",
      main_line: "true"
    });

    const allEvents = [];
    const errors = [];

    for (const date of dates) {
      await new Promise(resolve => setTimeout(resolve, 1100));

      const response = await fetch(
        `${base}/sports/2/events/${date}?${params}`,
        { headers }
      );

      const data = await response.json();

      if (!response.ok) {
        errors.push({
          date,
          status: response.status,
          details: data
        });
        continue;
      }

      allEvents.push(...(data.events || []));
    }

    const uniqueEvents = [
      ...new Map(
        allEvents.map(event => [event.event_id, event])
      ).values()
    ];

    return res.json({
      source: "TheRundown",
      date: today,
      datesQueried: dates,
      count: uniqueEvents.length,
      events: uniqueEvents.map(cleanEvent),
      ...(errors.length ? { warnings: errors } : {})
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to fetch NFL odds.",
      details: error.message
    });
  }
});

app.get("/consensus", async (req, res) => {
  try {
    const response = await fetch(
      `http://127.0.0.1:${PORT}/odds`
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    const sportsbookNames = {
      "19": "DraftKings",
      "22": "BetMGM",
      "23": "FanDuel"
    };

    const events = (data.events || []).map(event => {
      function summarizeMarket(market) {
        return (market || []).map(item => {
          const prices = item.prices || {};

          const books = Object.entries(prices)
            .filter(([id, price]) =>
              sportsbookNames[id] &&
              price !== null &&
              price !== undefined
            )
            .map(([id, price]) => ({
              sportsbook: sportsbookNames[id],
              price
            }));

          return {
            selection: item.selection,
            line: item.line,
            sportsbookCount: books.length,
            prices: books
          };
        });
      }

      return {
        eventId: event.eventId,
        date: event.date,
        awayTeam: event.awayTeam,
        homeTeam: event.homeTeam,
        spread: summarizeMarket(event.spread),
        total: summarizeMarket(event.total),
        moneyline: summarizeMarket(event.moneyline)
      };
    });

    return res.json({
      source: "TheRundown",
      date: data.date,
      datesQueried: data.datesQueried || [],
      gameCount: events.length,
      sportsbooks: Object.values(sportsbookNames),
      events,
      ...(data.warnings ? { warnings: data.warnings } : {})
    });
  } catch (error) {
    return res.status(500).json({
      error: "Consensus summary failed.",
      details: error.message
    });
  }
});

app.get("/best-bets", async (req, res) => {
  try {
    const status = req.query.status;

    if (status && !["pending", "graded"].includes(status)) {
      return res.status(400).json({
        error: "status must be pending or graded."
      });
    }

    let query = `
      SELECT
        id,
        event_id AS "eventId",
        game_date AS date,
        away_team AS "awayTeam",
        home_team AS "homeTeam",
        market,
        selection,
        line,
        odds,
        model_edge AS "modelEdge",
        status,
        result,
        units,
        created_at AS "createdAt",
        graded_at AS "gradedAt"
      FROM best_bets
    `;

    if (status) {
      query += " WHERE status = $1";
    }

    query += " ORDER BY game_date ASC NULLS LAST, created_at DESC";

    const result = status
      ? await pool.query(query, [status])
      : await pool.query(query);

    return res.json({
      count: result.rows.length,
      bets: result.rows
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to retrieve Best Bets.",
      details: error.message
    });
  }
});


app.post("/best-bets/generate", async (req, res) => {
  try {
    const picks = req.body?.picks;

    if (!Array.isArray(picks)) {
      return res.status(400).json({
        error: "Request must contain a picks array."
      });
    }

    const created = [];
    const skipped = [];

    for (const pick of picks) {
      const edge = Number(pick.modelEdge);

      if (!Number.isFinite(edge) || Math.abs(edge) < 2) {
        skipped.push({
          eventId: pick.eventId ?? null,
          reason: "Model edge is below 2 points."
        });
        continue;
      }

      const required = [
        "eventId",
        "awayTeam",
        "homeTeam",
        "market",
        "selection"
      ];

      const missing = required.filter(
        key => !String(pick[key] ?? "").trim()
      );

      if (missing.length) {
        skipped.push({
          eventId: pick.eventId ?? null,
          reason: "Missing fields: " + missing.join(", ")
        });
        continue;
      }

      const line =
        pick.line === null ||
        pick.line === undefined ||
        pick.line === ""
          ? null
          : Number(pick.line);

      if (line !== null && !Number.isFinite(line)) {
        skipped.push({
          eventId: pick.eventId,
          reason: "Invalid betting line."
        });
        continue;
      }

      const duplicate = await pool.query(
        `SELECT id FROM best_bets
         WHERE event_id = $1
           AND market = $2
           AND selection = $3
           AND line IS NOT DISTINCT FROM $4
         LIMIT 1`,
        [
          String(pick.eventId),
          String(pick.market),
          String(pick.selection),
          line
        ]
      );

      if (duplicate.rows.length) {
        skipped.push({
          eventId: pick.eventId,
          reason: "This pick already exists."
        });
        continue;
      }

      const gameDate = pick.date ? new Date(pick.date) : null;

      if (gameDate && Number.isNaN(gameDate.getTime())) {
        skipped.push({
          eventId: pick.eventId,
          reason: "Invalid game date."
        });
        continue;
      }

      const rawOdds = Number(pick.odds);
      const odds = Number.isInteger(rawOdds) && rawOdds !== 0
        ? rawOdds
        : -110;

      const saved = await pool.query(
        `INSERT INTO best_bets
          (event_id, game_date, away_team, home_team,
           market, selection, line, odds, model_edge)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, event_id AS "eventId",
                   away_team AS "awayTeam",
                   home_team AS "homeTeam",
                   market, selection, line, odds,
                   model_edge AS "modelEdge", status`,
        [
          String(pick.eventId),
          gameDate,
          String(pick.awayTeam),
          String(pick.homeTeam),
          String(pick.market),
          String(pick.selection),
          line,
          odds,
          edge
        ]
      );

      created.push(saved.rows[0]);
    }

    return res.json({
      createdCount: created.length,
      skippedCount: skipped.length,
      created,
      skipped
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to generate Best Bets.",
      details: error.message
    });
  }
});


app.post("/best-bets/:id/grade", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const outcome = String(req.body?.result || "").toLowerCase();

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        error: "Invalid Best Bet ID."
      });
    }

    if (!["win", "loss", "push"].includes(outcome)) {
      return res.status(400).json({
        error: "Result must be win, loss, or push."
      });
    }

    const existing = await pool.query(
      "SELECT id, odds, status FROM best_bets WHERE id = $1",
      [id]
    );

    if (!existing.rows.length) {
      return res.status(404).json({
        error: "Best Bet not found."
      });
    }

    if (existing.rows[0].status === "graded") {
      return res.status(409).json({
        error: "This Best Bet has already been graded."
      });
    }

    const odds = Number(existing.rows[0].odds) || -110;

    let units = 0;

    if (outcome === "loss") {
      units = -1;
    } else if (outcome === "win") {
      units = odds > 0 ? odds / 100 : 100 / Math.abs(odds);
    }

    const updated = await pool.query(
      `UPDATE best_bets
       SET status = 'graded',
           result = $2,
           units = $3,
           graded_at = NOW()
       WHERE id = $1
         AND status = 'pending'
       RETURNING id, event_id AS "eventId",
                 away_team AS "awayTeam",
                 home_team AS "homeTeam",
                 market, selection, line, odds,
                 model_edge AS "modelEdge",
                 status, result, units,
                 graded_at AS "gradedAt"`,
      [id, outcome, Number(units.toFixed(4))]
    );

    if (!updated.rows.length) {
      return res.status(409).json({
        error: "This Best Bet has already been graded."
      });
    }

    return res.json({
      bet: updated.rows[0]
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to grade Best Bet.",
      details: error.message
    });
  }
});


app.get("/best-bets/stats", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE status = 'graded'
        )::int AS graded,

        COUNT(*) FILTER (
          WHERE result = 'win'
        )::int AS wins,

        COUNT(*) FILTER (
          WHERE result = 'loss'
        )::int AS losses,

        COUNT(*) FILTER (
          WHERE result = 'push'
        )::int AS pushes,

        COUNT(*) FILTER (
          WHERE status = 'pending'
        )::int AS pending,

        COALESCE(
          SUM(units) FILTER (WHERE status = 'graded'),
          0
        )::numeric(12, 4) AS units,

        ROUND(
          100.0 * COUNT(*) FILTER (WHERE result = 'win')
          / NULLIF(
              COUNT(*) FILTER (
                WHERE result IN ('win', 'loss')
              ),
              0
            ),
          2
        ) AS win_percentage

      FROM best_bets
    `);

    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({
      error: "Failed to retrieve Best Bets stats.",
      details: error.message
    });
  }
});


async function startServer() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS best_bets (
        id BIGSERIAL PRIMARY KEY,
        event_id TEXT NOT NULL,
        game_date TIMESTAMPTZ,
        away_team TEXT NOT NULL,
        home_team TEXT NOT NULL,
        market TEXT NOT NULL,
        selection TEXT NOT NULL,
        line NUMERIC,
        odds INTEGER NOT NULL DEFAULT -110,
        model_edge NUMERIC,
        status TEXT NOT NULL DEFAULT 'pending',
        result TEXT,
        units NUMERIC,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        graded_at TIMESTAMPTZ
      );
    `);

    console.log("Best Bets database table ready.");

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`NFL Spread Lab API listening on port ${PORT}`);
    });
  } catch (error) {
    console.error("Database initialization failed:", error);
    process.exit(1);
  }
}

startServer();

