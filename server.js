
import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    name: "NFL Spread Lab API",
    status: "online",
    message: "Backend is running."
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`NFL Spread Lab API listening on port ${PORT}`);
});
