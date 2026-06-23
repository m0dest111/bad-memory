import express from "express";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "0.0.0.0";
const clientOrigins = process.env.CLIENT_ORIGIN
  ? process.env.CLIENT_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean)
  : [
      /^http:\/\/127\.0\.0\.1:\d+$/,
      /^http:\/\/localhost:\d+$/,
      /^http:\/\/192\.168\.\d+\.\d+:\d+$/,
      /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/,
      /^https:\/\/.+\.onrender\.com$/,
      /^https:\/\/.+\.netlify\.app$/,
    ];
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, "..", "dist");

const promptBank = [
  "a wizard getting audited by the IRS",
  "Bigfoot at airport security",
  "Nicolas Cage working at Best Buy",
  "Batman assembling IKEA furniture",
  "a shark attending a wedding",
  "a dragon applying for a mortgage",
  "a vampire filing taxes",
  "a pirate explaining cryptocurrency",
  "a robot having a midlife crisis",
  "a billionaire trapped in a bounce house",
  "a haunted printer performance review",
  "a penguin doing layoffs",
  "a ghost disputing a parking ticket",
  "a mermaid at the DMV",
  "a squirrel pitching venture capitalists",
];

const roomWords = ["GARBAGE", "TAXFISH", "WIZARD", "MAYHEM", "CRYPTID", "PRINTER", "BOUNCE", "DMVBUG", "VAMPIRE", "CAGE"];

const avatarPool = [
  { avatar: "wizard", color: "#4ea1ff" },
  { avatar: "frog", color: "#63d65f" },
  { avatar: "skull", color: "#b35aff" },
  { avatar: "cat", color: "#c7c7c7" },
  { avatar: "chicken", color: "#fff2d7" },
  { avatar: "robot", color: "#9fa7b5" },
  { avatar: "pirate", color: "#f0b64b" },
  { avatar: "person", color: "#d8956f" },
];

const rooms = new Map();

function makeRoomCode() {
  for (let index = 0; index < 40; index += 1) {
    const code = roomWords[Math.floor(Math.random() * roomWords.length)];
    if (!rooms.has(code)) return code;
  }

  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function randomPrompt() {
  return promptBank[Math.floor(Math.random() * promptBank.length)];
}

function makeSlug() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

function estimateMemoryLoss(original, final) {
  const originalWords = new Set(original.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const finalWords = new Set(final.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const overlap = [...originalWords].filter((word) => finalWords.has(word)).length;
  const retained = originalWords.size ? overlap / originalWords.size : 0;
  return Math.max(7, Math.min(99, Math.round((1 - retained) * 100)));
}

function makePlayer(socketId, index, role) {
  const avatar = avatarPool[index % avatarPool.length];
  return {
    id: socketId,
    name: `STRANGER ${String(index + 1).padStart(2, "0")}`,
    role,
    ready: true,
    ...avatar,
  };
}

function publicRoom(room) {
  return {
    code: room.code,
    phase: room.phase,
    prompt: room.prompt,
    slug: room.slug,
    memoryLoss: room.memoryLoss,
    createdAt: room.createdAt,
    players: room.players,
    submissions: room.submissions,
  };
}

function emitRoom(io, room) {
  io.to(room.code).emit("room:update", publicRoom(room));
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: clientOrigins,
  },
  maxHttpBufferSize: 4e6,
});

app.get("/health", (_request, response) => {
  response.json({ ok: true, rooms: rooms.size });
});

if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get(/.*/, (_request, response) => {
    response.sendFile(path.join(distPath, "index.html"));
  });
}

io.on("connection", (socket) => {
  socket.on("room:create", () => {
    const code = makeRoomCode();
    const room = {
      code,
      phase: "lobby",
      prompt: randomPrompt(),
      slug: makeSlug(),
      memoryLoss: null,
      createdAt: new Date().toISOString(),
      hostId: socket.id,
      players: [makePlayer(socket.id, 0, "HOST")],
      submissions: [],
    };

    rooms.set(code, room);
    socket.join(code);
    emitRoom(io, room);
  });

  socket.on("room:join", ({ code }) => {
    const normalized = String(code ?? "").trim().toUpperCase();
    const room = rooms.get(normalized);

    if (!room) {
      socket.emit("room:error", `room ${normalized || "(blank)"} does not exist yet`);
      return;
    }

    socket.join(room.code);
    if (!room.players.some((player) => player.id === socket.id)) {
      const nextIndex = room.players.length;
      room.players.push(makePlayer(socket.id, nextIndex, undefined));
    }
    emitRoom(io, room);
  });

  socket.on("game:start", ({ code }) => {
    const room = rooms.get(String(code ?? "").toUpperCase());
    if (!room) return;
    room.phase = "draw";
    room.submissions = [];
    room.memoryLoss = null;
    emitRoom(io, room);
  });

  socket.on("submission:drawing", ({ code, imageUrl }) => {
    const room = rooms.get(String(code ?? "").toUpperCase());
    if (!room || room.phase !== "draw" || typeof imageUrl !== "string") return;
    room.submissions = room.submissions.filter((submission) => submission.type !== "drawing");
    room.submissions.push({
      id: `${Date.now()}-drawing`,
      type: "drawing",
      content: imageUrl,
      playerId: socket.id,
      createdAt: new Date().toISOString(),
    });
    room.phase = "guess";
    emitRoom(io, room);
  });

  socket.on("submission:guess", ({ code, guess }) => {
    const room = rooms.get(String(code ?? "").toUpperCase());
    const text = String(guess ?? "").trim().slice(0, 120);
    if (!room || room.phase !== "guess" || !text) return;
    room.submissions = room.submissions.filter((submission) => submission.type !== "guess");
    room.submissions.push({
      id: `${Date.now()}-guess`,
      type: "guess",
      content: text,
      playerId: socket.id,
      createdAt: new Date().toISOString(),
    });
    room.memoryLoss = estimateMemoryLoss(room.prompt, text);
    room.phase = "reveal";
    emitRoom(io, room);
  });

  socket.on("disconnect", () => {
    for (const [code, room] of rooms) {
      const nextPlayers = room.players.filter((player) => player.id !== socket.id);
      if (nextPlayers.length === room.players.length) continue;

      if (nextPlayers.length === 0) {
        rooms.delete(code);
        continue;
      }

      if (room.hostId === socket.id) {
        nextPlayers[0] = { ...nextPlayers[0], role: "HOST" };
        room.hostId = nextPlayers[0].id;
      }

      room.players = nextPlayers;
      emitRoom(io, room);
    }
  });
});

httpServer.listen(PORT, HOST, () => {
  console.log(`Bad Memory server listening on http://${HOST}:${PORT}`);
});
