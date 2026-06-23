import { io } from "socket.io-client";

const SERVER_URL = process.env.BAD_MEMORY_SERVER_URL ?? "http://127.0.0.1:3001";

function waitFor(socket, event, predicate = () => true, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);

    function handler(payload) {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }

    socket.on(event, handler);
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const host = io(SERVER_URL, {
  transports: ["websocket", "polling"],
  timeout: 3000,
});

const guest = io(SERVER_URL, {
  transports: ["websocket", "polling"],
  timeout: 3000,
});

try {
  await Promise.all([
    waitFor(host, "connect"),
    waitFor(guest, "connect"),
  ]);

  host.emit("room:create");
  const lobby = await waitFor(host, "room:update", (room) => room.phase === "lobby");
  assert(lobby.code, "room code was not created");
  assert(lobby.players.length === 1, "lobby should start with one real host player");
  assert(lobby.players[0].role === "HOST", "first player should be the host");
  assert(lobby.prompt.length > 0, "room prompt should be populated");

  guest.emit("room:join", { code: lobby.code });
  const joined = await waitFor(guest, "room:update", (room) => room.code === lobby.code && room.players.length === 2);
  assert(joined.players.length === 2, "guest should be added as a second real player");

  host.emit("game:start", { code: lobby.code });
  const drawingRound = await waitFor(host, "room:update", (room) => room.phase === "draw");
  assert(drawingRound.submissions.length === 0, "new draw round should start with no submissions");

  host.emit("submission:drawing", {
    code: lobby.code,
    imageUrl: "data:image/png;base64,ZmFrZS1kcmF3aW5n",
  });
  const guessRound = await waitFor(host, "room:update", (room) => room.phase === "guess");
  assert(guessRound.submissions.some((submission) => submission.type === "drawing"), "drawing submission was not stored");

  guest.emit("submission:guess", {
    code: lobby.code,
    guess: "a nervous wizard doing government paperwork",
  });
  const reveal = await waitFor(host, "room:update", (room) => room.phase === "reveal");
  assert(reveal.memoryLoss !== null, "memory loss should be calculated");
  assert(reveal.slug.length === 5, "share slug should be generated");
  assert(reveal.submissions.some((submission) => submission.type === "guess"), "guess submission was not stored");

  console.log(JSON.stringify({
    ok: true,
    code: reveal.code,
    prompt: reveal.prompt,
    memoryLoss: reveal.memoryLoss,
    submissions: reveal.submissions.length,
  }));
} finally {
  host.disconnect();
  guest.disconnect();
}
