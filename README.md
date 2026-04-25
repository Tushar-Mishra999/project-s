# Tech Sensing Feed

Full-stack app: Express backend runs the 4-stage scrape → score → fetch → summarise pipeline; React frontend renders the feed.

## Setup

One-time install (root + client):

```bash
npm run install:all
```

Make sure `.env` contains:

```
FIRECRAWL_API_KEY=fc-...
ANTHROPIC_API_KEY=sk-ant-...
PORT=3001
```

## Run

```bash
npm start
```

- Express API on http://localhost:3001
- React dev server on http://localhost:5173 (proxies `/api` to the Express server)

Open http://localhost:5173 in a browser. The feed loads automatically; use **Refresh Feed** to re-run the pipeline.

## Project layout

```
.
├── server.js         Express + Firecrawl + Anthropic pipeline
├── config.json       Sources, threshold, models
├── .env              API keys (gitignored)
├── package.json      Root scripts (uses concurrently)
└── client/           React + Vite frontend
    ├── index.html
    ├── vite.config.js
    └── src/
        ├── main.jsx
        ├── App.jsx
        └── styles.css
```

## Deploy notes

- Build the client: `npm run build` (outputs `client/dist/`).
- Have Express serve `client/dist/` statically in production, or deploy each separately (Render/Railway for the API, Vercel/Netlify for the static client).
