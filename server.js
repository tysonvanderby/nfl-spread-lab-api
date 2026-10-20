
import express from "express";
import pg from "pg";

const { Pool } = pg;

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.RUNDOWN_API_KEY;

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

