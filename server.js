
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
  if (!API_KEY) {
    return res.status(503).json({
      error: "Odds API key is missing from Render."
    });
  }

  try {
    const response = await fetch(
    `https://therundown.io/api/v2/sports/2/events/${new Date().toISOString().slice(0, 10)}?market_ids=1,2,3&affiliate_ids=19,22,23&main_line=true`,
      {
        headers: {
          "X-TheRundown-Key": API_KEY
        },
        signal: AbortSignal.timeout(20000)
      }
    );

    if (!response.ok) {
      console.error("Odds provider status:", response.status);
      return res.status(502).json({
        error: "Odds provider request failed.",
        providerStatus: response.status
      });
    }

    const data = await response.json();

    res.json({
      source: "TheRundown",
      events: data.events || data,
      note: "Verify returned markets and game dates before use."
    });
  } catch (error) {
    console.error("Odds request failed:", error);
    res.status(502).json({
      error: "Unable to retrieve odds right now."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`NFL Spread Lab API listening on port ${PORT}`);
});
