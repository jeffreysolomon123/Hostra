# Hostra dashboard

React 19 + Vite + react-router + Tailwind v4. See the root [README](../README.md).

```bash
cp .env.example .env.local   # VITE_API_URL=http://localhost:8000
npm install
npm run dev                  # http://localhost:5173
```

Layout: `src/pages` (routes), `src/pages/project` (project tabs), `src/components`
(feature components), `src/components/ui` (design-system primitives), `src/hooks`
(`useWebSocket`, `useApi`, ...), `src/lib` (API client, auth, live events, formatting).
