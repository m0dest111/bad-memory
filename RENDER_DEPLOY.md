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

## After Deploy

Render will give you a URL like:

```text
https://bad-memory.onrender.com
```

Open that URL in two different browser windows or send it to a friend. One person clicks "Create Room" and the other joins with the room code.

## Later

Later, if you want a cleaner production setup, you can move the frontend to Netlify and keep the room server on Render. For now, Render alone is simpler.
