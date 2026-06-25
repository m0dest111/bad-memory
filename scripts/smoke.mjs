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

function makeClient() {
  return io(SERVER_URL, {
    transports: ["websocket", "polling"],
    timeout: 3000,
  });
}

async function waitForBoth(event, predicate) {
  return Promise.all([
    waitFor(host, event, predicate),
    waitFor(guest, event, predicate),
  ]);
}

async function waitForPlayers(event, predicate) {
  return Promise.all([
    waitFor(host, event, predicate),
    waitFor(guest, event, predicate),
    waitFor(third, event, predicate),
  ]);
}

const hostPlayerId = "smoke-host";
const recoveredHostPlayerId = "smoke-host-recovered";
const guestPlayerId = "smoke-guest";
const thirdPlayerId = "smoke-third";
let host = makeClient();
const guest = makeClient();
const third = makeClient();

try {
  await Promise.all([
    waitFor(host, "connect"),
    waitFor(guest, "connect"),
    waitFor(third, "connect"),
  ]);

  host.emit("room:create", { playerId: hostPlayerId });
  const lobby = await waitFor(host, "room:update", (room) => room.phase === "lobby");
  assert(lobby.code, "room code was not created");
  assert(lobby.players.length === 1, "lobby should start with one real host player");
  assert(lobby.players[0].role === "HOST", "first player should be the host");
  assert(lobby.players[0].id === hostPlayerId, "host should keep a stable player id");
  assert(lobby.prompt.length > 0, "room prompt should be populated");

  guest.emit("room:join", { code: lobby.code, playerId: guestPlayerId });
  const joined = await waitFor(guest, "room:update", (room) => room.code === lobby.code && room.players.length === 2);
  assert(joined.players.length === 2, "guest should be added as a second real player");
  assert(joined.players[1].id === guestPlayerId, "guest should keep a stable player id");
  assert(joined.players[1].role !== "HOST", "guest should not become host after joining");

  third.emit("room:join", { code: lobby.code, playerId: thirdPlayerId });
  const thirdJoined = await waitFor(third, "room:update", (room) => room.code === lobby.code && room.players.length === 3);
  assert(thirdJoined.players.length === 3, "third player should be added as a third real player");
  assert(thirdJoined.players[2].id === thirdPlayerId, "third player should keep a stable player id");

  const hostDisconnected = waitFor(guest, "room:update", (room) => (
    room.code === lobby.code
    && room.players.some((player) => player.id === hostPlayerId && player.connected === false && player.role === "HOST")
  ));
  host.disconnect();
  await hostDisconnected;

  host = makeClient();
  await waitFor(host, "connect");
  const hostRestoredForAll = waitForPlayers("room:update", (room) => (
    room.code === lobby.code
    && room.players.some((player) => player.id === recoveredHostPlayerId && player.connected === true && player.role === "HOST")
  ));
  host.emit("room:resume", { code: lobby.code, playerId: recoveredHostPlayerId });
  const [restoredHostRoom] = await hostRestoredForAll;
  assert(restoredHostRoom.hostId === undefined, "host id should not be exposed to clients");

  const guestStartBlocked = waitFor(guest, "room:error", (message) => message === "only the host can start this room");
  guest.emit("game:start", { code: lobby.code });
  await guestStartBlocked;

  const startedForAll = waitForPlayers("room:update", (room) => room.code === lobby.code && room.phase === "draw");
  host.emit("game:start", { code: lobby.code });
  const [drawingRound, guestDrawingRound, thirdDrawingRound] = await startedForAll;
  assert(drawingRound.submissions.length === 0, "new draw round should start with no submissions");
  assert(drawingRound.phaseEndsAt, "draw round should expose a countdown end time");
  assert(drawingRound.activePlayerId === recoveredHostPlayerId, "recovered host should have an active drawing assignment");
  assert(guestDrawingRound.phase === drawingRound.phase, "guest should see the draw phase start");
  assert(guestDrawingRound.activePlayerId === guestPlayerId, "guest should have an active drawing assignment");
  assert(guestDrawingRound.phaseEndsAt === drawingRound.phaseEndsAt, "host and guest should share the same draw countdown");
  assert(thirdDrawingRound.activePlayerId === thirdPlayerId, "third player should have an active drawing assignment");
  assert(
    new Set([drawingRound.prompt, guestDrawingRound.prompt, thirdDrawingRound.prompt]).size === 3,
    "parallel chains should start with unique prompts",
  );

  let latestRoom = drawingRound;
  const players = [
    { socket: host, id: recoveredHostPlayerId, label: "host" },
    { socket: guest, id: guestPlayerId, label: "guest" },
    { socket: third, id: thirdPlayerId, label: "third" },
  ];

  for (let turnIndex = 0; turnIndex < 7; turnIndex += 1) {
    const type = turnIndex % 2 === 0 ? "drawing" : "guess";
    const expectedPhase = turnIndex === 6 ? "reveal" : type === "drawing" ? "guess" : "draw";
    const nextUpdateForAll = waitForPlayers(
      "room:update",
      (room) => room.code === lobby.code && room.submissions.length === turnIndex + 1 && room.phase === expectedPhase,
    );

    for (const player of players) {
      if (type === "drawing") {
        player.socket.emit("submission:drawing", {
          code: lobby.code,
          imageUrl: `data:image/png;base64,${Buffer.from(`${player.label}-drawing-${turnIndex}`).toString("base64")}`,
        });
      } else {
        player.socket.emit("submission:guess", {
          code: lobby.code,
          guess: `${player.label} guess ${turnIndex}`,
        });
      }
    }

    const [hostRoom, guestRoom, thirdRoom] = await nextUpdateForAll;
    latestRoom = hostRoom;
    assert(latestRoom.submissions.length === turnIndex + 1, `host chain step ${turnIndex + 2} should be stored`);
    assert(guestRoom.submissions.length === latestRoom.submissions.length, `guest chain should receive step ${turnIndex + 2}`);
    assert(guestRoom.phase === latestRoom.phase, `guest should see phase ${expectedPhase}`);
    assert(thirdRoom.submissions.length === latestRoom.submissions.length, `third chain should receive step ${turnIndex + 2}`);
    assert(thirdRoom.phase === latestRoom.phase, `third player should see phase ${expectedPhase}`);
    if (expectedPhase === "draw" || expectedPhase === "guess") {
      assert(latestRoom.phaseEndsAt, `${expectedPhase} round should expose a countdown end time`);
      assert(guestRoom.phaseEndsAt === latestRoom.phaseEndsAt, `${expectedPhase} countdown should sync to guest`);
      assert(latestRoom.activePlayerId === recoveredHostPlayerId, `host should get a ${expectedPhase} assignment`);
      assert(guestRoom.activePlayerId === guestPlayerId, `guest should get a ${expectedPhase} assignment`);
      assert(thirdRoom.activePlayerId === thirdPlayerId, `third should get a ${expectedPhase} assignment`);
      assert(thirdRoom.phaseEndsAt === latestRoom.phaseEndsAt, `${expectedPhase} countdown should sync to third player`);
    }
  }

  const reveal = latestRoom;
  assert(reveal.memoryLoss !== null, "memory loss should be calculated");
  assert(reveal.slug.length === 5, "share slug should be generated");
  assert(reveal.submissions.length === 7, "full eight-step chain should include seven submissions after the prompt");
  assert(reveal.submissions.filter((submission) => submission.type === "drawing").length === 4, "chain should include four drawings");
  assert(reveal.submissions.filter((submission) => submission.type === "guess").length === 3, "chain should include three guesses");

  const savedResponse = await fetch(`${SERVER_URL}/api/memories/${reveal.slug}`);
  assert(savedResponse.ok, "saved chain should be available by share slug");
  const saved = await savedResponse.json();
  assert(saved.memory.slug === reveal.slug, "saved chain slug should match reveal slug");
  assert(saved.memory.submissions.length === 7, "saved chain should include the full submission history");

  const archiveResponse = await fetch(`${SERVER_URL}/api/memories`);
  assert(archiveResponse.ok, "archive endpoint should load");
  const archive = await archiveResponse.json();
  assert(archive.memories.some((memory) => memory.slug === reveal.slug), "archive should include the completed chain");

  host.emit("room:create");
  const secondLobby = await waitFor(host, "room:update", (room) => room.phase === "lobby" && room.code !== lobby.code);
  assert(secondLobby.prompt === "waiting for the host to start", "lobby should not expose a playable prompt before start");

  console.log(JSON.stringify({
    ok: true,
    code: reveal.code,
    prompt: reveal.prompt,
    memoryLoss: reveal.memoryLoss,
    players: thirdJoined.players.length,
    submissions: reveal.submissions.length,
    savedSlug: saved.memory.slug,
  }));
} finally {
  host.disconnect();
  guest.disconnect();
  third.disconnect();
}
