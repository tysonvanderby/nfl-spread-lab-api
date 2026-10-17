
import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.RUNDOWN_API_KEY;

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


app.get("/odds", async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(500).json({
        error: "Missing RUNDOWN_API_KEY environment variable."
      });
    }

    const base = "https://therundown.io/api/v2";
    const headers = {
      "X-TheRundown-Key": API_KEY
    };

    // Step 1: Find upcoming NFL game dates.
    const datesResponse = await fetch(
      `${base}/sports/dates?sport_ids=2,25,26&format=epoch&exclude_canceled=true`,
      { headers }
    );

    const datesData = await datesResponse.json();

    if (!datesResponse.ok) {
      return res.status(datesResponse.status).json({
        error: "Failed to retrieve NFL game dates.",
        details: datesData
      });
    }

    const now = Date.now() / 1000;
    const upcoming = [];

    for (const sportId of ["2", "25", "26"]) {
      const dates = datesData[sportId]?.dates || [];

      for (const stamp of dates) {
        if (Number(stamp) > now) {
          upcoming.push({
            sportId,
            stamp: Number(stamp)
          });
        }
      }
    }

    upcoming.sort((a, b) => a.stamp - b.stamp);

    if (upcoming.length === 0) {
      
const cleanEvents = (oddsData.events || []).map(event => {
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
});

return res.json({
  source: "TheRundown",
  date,
  count: cleanEvents.length,
  events: cleanEvents
});

    }

    const nextGameDate = upcoming[0];
    const date = new Date(
      nextGameDate.stamp * 1000
    ).toISOString().slice(0, 10);

    // Step 2: Retrieve Vegas lines for the next game date.
    const params = new URLSearchParams({
      market_ids: "1,2,3",
      affiliate_ids: "19,22,23",
      main_line: "true"
    });
    
    await new Promise(resolve => setTimeout(resolve, 1100));
    const oddsResponse = await fetch(
      `${base}/sports/${nextGameDate.sportId}/events/${date}?${params}`,
      { headers }
    );

    const oddsData = await oddsResponse.json();

    if (!oddsResponse.ok) {
      return res.status(oddsResponse.status).json({
        error: "Failed to retrieve NFL odds.",
        date,
        details: oddsData
      });
    }

    const cleanEvents = (oddsData.events || []).map(event => {
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
});

return res.json({
  source: "TheRundown",
  date,
  count: cleanEvents.length,
  events: cleanEvents
});

  } catch (error) {
    return res.status(500).json({
      error: "Failed to fetch NFL odds.",
      details: error.message
    });
  }
});


app.listen(PORT, "0.0.0.0", () => {
  console.log(`NFL Spread Lab API listening on port ${PORT}`);
});
