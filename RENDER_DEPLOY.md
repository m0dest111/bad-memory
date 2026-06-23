# Bad Memory Render Deploy

For the first live test, use Render by itself. Render can host the React website and the multiplayer Socket.io server from the same URL.

This means you do not need Netlify yet.

## What You Need

- A GitHub account
- A Render account
- This project uploaded to a GitHub repository

Render does not deploy directly from a zip file on the "New Web Service" screen. It expects a GitHub, GitLab, Bitbucket, or public Git repository.

## On the Render Screen

You are on:

```text
New Web Service > Configure
```

Click:

```text
GitHub
```

Then connect the GitHub repository that contains this project.

## Render Settings

If Render asks for settings, use:

```text
Name: bad-memory
Runtime: Node
Build command: npm install && npm run build
Start command: npm start
Health check path: /health
```

Use the free plan for testing.

## Environment Variables

For the Render-only test deploy, you do not need `VITE_SOCKET_URL`.

The website and room server are on the same Render URL, so the browser connects automatically.

Optional:

```text
NODE_VERSION=20
```

## Saved Chains Database

To keep completed games shareable after deploys/restarts, add a Render Postgres database:

1. In Render, create a new Postgres database.
2. Copy its internal database URL.
3. Open the Bad Memory web service.
4. Add this environment variable:

```text
DATABASE_URL=YOUR_RENDER_POSTGRES_INTERNAL_DATABASE_URL
```

The app creates the `memories` table automatically.

If `DATABASE_URL` is missing, completed chains are saved to a local JSON fallback. That is fine for local development, but it is not reliable for production.

## After Deploy

Render will give you a URL like:

```text
https://bad-memory.onrender.com
```

Open that URL in two different browser windows or send it to a friend. One person clicks "Create Room" and the other joins with the room code.

When a chain reaches the reveal, the app saves it and enables a share URL like:

```text
https://bad-memory.onrender.com/m/12345
```

## Later

Later, if you want a cleaner production setup, you can move the frontend to Netlify and keep the room server on Render. For now, Render alone is simpler.
