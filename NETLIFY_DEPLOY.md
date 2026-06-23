# Bad Memory Netlify Deploy

This package deploys the React frontend to Netlify.

Important: Netlify static hosting does not run the persistent Socket.io room server. For live multiplayer rooms, deploy `server/index.mjs` separately to a WebSocket-capable Node host such as Render, Fly.io, Railway, or a VPS.

## Netlify Settings

- Build command: `npm run build`
- Publish directory: `dist`
- Node version: `20`

## Required Environment Variable

Set this in Netlify before deploying:

```text
VITE_SOCKET_URL=https://YOUR-LIVE-SOCKET-SERVER
```

Without `VITE_SOCKET_URL`, the site will load but live rooms cannot connect on Netlify.

## Backend CORS

When you deploy the room server, set this environment variable on the backend if you want to lock it to your Netlify URL:

```text
CLIENT_ORIGIN=https://YOUR-SITE.netlify.app
```

If you omit it, the development server allows localhost, common LAN IPs, and `*.netlify.app`.

## Local Production Test

```bash
npm install
npm run build
npm start
```

Then open:

```text
http://127.0.0.1:3001/
```

## Smoke Test

With the server running:

```bash
npm run test:smoke
```

The smoke test creates a room, joins with a second client, starts the game, submits a drawing and guess, and verifies the reveal.
