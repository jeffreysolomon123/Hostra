const express = require("express");
const os = require("os");

const app = express();
const port = Number(process.env.PORT) || 3000;
let hits = 0;

app.get("/", (_req, res) => {
  hits += 1;
  res.json({ message: "Hello from Express on Hostra", container: os.hostname(), hits });
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// 0.0.0.0 so Traefik can reach it from another container
app.listen(port, "0.0.0.0", () => console.log(`listening on :${port}`));
