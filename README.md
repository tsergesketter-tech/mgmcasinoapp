# MGM Host:Player — Real-Time Floor Orchestration

A casino-floor demo (slots + blackjack) whose meaningful moments — big wins,
jackpots, losses, player movement — are emitted as events. In Phase 1 those
events are simulated in the browser; in Phase 2 they stream into Salesforce
**Data 360** and drive real-time host orchestration.

Built with React 19 + Vite + TypeScript. Served in production by a tiny
built-in Node server (`server.js`, no runtime dependencies).

## Develop

```bash
npm install
npm run dev        # Vite dev server (proxies /api → :8080 for the ingest route)
npm run build      # type-check + bundle to dist/
node server.js     # serve the built dist/ + the /api/ingest proxy
```

## Event flow

Every floor moment goes through `emitEvent()` in `src/lib/events.ts`. Each
event is rendered in the Orchestration Feed immediately, then dispatched:

- **Simulated** (default): a fake round-trip, no network.
- **Live**: `POST /api/ingest` → `server.js` attaches a Data Cloud token and
  forwards to the Ingestion API. The browser never holds a Salesforce token.

On startup the app calls `initD360FromServer()`, which hits `/api/health`; if
the server reports Data 360 is configured, the app switches to live mode
automatically.

## Data 360 live ingestion

Set these **server-side** config vars (Heroku config vars, or a local `.env` —
see `.env.example`). With none set, the app runs in simulated mode.

| Var | Required | Purpose |
| --- | --- | --- |
| `SF_CLIENT_ID` | yes | Connected app consumer key (client-credentials flow) |
| `SF_CLIENT_SECRET` | yes | Connected app consumer secret |
| `SF_LOGIN_URL` | no | Login/My Domain host (default `https://login.salesforce.com`) |
| `D360_SOURCE` | no | Ingestion API source object (default `mgmFloorEvents`) |

`server.js` performs the two-hop auth: client-credentials **core token** →
token exchange at `/services/a360/token` for a Data Cloud **offcore token** →
`POST {dcInstanceUrl}/api/v1/ingest/sources/{D360_SOURCE}/data`. Both tokens
are cached with an in-flight dedupe; a 401 forces one refresh + retry.

### Org-side setup (already provisioned in the demo org)

1. **Ingestion API source** `mgmFloorEvents` — upload
   `../data/d360/mgm_floor_events_s2s_schema.json` in the connector's
   *Upload Schema File* step. Creates the source object + its DLO.
2. **DMO** `MGM_Floor_Event__dlm` (category Engagement, PK `eventId`) — the
   target the DLO maps to. Fields mirror the schema 1:1.
3. **Mapping** DLO → `MGM_Floor_Event__dlm`.
4. **Data Action** on the DMO, filtered to `eventType IN ('JACKPOT','BIG_WIN')`,
   → webhook / platform event → Flow → host notification (the real-time path).

The event record shape (`toD360Record()`) and the schema `developerName`s must
stay in lockstep — both use the six mandatory Engagement fields (`eventId`,
`eventType`, `dateTime`, `category`, `deviceId`, `sessionId`) plus the domain
fields.
