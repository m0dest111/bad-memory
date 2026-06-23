import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

type Tool = "pencil" | "eraser";
type GamePhase = "idle" | "lobby" | "draw" | "guess" | "reveal";

type Player = {
  id?: string;
  name: string;
  role?: string;
  avatar: string;
  color: string;
  ready?: boolean;
  empty?: boolean;
};

type ChainStep = {
  label: string;
  type: "prompt" | "drawing" | "guess" | "final";
  text?: string;
  drawing?: string;
  imageUrl?: string;
};

type Submission = {
  id: string;
  type: "drawing" | "guess";
  content: string;
  playerId: string;
  createdAt: string;
};

type RoomState = {
  code: string;
  phase: GamePhase;
  prompt: string;
  slug: string;
  memoryLoss: number | null;
  createdAt: string;
  phaseStartedAt?: string;
  phaseEndsAt: string | null;
  players: Player[];
  submissions: Submission[];
};

type MemoryRecord = {
  slug: string;
  prompt: string;
  memoryLoss: number | null;
  createdAt: string;
  completedAt: string;
  submissions: Submission[];
};

function latestSubmission(submissions: Submission[], type: Submission["type"]) {
  for (let index = submissions.length - 1; index >= 0; index -= 1) {
    if (submissions[index].type === type) return submissions[index];
  }
  return undefined;
}

function formatTimer(milliseconds: number | null) {
  if (milliseconds === null) return "--:--";
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function shareLink(slug?: string) {
  if (!slug) return "";
  return `${window.location.origin}/m/${slug}`;
}

function PixelAvatar({ avatar, color }: { avatar: string; color: string }) {
  return (
    <div className={`pixel-avatar pixel-avatar--${avatar}`} style={{ "--avatar": color } as React.CSSProperties}>
      <span className="pixel-avatar__hat" />
      <span className="pixel-avatar__eyes" />
      <span className="pixel-avatar__mouth" />
    </div>
  );
}

function MiniDrawing({ kind, large = false }: { kind?: string; large?: boolean }) {
  return (
    <svg className={large ? "mini-drawing mini-drawing--large" : "mini-drawing"} viewBox="0 0 220 140" role="img">
      <rect width="220" height="140" fill="#f7f4ed" />
      <path className="paper-noise" d="M0 18h220M0 47h220M0 83h220M0 123h220M19 0v140M67 0v140M139 0v140M188 0v140" />
      {(kind === "audit" || !kind) && (
        <>
          <path d="M31 113 36 45 64 79 24 70 90 72M52 83c8 7 8 18-1 27M72 99c12-7 19-5 26 8" />
          <path d="M122 87h72v43h-72zM126 82l51-15 27 15M167 64c-8-8-6-22 9-25 14 2 18 17 9 27M159 57h35M164 52h4M181 52h4M162 76c13 11 28 11 39 0M185 87v27" />
          <path d="M139 33h38M139 44h38M139 55h38M140 31l-8 5 8 24M123 118h42v30h-42z" />
          <text x="132" y="139">IRS</text>
        </>
      )}
      {kind === "desk" && (
        <>
          <path d="M35 113 40 45 67 80 28 72 89 72M55 86c11 12 11 25 2 39M118 95h73v31h-73zM136 78c10-19 40-18 52 0M152 74v21M175 74v21M148 111h37" />
          <path d="M112 95l80-16M68 107c22-15 31-15 47 2" />
        </>
      )}
      {kind === "wand" && (
        <>
          <path d="M24 104c13-20 27-24 43-5M45 98v31M30 129h35M111 34l17 36 39 4-29 25 9 38-36-20-35 20 8-38-29-25 39-4zM50 42l11 11M58 34l-3 17M38 53l18-3" />
        </>
      )}
      {kind === "triangle" && (
        <>
          <path d="M25 92c7-30 46-30 52 1M52 92v33M32 125h41M121 119 159 38l40 81zM156 82h6M180 82h6M158 101c12 10 23 9 34 0M96 59l22-19M95 81h31" />
        </>
      )}
      {kind === "raccoon" && (
        <>
          <path d="M66 104c-19-20-14-52 16-67 19-10 47-8 66 5 29 19 31 49 12 66-20 20-73 20-94-4zM87 67c20-14 44-14 66 1M91 74h19M131 74h19M109 99c13 8 25 8 38 0M62 96 31 74M152 36l18-22M86 36 69 69" />
        </>
      )}
      {kind === "castle" && (
        <>
          <path d="M29 116V54h23V34h21v20h40V34h21v20h23V34h22v82zM48 74h33M98 74h33M148 74h23M89 116V89c0-22 31-22 31 0v27" />
          <path d="M46 28h16M105 28h16M164 28h16" />
        </>
      )}
      {kind === "face" && (
        <>
          <path d="M64 118c-42-49 4-97 51-86 51 12 53 77 18 98M72 66h22M120 66h23M95 92c15 9 31 8 43-3M103 50c-5-20 11-27 25-24" />
          <path d="M45 86c18 6 27 17 29 35M163 79c-12 18-24 27-41 26" />
        </>
      )}
      {kind === "pirate" && (
        <>
          <path d="M68 115c-37-39-5-85 40-85s76 45 40 85M59 45c19-29 75-34 101 0M73 39c5-22 15-26 25-13M128 27c20 5 28 18 35 33M82 72h25M123 72h31M92 96c20 14 38 14 56 0M54 41l112 1" />
        </>
      )}
    </svg>
  );
}

function SubmittedDrawing({ src, large = false }: { src?: string; large?: boolean }) {
  if (!src) {
    return (
      <div className={large ? "submitted-drawing submitted-drawing--large empty-drawing" : "submitted-drawing empty-drawing"}>
        <span>drawing appears here</span>
      </div>
    );
  }

  return <img className={large ? "submitted-drawing submitted-drawing--large" : "submitted-drawing"} src={src} alt="Submitted drawing" />;
}

function DrawingCanvas({
  isActive,
  prompt,
  roundNumber,
  timerLabel,
  onSubmit,
}: {
  isActive: boolean;
  prompt: string;
  roundNumber: number;
  timerLabel: string;
  onSubmit: (imageUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tool, setTool] = useState<Tool>("pencil");
  const [history, setHistory] = useState<ImageData[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#f7f4ed";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    setHistory([ctx.getImageData(0, 0, canvas.width, canvas.height)]);
    setSubmitted(false);
  }, [prompt, roundNumber]);

  function position(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function begin(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawing.current = true;
    last.current = position(event);
    canvas.setPointerCapture(event.pointerId);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const next = position(event);
    ctx.strokeStyle = tool === "eraser" ? "#f7f4ed" : "#151515";
    ctx.lineWidth = tool === "eraser" ? 18 : 4;
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    last.current = next;
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    setHistory((items) => [...items.slice(-9), ctx.getImageData(0, 0, canvas.width, canvas.height)]);
  }

  function undo() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || history.length < 2) return;
    const next = history.slice(0, -1);
    ctx.putImageData(next[next.length - 1], 0, 0);
    setHistory(next);
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#f7f4ed";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHistory([ctx.getImageData(0, 0, canvas.width, canvas.height)]);
    setSubmitted(false);
  }

  return (
    <section className={isActive ? "panel game-panel active-round" : "panel game-panel dimmed-round"}>
      <header className="panel-title">
        <span>STEP {roundNumber} / 8</span>
        <span>DRAW</span>
        <time>{isActive ? timerLabel : "--:--"}</time>
      </header>
      <p className="prompt">{isActive ? <>PROMPT: <mark>{prompt}</mark></> : "PROMPT: waiting for the draw step"}</p>
      <div className="draw-layout">
        <div className="tools" aria-label="Drawing tools">
          <button className={tool === "pencil" ? "active" : ""} onClick={() => setTool("pencil")} aria-label="Pencil">✎</button>
          <button className={tool === "eraser" ? "active" : ""} onClick={() => setTool("eraser")} aria-label="Eraser">▱</button>
          <button onClick={undo} aria-label="Undo">↶</button>
          <button onClick={clear} aria-label="Clear drawing">⌧</button>
        </div>
        <canvas
          ref={canvasRef}
          width={720}
          height={400}
          onPointerDown={begin}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          aria-label="Drawing canvas"
        />
        {!isActive && (
          <div className="inactive-cover">
            <span>WAITING</span>
          </div>
        )}
      </div>
      <footer className="panel-actions">
        <button className="secondary" onClick={clear}>CLEAR</button>
        <button
          className="hot"
          disabled={!isActive}
          onClick={() => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            setSubmitted(true);
            onSubmit(canvas.toDataURL("image/png"));
          }}
        >
          {submitted ? "SENT" : "SUBMIT"}
        </button>
      </footer>
    </section>
  );
}

function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [serverOnline, setServerOnline] = useState(false);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [guess, setGuess] = useState("");
  const [notice, setNotice] = useState("connecting to the room server...");
  const [copied, setCopied] = useState<"room" | "link" | null>(null);
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [now, setNow] = useState(Date.now());
  const [showHelp, setShowHelp] = useState(true);
  const [sharedMemory, setSharedMemory] = useState<MemoryRecord | null>(null);
  const [archiveMemories, setArchiveMemories] = useState<MemoryRecord[]>([]);

  async function refreshArchive() {
    try {
      const response = await fetch("/api/memories");
      if (!response.ok) return;
      const data = await response.json();
      setArchiveMemories(Array.isArray(data.memories) ? data.memories : []);
    } catch {
      // Archive is non-critical for active play.
    }
  }

  useEffect(() => {
    const socketUrl = import.meta.env.VITE_SOCKET_URL ?? (import.meta.env.DEV ? "http://127.0.0.1:3001" : undefined);
    const nextSocket = io(socketUrl, {
      transports: ["websocket", "polling"],
    });

    nextSocket.on("connect", () => {
      setServerOnline(true);
      setNotice("room server online. create or join a room.");
    });

    nextSocket.on("disconnect", () => {
      setServerOnline(false);
      setNotice(import.meta.env.DEV ? "room server disconnected. run npm run dev:server." : "live room server disconnected. refresh or check service logs.");
    });

    nextSocket.on("connect_error", () => {
      setServerOnline(false);
      setNotice(import.meta.env.DEV ? "waiting for room server. run npm run dev:server." : "waiting for live room server. check the deploy.");
    });

    nextSocket.on("room:update", (nextRoom: RoomState) => {
      setRoom(nextRoom);
      setRoomCodeInput(nextRoom.code);
      if (nextRoom.phase === "lobby") setNotice(`room ${nextRoom.code} created. host can start.`);
      if (nextRoom.phase === "draw") {
        setGuess("");
        setNotice(`step ${nextRoom.submissions.length + 2} / 8. draw what the last person guessed.`);
      }
      if (nextRoom.phase === "guess") setNotice("drawing submitted. guess what survived the handoff.");
      if (nextRoom.phase === "reveal") {
        setNotice("chain saved. copy the share link.");
        refreshArchive();
      }
    });

    nextSocket.on("room:error", (message: string) => {
      setNotice(message);
    });

    setSocket(nextSocket);

    return () => {
      nextSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    refreshArchive();

    const match = window.location.pathname.match(/^\/m\/([^/]+)/);
    if (!match) return;

    setShowHelp(false);
    fetch(`/api/memories/${encodeURIComponent(match[1])}`)
      .then((response) => {
        if (!response.ok) throw new Error("memory not found");
        return response.json();
      })
      .then((data) => {
        setSharedMemory(data.memory);
        setNotice("saved chain loaded.");
      })
      .catch(() => {
        setNotice("that saved chain could not be found.");
      });
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  const phase = sharedMemory ? "reveal" : room?.phase ?? "idle";
  const roomCreated = Boolean(room);
  const gameStarted = !sharedMemory && (phase === "draw" || phase === "guess" || phase === "reveal");
  const isHost = Boolean(room?.players.some((player) => player.id === socket?.id && player.role === "HOST"));
  const prompt = sharedMemory?.prompt ?? room?.prompt ?? "create a room to receive a prompt";
  const submissions = sharedMemory?.submissions ?? room?.submissions ?? [];
  const drawingSubmission = latestSubmission(submissions, "drawing");
  const guessSubmission = latestSubmission(submissions, "guess");
  const drawingUrl = drawingSubmission?.content;
  const currentDrawPrompt = guessSubmission?.content ?? prompt;
  const finalGuess = guessSubmission?.content ?? "";
  const currentStep = Math.min(submissions.length + 2, 8);
  const memoryLoss = sharedMemory?.memoryLoss ?? room?.memoryLoss ?? null;
  const timerMs = room?.phaseEndsAt && (phase === "draw" || phase === "guess") ? new Date(room.phaseEndsAt).getTime() - now : null;
  const timerLabel = formatTimer(timerMs);
  const activeSlug = sharedMemory?.slug ?? room?.slug;
  const shareUrl = shareLink(activeSlug);
  const drawingCount = submissions.filter((submission) => submission.type === "drawing").length;
  const guessCount = submissions.filter((submission) => submission.type === "guess").length;
  const lobbySlots: Player[] = Array.from({ length: 12 }, (_, index) => {
    const player = room?.players[index];
    return player ?? {
      name: `OPEN ${String(index + 1).padStart(2, "0")}`,
      avatar: "empty",
      color: "#1b1b20",
      ready: false,
      empty: true,
    };
  });
  const chain: ChainStep[] = [
    { label: "1. PROMPT", type: "prompt", text: prompt },
    ...submissions.map((submission, index): ChainStep => ({
      label: `${index + 2}. ${phase === "reveal" && index === submissions.length - 1 ? "FINAL" : submission.type === "drawing" ? "DRAWING" : "GUESS"}`,
      type: submission.type,
      text: submission.type === "guess" ? submission.content : undefined,
      imageUrl: submission.type === "drawing" ? submission.content : undefined,
    })),
  ];

  while (chain.length < 8) {
    const nextIndex = chain.length + 1;
    const isDrawing = nextIndex % 2 === 0;
    chain.push({
      label: `${nextIndex}. ${isDrawing ? "DRAWING" : "GUESS"}`,
      type: isDrawing ? "drawing" : "guess",
      text: isDrawing ? undefined : "waiting for guess",
    });
  }

  function createRoom() {
    if (!socket || !serverOnline) {
      setNotice("room server is not connected yet.");
      return;
    }
    setGuess("");
    socket.emit("room:create");
  }

  function joinRoom() {
    if (!socket || !serverOnline) {
      setNotice("room server is not connected yet.");
      return;
    }
    const code = roomCodeInput.trim().toUpperCase();
    if (!code) {
      setNotice("enter a room code to join.");
      return;
    }
    socket.emit("room:join", { code });
  }

  function startGame() {
    if (!socket || !room) return;
    setGuess("");
    socket.emit("game:start", { code: room.code });
  }

  function submitDrawing(imageUrl: string) {
    if (!socket || !room) return;
    socket.emit("submission:drawing", { code: room.code, imageUrl });
  }

  function submitGuess() {
    if (!socket || !room) return;
    socket.emit("submission:guess", { code: room.code, guess });
  }

  async function copyText(kind: "room" | "link", text: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setNotice(kind === "room" ? "room code copied" : "share link copied");
      window.setTimeout(() => setCopied(null), 1400);
    } catch {
      setNotice(text);
    }
  }

  return (
    <main className="app-shell">
      <div className="pixel-motes" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <aside className="hero-rail">
        <div className="logo" aria-label="Bad Memory">
          <span>BAD</span>
          <span>MEMORY</span>
        </div>
        <p className="tagline">The drawing game about what happens when an idea has to survive other people.</p>
        <button className="help-trigger" onClick={() => setShowHelp(true)}>HOW TO PLAY</button>
        <div className="pixel-relics" aria-hidden="true">
          <span className="relic relic--cursor" />
          <span className="relic relic--skull" />
          <span className="relic relic--spark" />
          <span className="relic relic--floppy" />
        </div>
        <button className="primary" disabled={!serverOnline} onClick={createRoom}>{roomCreated ? "✓ ROOM CREATED" : "▶ CREATE ROOM"}</button>
        <input
          className="room-code-input"
          value={roomCodeInput}
          maxLength={8}
          onChange={(event) => setRoomCodeInput(event.target.value.toUpperCase())}
          placeholder="ROOM CODE"
          aria-label="Room code"
        />
        <button className="secondary" disabled={!serverOnline} onClick={joinRoom}>⌕ JOIN ROOM</button>
        <p className={serverOnline ? "prototype-status" : "prototype-status prototype-status--offline"} role="status">{notice}</p>
      </aside>

      <section className="main-grid">
        <section className="panel lobby">
          <header className="lobby-bar">
            <strong>LOBBY</strong>
            <span>{sharedMemory ? "SAVED CHAIN" : "ROOM CODE"}: <b>{sharedMemory?.slug ?? room?.code ?? "------"}</b></span>
            <button disabled={!room} onClick={() => room && copyText("room", room.code)}>{copied === "room" ? "COPIED" : "COPY"}</button>
            <em>{room?.players.length ?? 0} / 12 PLAYERS</em>
          </header>
          <div className={roomCreated ? "player-row" : "player-row waiting-players"}>
            {lobbySlots.map((player, index) => (
              <div className={player.empty ? "player player--empty" : "player"} key={`${player.name}-${index}`}>
                <PixelAvatar avatar={player.avatar} color={player.color} />
                <span>{player.name}</span>
                <b>{player.empty ? "EMPTY" : roomCreated ? (player.role ? `(${player.role})` : "CONNECTED") : "EMPTY"}</b>
              </div>
            ))}
          </div>
          <div className="lobby-actions">
            <p className="waiting">
              {sharedMemory && "viewing a saved chain"}
              {!sharedMemory && phase === "idle" && "create or join a room to start"}
              {!sharedMemory && phase === "lobby" && "waiting for host to start the game..."}
              {!sharedMemory && gameStarted && "game in progress"}
            </p>
            <button className="hot" disabled={phase !== "lobby" || !isHost} onClick={startGame}>
              {gameStarted ? "GAME STARTED" : "START GAME"}
            </button>
          </div>
        </section>

        <div className="round-grid">
          <DrawingCanvas isActive={phase === "draw"} prompt={currentDrawPrompt} roundNumber={currentStep} timerLabel={timerLabel} onSubmit={submitDrawing} />
          <section className={phase === "guess" ? "panel game-panel active-round" : "panel game-panel dimmed-round"}>
            <header className="panel-title">
              <span>STEP {currentStep} / 8</span>
              <span>GUESS</span>
              <time>{phase === "guess" ? timerLabel : "--:--"}</time>
            </header>
            <p className="prompt">WHAT IS THIS?</p>
            {phase === "guess" ? <SubmittedDrawing src={drawingUrl} large /> : <div className="submitted-drawing submitted-drawing--large empty-drawing"><span>waiting for a drawing</span></div>}
            <textarea
              value={guess}
              maxLength={120}
              onChange={(event) => setGuess(event.target.value)}
              aria-label="Guess"
            />
            <footer className="panel-actions">
              <span>{guess.length} / 120</span>
              <button className="hot" disabled={phase !== "guess" || guess.trim().length === 0} onClick={submitGuess}>SUBMIT</button>
            </footer>
          </section>
        </div>

        <section className={phase === "reveal" ? "panel reveal active-round" : "panel reveal dimmed-round"}>
            <header>
              <h2>THE REVEAL</h2>
            <span>CHAIN #{activeSlug ?? "-----"}</span>
            <strong>MEMORY LOSS: <b>{phase === "reveal" && memoryLoss !== null ? `${memoryLoss}%` : "--"}</b></strong>
          </header>
          <div className="chain">
            {chain.map((step, index) => (
              <div className="chain-node" key={step.label}>
                <span>{step.label}</span>
                <div className="chain-card">
                  {step.text ? <p>{step.text}</p> : <SubmittedDrawing src={step.imageUrl} />}
                </div>
                {index < chain.length - 1 && <i>→</i>}
              </div>
            ))}
          </div>
        </section>

        <section className="bottom-grid">
          <section className={phase === "reveal" ? "panel share-card" : "panel share-card locked-card"}>
            <h2>RESULT SNAPSHOT</h2>
            <div className="ticket">
              <div>
                <small>STARTED AS:</small>
                <p>{prompt}</p>
              </div>
              <b>→</b>
              <div>
                <small>ENDED AS:</small>
                <p>{phase === "reveal" ? finalGuess || "final drawing" : "waiting for chain to finish"}</p>
              </div>
              <strong>{phase === "reveal" && memoryLoss !== null ? `${memoryLoss}%` : "--"}</strong>
            </div>
            <footer>
              <code>{phase === "reveal" ? shareUrl : "complete a chain to unlock a share link"}</code>
              <button disabled={phase !== "reveal" || !shareUrl} onClick={() => copyText("link", shareUrl)}>{copied === "link" ? "COPIED" : "COPY LINK"}</button>
            </footer>
          </section>

          <section className="panel stats">
            <h2>STATS</h2>
            <dl>
              <dt>mode</dt><dd>live test</dd>
              <dt>players</dt><dd>{room?.players.length ?? 0}</dd>
              <dt>drawings</dt><dd>{drawingCount}</dd>
              <dt>guesses</dt><dd>{guessCount}</dd>
              <dt>memory loss</dt><dd>{phase === "reveal" && memoryLoss !== null ? `${memoryLoss}%` : "--"}</dd>
              <dt>status</dt><dd>{phase}</dd>
            </dl>
          </section>

          <section className="panel gallery">
            <header>
              <h2>ARCHIVE <small>(SOON)</small></h2>
              <nav>
                <button className="hot" disabled>NEWEST SAVED</button>
              </nav>
            </header>
            {archiveMemories.length > 0 ? (
              <div className="gallery-row">
                {archiveMemories.slice(0, 5).map((memory) => {
                  const preview = latestSubmission(memory.submissions, "drawing")?.content;
                  return (
                    <article key={memory.slug}>
                      <SubmittedDrawing src={preview} />
                      <p>{memory.prompt}</p>
                      <footer>
                        <b>{memory.memoryLoss ?? "--"}%</b>
                        <a href={`/m/${memory.slug}`}>OPEN</a>
                      </footer>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="archive-empty">
                <div className="archive-pixel-stamp" aria-hidden="true">
                  <span />
                </div>
                <div>
                  <strong>No saved memories yet.</strong>
                  <p>Completed chains will appear here after the reveal.</p>
                </div>
              </div>
            )}
          </section>
        </section>

        <footer className="site-footer">
          <span>© 2026 BAD MEMORY</span>
          <span>LIVE TEST BUILD</span>
          <span>NO ACCOUNTS</span>
          <span>SAVED CHAINS ENABLED</span>
          <strong>☻</strong>
        </footer>
      </section>

      {showHelp && (
        <div className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title">
          <div className="help-card">
            <button className="help-close" onClick={() => setShowHelp(false)} aria-label="Close instructions">×</button>
            <h1 id="help-title">HOW BAD MEMORY WORKS</h1>
            <ol>
              <li>Create a room, then share the room code.</li>
              <li>One player draws the prompt before the timer runs out.</li>
              <li>The next player guesses what the drawing is.</li>
              <li>The game keeps alternating draw and guess until the reveal.</li>
            </ol>
            <p>Play in two browser windows or send the room code to someone else. For the cleanest test, join everyone before pressing Start Game.</p>
            <button className="hot" onClick={() => setShowHelp(false)}>START TESTING</button>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
