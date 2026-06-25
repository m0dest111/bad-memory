import express from "express";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { Server } from "socket.io";

const { Pool } = pg;
const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "0.0.0.0";
const DATABASE_URL = process.env.DATABASE_URL;
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
const memoryStorePath = process.env.MEMORY_STORE_PATH ?? path.join(__dirname, "..", "data", "memories.json");
let memoryPool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.PGSSLMODE === "disable" || DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
    })
  : null;

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

const promptSubjects = [
  "a haunted vending machine",
  "a jealous moon",
  "a knight with stage fright",
  "a cereal mascot",
  "a nervous volcano",
  "a retired superhero",
  "a tiny dinosaur",
  "a cursed birthday cake",
  "a wizard intern",
  "a sentient suitcase",
];

const promptActions = [
  "arguing with customer support",
  "hosting a garage sale",
  "trying speed dating",
  "getting stuck in an elevator",
  "auditioning for a cooking show",
  "teaching a yoga class",
  "failing a driving test",
  "running a city council meeting",
  "escaping a team-building exercise",
  "buying suspicious shoes",
];

const roomWords = ["GARBAGE", "TAXFISH", "WIZARD", "MAYHEM", "CRYPTID", "PRINTER", "BOUNCE", "DMVBUG", "VAMPIRE", "CAGE"];
const MAX_CHAIN_STEPS = 8;
const TURN_DURATION_MS = 60_000;
const ROOM_IDLE_TTL_MS = 30 * 60_000;

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
const completedMemories = new Map();
const reservedPrompts = new Set();

function fromDbMemory(row) {
  return {
    slug: row.slug,
    prompt: row.prompt,
    memoryLoss: row.memory_loss,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    completedAt: row.completed_at instanceof Date ? row.completed_at.toISOString() : row.completed_at,
    submissions: row.submissions,
  };
}

async function initMemoryStore() {
  if (!memoryPool) {
    loadMemories();
    return;
  }

  try {
    await memoryPool.query(`
      CREATE TABLE IF NOT EXISTS memories (
        slug TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        memory_loss INTEGER,
        created_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ NOT NULL,
        submissions JSONB NOT NULL
      )
    `);
  } catch (error) {
    console.warn("Could not initialize Postgres memory store; using local JSON fallback", error);
    memoryPool = null;
    loadMemories();
  }
}

function loadMemories() {
  if (!existsSync(memoryStorePath)) return;

  try {
    const parsed = JSON.parse(readFileSync(memoryStorePath, "utf8"));
    if (!Array.isArray(parsed)) return;
    for (const memory of parsed) {
      if (memory?.slug) completedMemories.set(memory.slug, memory);
    }
  } catch (error) {
    console.warn("Could not load completed memories", error);
  }
}

function persistMemories() {
  try {
    mkdirSync(path.dirname(memoryStorePath), { recursive: true });
    const memories = [...completedMemories.values()].sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
    writeFileSync(memoryStorePath, JSON.stringify(memories, null, 2));
  } catch (error) {
    console.warn("Could not persist completed memories", error);
  }
}

async function listMemories(limit = 20) {
  if (memoryPool) {
    const result = await memoryPool.query(`
      SELECT slug, prompt, memory_loss, created_at, completed_at, submissions
      FROM memories
      ORDER BY completed_at DESC
      LIMIT $1
    `, [limit]);
    return result.rows.map(fromDbMemory);
  }

  return [...completedMemories.values()]
    .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))
    .slice(0, limit);
}

async function getMemory(slug) {
  if (memoryPool) {
    const result = await memoryPool.query(
      `SELECT slug, prompt, memory_loss, created_at, completed_at, submissions FROM memories WHERE slug = $1`,
      [slug],
    );
    return result.rows[0] ? fromDbMemory(result.rows[0]) : null;
  }

  return completedMemories.get(slug) ?? null;
}

function makeRoomCode() {
  for (let index = 0; index < 40; index += 1) {
    const code = roomWords[Math.floor(Math.random() * roomWords.length)];
    if (!rooms.has(code)) return code;
  }

  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function normalizePrompt(prompt) {
  return String(prompt ?? "").trim().toLowerCase();
}

async function usedPrompts() {
  const used = new Set([...rooms.values()].map((room) => normalizePrompt(room.prompt)));
  for (const prompt of reservedPrompts) used.add(prompt);
  if (memoryPool) {
    const result = await memoryPool.query("SELECT prompt FROM memories");
    for (const row of result.rows) used.add(normalizePrompt(row.prompt));
  } else {
    for (const memory of completedMemories.values()) used.add(normalizePrompt(memory.prompt));
  }
  return used;
}

async function randomPrompt() {
  const used = await usedPrompts();
  const available = promptBank.filter((prompt) => !used.has(normalizePrompt(prompt)));
  if (available.length > 0) {
    const prompt = available[Math.floor(Math.random() * available.length)];
    reservedPrompts.add(normalizePrompt(prompt));
    return prompt;
  }

  for (const subject of promptSubjects) {
    for (const action of promptActions) {
      const prompt = `${subject} ${action}`;
      if (!used.has(normalizePrompt(prompt))) {
        reservedPrompts.add(normalizePrompt(prompt));
        return prompt;
      }
    }
  }

  let prompt = "";
  do {
    prompt = `${promptSubjects[Math.floor(Math.random() * promptSubjects.length)]} ${promptActions[Math.floor(Math.random() * promptActions.length)]} case ${makeSlug()}`;
  } while (used.has(normalizePrompt(prompt)));
  reservedPrompts.add(normalizePrompt(prompt));
  return prompt;
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

function normalizePlayerId(playerId, socketId) {
  const normalized = String(playerId ?? "").trim();
  return normalized || socketId;
}

function makePlayer(playerId, socketId, index, role) {
  const avatar = avatarPool[index % avatarPool.length];
  return {
    id: playerId,
    socketId,
    name: `STRANGER ${String(index + 1).padStart(2, "0")}`,
    role,
    connected: true,
    ready: true,
    lastSeenAt: new Date().toISOString(),
    ...avatar,
  };
}

function setPhase(room, phase) {
  room.phase = phase;
  room.phaseStartedAt = new Date().toISOString();
  room.phaseEndsAt = phase === "draw" || phase === "guess" ? new Date(Date.now() + TURN_DURATION_MS).toISOString() : null;
}

function publicRoom(room) {
  return {
    code: room.code,
    phase: room.phase,
    prompt: room.prompt,
    slug: room.slug,
    memoryLoss: room.memoryLoss,
    createdAt: room.createdAt,
    phaseStartedAt: room.phaseStartedAt,
    phaseEndsAt: room.phaseEndsAt,
    players: room.players.map(({ socketId, ...player }) => player),
    submissions: room.submissions,
  };
}

function emitRoom(io, room) {
  io.to(room.code).emit("room:update", publicRoom(room));
}

function latestSubmission(room, type) {
  return room.submissions.findLast((submission) => submission.type === type);
}

function latestGuessText(room) {
  return latestSubmission(room, "guess")?.content ?? room.prompt;
}

function playerForSocket(room, socketId) {
  return room.players.find((player) => player.socketId === socketId);
}

function playerForId(room, playerId) {
  return room.players.find((player) => player.id === playerId);
}

function attachPlayerSocket(player, socketId) {
  player.socketId = socketId;
  player.connected = true;
  player.lastSeenAt = new Date().toISOString();
}

function scheduleRoomCleanup(code) {
  setTimeout(() => {
    const room = rooms.get(code);
    if (!room) return;
    const hasConnectedPlayers = room.players.some((player) => player.connected);
    const lastSeen = Math.max(...room.players.map((player) => Date.parse(player.lastSeenAt) || 0));
    if (!hasConnectedPlayers && Date.now() - lastSeen >= ROOM_IDLE_TTL_MS) {
      rooms.delete(code);
    }
  }, ROOM_IDLE_TTL_MS);
}

function publicMemory(memory) {
  return {
    slug: memory.slug,
    prompt: memory.prompt,
    memoryLoss: memory.memoryLoss,
    createdAt: memory.createdAt,
    completedAt: memory.completedAt,
    submissions: memory.submissions,
  };
}

async function saveCompletedMemory(room) {
  let existing = null;
  try {
    existing = await getMemory(room.slug);
  } catch (error) {
    console.warn("Could not check existing memory before save", error);
  }
  if (existing) return existing;

  const memory = {
    slug: room.slug,
    prompt: room.prompt,
    memoryLoss: room.memoryLoss,
    createdAt: room.createdAt,
    completedAt: new Date().toISOString(),
    submissions: room.submissions,
  };

  if (memoryPool) {
    try {
      await memoryPool.query(
        `
          INSERT INTO memories (slug, prompt, memory_loss, created_at, completed_at, submissions)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (slug) DO NOTHING
        `,
        [memory.slug, memory.prompt, memory.memoryLoss, memory.createdAt, memory.completedAt, JSON.stringify(memory.submissions)],
      );
      return memory;
    } catch (error) {
      console.warn("Could not save completed memory to Postgres; using local JSON fallback", error);
    }
  }

  completedMemories.set(memory.slug, memory);
  persistMemories();
  return memory;
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
  response.json({ ok: true, rooms: rooms.size, memories: completedMemories.size });
});

app.get("/api/memories", async (_request, response) => {
  try {
    const memories = (await listMemories()).map(publicMemory);
    response.json({ memories });
  } catch (error) {
    response.status(500).json({ error: "could not load memories" });
  }
});

app.get("/api/memories/:slug", async (request, response) => {
  const memory = await getMemory(String(request.params.slug ?? ""));
  if (!memory) {
    response.status(404).json({ error: "memory not found" });
    return;
  }

  response.json({ memory: publicMemory(memory) });
});

if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get(/.*/, (_request, response) => {
    response.sendFile(path.join(distPath, "index.html"));
  });
}

io.on("connection", (socket) => {
  socket.on("room:create", async ({ playerId } = {}) => {
    const stablePlayerId = normalizePlayerId(playerId, socket.id);
    const code = makeRoomCode();
    const prompt = await randomPrompt();
    const room = {
      code,
      phase: "lobby",
      prompt,
      slug: makeSlug(),
      memoryLoss: null,
      createdAt: new Date().toISOString(),
      phaseStartedAt: new Date().toISOString(),
      phaseEndsAt: null,
      hostId: stablePlayerId,
      players: [makePlayer(stablePlayerId, socket.id, 0, "HOST")],
      submissions: [],
    };

    rooms.set(code, room);
    reservedPrompts.delete(normalizePrompt(prompt));
    socket.join(code);
    emitRoom(io, room);
  });

  socket.on("room:join", ({ code, playerId }) => {
    const normalized = String(code ?? "").trim().toUpperCase();
    const stablePlayerId = normalizePlayerId(playerId, socket.id);
    const room = rooms.get(normalized);

    if (!room) {
      socket.emit("room:error", `room ${normalized || "(blank)"} does not exist yet`);
      return;
    }

    if (room.phase !== "lobby") {
      socket.emit("room:error", `room ${normalized} is already in progress`);
      return;
    }

    if (room.players.length >= 12 && !room.players.some((player) => player.id === stablePlayerId)) {
      socket.emit("room:error", `room ${normalized} is full`);
      return;
    }

    socket.join(room.code);
    const existingPlayer = playerForId(room, stablePlayerId);
    if (existingPlayer) {
      attachPlayerSocket(existingPlayer, socket.id);
    } else {
      const nextIndex = room.players.length;
      room.players.push(makePlayer(stablePlayerId, socket.id, nextIndex, undefined));
    }
    emitRoom(io, room);
  });

  socket.on("room:resume", ({ code, playerId }) => {
    const normalized = String(code ?? "").trim().toUpperCase();
    const stablePlayerId = normalizePlayerId(playerId, socket.id);
    const room = rooms.get(normalized);

    if (!room) {
      socket.emit("room:error", `room ${normalized || "(blank)"} could not be restored`);
      return;
    }

    const player = playerForId(room, stablePlayerId);
    if (!player) {
      socket.emit("room:error", `room ${normalized} does not have your saved seat`);
      return;
    }

    attachPlayerSocket(player, socket.id);
    socket.join(room.code);
    emitRoom(io, room);
  });

  socket.on("game:start", ({ code }) => {
    const room = rooms.get(String(code ?? "").toUpperCase());
    if (!room) return;
    const player = playerForSocket(room, socket.id);
    if (!player || room.hostId !== player.id) {
      socket.emit("room:error", "only the host can start this room");
      return;
    }
    setPhase(room, "draw");
    room.submissions = [];
    room.memoryLoss = null;
    emitRoom(io, room);
  });

  socket.on("submission:drawing", async ({ code, imageUrl }) => {
    const room = rooms.get(String(code ?? "").toUpperCase());
    const player = room ? playerForSocket(room, socket.id) : null;
    if (!room || !player || room.phase !== "draw" || typeof imageUrl !== "string") return;
    room.submissions.push({
      id: `${Date.now()}-drawing`,
      type: "drawing",
      content: imageUrl,
      playerId: player.id,
      createdAt: new Date().toISOString(),
    });
    if (room.submissions.length >= MAX_CHAIN_STEPS - 1) {
      room.memoryLoss = estimateMemoryLoss(room.prompt, latestGuessText(room));
      setPhase(room, "reveal");
      await saveCompletedMemory(room);
    } else {
      setPhase(room, "guess");
    }
    emitRoom(io, room);
  });

  socket.on("submission:guess", async ({ code, guess }) => {
    const room = rooms.get(String(code ?? "").toUpperCase());
    const player = room ? playerForSocket(room, socket.id) : null;
    const text = String(guess ?? "").trim().slice(0, 120);
    if (!room || !player || room.phase !== "guess" || !text) return;
    room.submissions.push({
      id: `${Date.now()}-guess`,
      type: "guess",
      content: text,
      playerId: player.id,
      createdAt: new Date().toISOString(),
    });
    if (room.submissions.length >= MAX_CHAIN_STEPS - 1) {
      room.memoryLoss = estimateMemoryLoss(room.prompt, text);
      setPhase(room, "reveal");
      await saveCompletedMemory(room);
    } else {
      setPhase(room, "draw");
    }
    emitRoom(io, room);
  });

  socket.on("disconnect", () => {
    for (const [code, room] of rooms) {
      const player = playerForSocket(room, socket.id);
      if (!player) continue;
      player.connected = false;
      player.socketId = null;
      player.lastSeenAt = new Date().toISOString();
      scheduleRoomCleanup(code);
      emitRoom(io, room);
    }
  });
});

await initMemoryStore();

httpServer.listen(PORT, HOST, () => {
  console.log(`Bad Memory server listening on http://${HOST}:${PORT}`);
});
