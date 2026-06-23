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
  assert(drawingRound.phaseEndsAt, "draw round should expose a countdown end time");

  let latestRoom = drawingRound;
  const chainInputs = [
    { type: "drawing", content: "data:image/png;base64,ZHJhd2luZy0x" },
    { type: "guess", content: "a nervous wizard doing government paperwork" },
    { type: "drawing", content: "data:image/png;base64,ZHJhd2luZy0y" },
    { type: "guess", content: "a stressed wizard at a desk" },
    { type: "drawing", content: "data:image/png;base64,ZHJhd2luZy0z" },
    { type: "guess", content: "a magician filing forms" },
    { type: "drawing", content: "data:image/png;base64,ZHJhd2luZy00" },
  ];

  for (const [index, input] of chainInputs.entries()) {
    if (input.type === "drawing") {
      host.emit("submission:drawing", {
        code: lobby.code,
        imageUrl: input.content,
      });
    } else {
      guest.emit("submission:guess", {
        code: lobby.code,
        guess: input.content,
      });
    }

    const expectedPhase = index === chainInputs.length - 1 ? "reveal" : input.type === "drawing" ? "guess" : "draw";
    latestRoom = await waitFor(host, "room:update", (room) => room.submissions.length === index + 1 && room.phase === expectedPhase);
    assert(latestRoom.submissions.length === index + 1, `step ${index + 2} should be stored`);
    if (expectedPhase === "draw" || expectedPhase === "guess") {
      assert(latestRoom.phaseEndsAt, `${expectedPhase} round should expose a countdown end time`);
    }
  }

  const reveal = latestRoom;
  assert(reveal.memoryLoss !== null, "memory loss should be calculated");
  assert(reveal.slug.length === 5, "share slug should be generated");
  assert(reveal.submissions.length === 7, "full eight-step chain should include seven submissions after the prompt");
  assert(reveal.submissions.filter((submission) => submission.type === "drawing").length === 4, "chain should include four drawings");
  assert(reveal.submissions.filter((submission) => submission.type === "guess").length === 3, "chain should include three guesses");

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
