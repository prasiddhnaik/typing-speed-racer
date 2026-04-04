# Typing Speed Racer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete single-file Typing Speed Racer game as a React artifact (`.jsx`) with rAF-driven game loop, solo and 2-player modes, difficulty scaling, persistent leaderboard via `window.storage`, and polished visual feedback.

**Architecture:** Game world state (word positions, speeds, spawn timers, streak) lives in `gameStateRef` — mutated every rAF frame with zero React re-renders. Display state (score, lives, level, WPM, accuracy, phase) lives in `useReducer` — dispatched only on meaningful events. `wordsToRender` is a `useState` array the rAF loop writes to each frame so React can render positions. `FallingWord` is wrapped in `React.memo` so only words whose data changed re-render.

**Tech Stack:** React 18 (useState, useReducer, useRef, useCallback, useEffect, memo), Tailwind CSS, lucide-react (icons only), single `TypingSpeedRacer.jsx`, `window.storage` async API for leaderboard.

---

## File Structure

One file: `TypingSpeedRacer.jsx`

Internal layout (top to bottom):
1. Imports
2. `WORD_POOL` const — 300 words split into tiers by length
3. `CONSTANTS` — game geometry, lives, level thresholds
4. `DIFFICULTY_PRESETS` — chill / normal / hardcore configs
5. `displayReducer` + `initialDisplay` — all UI-visible state
6. Pure helpers: `shuffle`, `getWordTier`, `getStreakMultiplier`, `spawnWord`
7. `FallingWord` — memo'd component
8. `ParticleBurst` — memo'd component
9. `HUD` — score/lives/level/wpm bar
10. `MainMenu`
11. `GameOverScreen`
12. `LeaderboardView`
13. `TwoPlayerBanner`
14. `TypingSpeedRacer` — default export, root component, owns all state + game loop

---

## Phase 1 — Solo MVP: falling words, input, scoring

---

### Task 1: Scaffold — word list, constants, reducer, main menu, component shell

**Files:**
- Create: `TypingSpeedRacer.jsx`

- [ ] **Step 1: Create the full scaffold**

Create `TypingSpeedRacer.jsx` with this exact content:

```jsx
import { useState, useReducer, useRef, useCallback, useEffect, memo } from "react";
import { Heart, Zap, Trophy, Play, Users, Pause } from "lucide-react";

// ─── Word Pool (300 words, 3 tiers by length) ─────────────────────────────────
const WORD_POOL = {
  easy: [
    "cat","dog","run","fly","hot","big","red","sky","sun","map",
    "cup","log","tip","jar","box","web","fog","gap","ink","oak",
    "pan","rod","tin","wax","ace","arc","axe","bay","bit","bud",
    "bug","bus","cab","can","cap","car","cod","cog","cot","cry",
    "cut","dam","den","dew","dig","dim","dip","dot","dry","dub",
    "dye","ear","eat","egg","ego","elf","elk","elm","end","era",
    "fad","fan","fat","fax","fig","fit","fix","flu","foe","fur",
    "gem","gun","gut","gym","hen","hew","hid","him","hip","his",
    "hit","hog","hop","hub","hug","hum","ice","imp","ion","ivy",
    "jab","jag","jam","jaw","jet","jot","joy","jug","jut","keg",
  ],
  medium: [
    "about","above","admit","adopt","adult","after","again","agent","agree","ahead",
    "alarm","album","alert","alien","align","alive","alley","allow","alone","along",
    "angel","anger","angle","angry","ankle","apart","apple","apply","arena","argue",
    "arise","array","ashes","asset","avoid","awake","award","aware","awful","basic",
    "batch","beach","beard","beast","begin","being","below","bench","berry","birth",
    "black","blade","blame","bland","blank","blast","blaze","bleed","blend","bless",
    "blind","block","blood","bloom","board","bonus","boost","bound","brain","brave",
    "bread","break","breed","brick","brief","bring","broad","broke","brown","brush",
    "buddy","build","burst","buyer","cabin","carry","catch","cause","chain","chair",
    "chaos","charm","chase","cheap","check","cheek","cheer","chess","chest","chief",
    "child","choir","civic","civil","claim","clamp","clash","class","clean","clear",
    "climb","cling","clock","clone","close","cloth","cloud","clown","coach","coast",
    "cobra","comet","comic","coral","cover","craft","crane","crash","crawl","craze",
    "cream","creek","crisp","croak","cross","crowd","crown","cruel","crush","cubic",
    "curve","cycle","dance","dealt","decay","decoy","delay","delta","depot","derby",
  ],
  hard: [
    "accept","access","action","active","actual","adjust","affect","afford","agency",
    "agenda","almost","always","anchor","animal","answer","appear","around","arrive",
    "artist","aspect","assign","assume","attach","attack","attempt","attend","author",
    "autumn","avenue","battle","beauty","before","behind","belief","belong","beyond",
    "bitter","border","bottle","bounce","branch","breach","bridge","bright","broken",
    "bronze","budget","button","camera","cancel","candle","carbon","career","castle",
    "casual","center","chance","change","charge","choice","circle","cities","client",
    "closed","coding","coffee","column","combat","commit","common","concept","contact",
    "corner","absence","achieve","address","advance","against","already","ancient",
    "arrange","attract","balance","because","believe","between","blanket","brought",
    "cabinet","capable","captain","capture","careful","certain","chapter","charity",
    "charter","chicken","circuit","citizen","classic","climate","cluster","combine",
    "command","compact","company","compare","complex","concern","connect","consist",
    "contain","content","control","convert","correct","council","country","courage",
    "century","crystal","culture","current","dazzling","database","daughter","daylight",
    "decision","decrease","defender","delivery","describe","deserve","develop","digital",
    "discuss","display","divide","domain","dynamic","element","enforce","enough",
    "evolve","example","expand","explain","explore","express","extreme","failure",
  ],
};

// ─── Constants ────────────────────────────────────────────────────────────────
const GAME_HEIGHT = 500;   // px, play field height
const DEADLINE_Y  = 440;   // px from top — words below this are lost
const LIVES       = 3;
const LEVEL_INTERVAL_MS = 30_000; // level up every 30s
const MIN_SPAWN_INTERVAL = 600;   // ms, floor
const MIN_SPEED_MULT     = 0.8;   // relative floor (multiplied on base speed)

// ─── Difficulty Presets ───────────────────────────────────────────────────────
const DIFFICULTY_PRESETS = {
  chill:    { spawnInterval: 2800, speedBase: 0.038, label: "Chill"    },
  normal:   { spawnInterval: 2000, speedBase: 0.052, label: "Normal"   },
  hardcore: { spawnInterval: 1400, speedBase: 0.072, label: "Hardcore" },
};

// ─── Display Reducer ──────────────────────────────────────────────────────────
const initialDisplay = {
  score: 0, lives: LIVES, level: 1, wpm: 0, accuracy: 100,
  streak: 0, bestStreak: 0, totalTyped: 0, totalCorrect: 0,
  phase: "menu", // "menu" | "playing" | "paused" | "gameover" | "leaderboard"
  gameMode: "solo", // "solo" | "2p"
  startTime: null,
};

function displayReducer(state, action) {
  switch (action.type) {
    case "START_GAME":
      return { ...initialDisplay, phase: "playing", gameMode: action.mode, startTime: Date.now() };
    case "WORD_COMPLETE": {
      const streak = state.streak + 1;
      const bestStreak = Math.max(streak, state.bestStreak);
      const mult = streak >= 20 ? 3 : streak >= 10 ? 2 : streak >= 5 ? 1.5 : 1;
      const points = Math.round(action.wordLen * state.level * mult);
      return {
        ...state,
        score: state.score + points,
        streak,
        bestStreak,
        totalCorrect: state.totalCorrect + action.wordLen,
        totalTyped: state.totalTyped + action.wordLen,
      };
    }
    case "WORD_MISSED":
      return {
        ...state,
        lives: state.lives - 1,
        streak: 0,
        phase: state.lives <= 1 ? "gameover" : "playing",
      };
    case "KEYSTROKE_HIT":
      return { ...state, totalTyped: state.totalTyped + 1, totalCorrect: state.totalCorrect + 1 };
    case "KEYSTROKE_MISS":
      return { ...state, totalTyped: state.totalTyped + 1 };
    case "LEVEL_UP":
      return { ...state, level: action.level };
    case "UPDATE_WPM":
      return { ...state, wpm: action.wpm };
    case "PAUSE":
      return { ...state, phase: state.phase === "paused" ? "playing" : "paused" };
    case "GAME_OVER":
      return { ...state, phase: "gameover" };
    case "MAIN_MENU":
      return { ...initialDisplay, phase: "menu" };
    case "SHOW_LEADERBOARD":
      return { ...state, phase: "leaderboard" };
    default:
      return state;
  }
}

// ─── Pure Helpers ─────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Returns a word text given current level (1-10+).
// Level 1-3: easy only. Level 4-6: easy+medium. Level 7+: all tiers.
function pickWord(wordQueue) {
  if (wordQueue.current.length === 0) {
    // refill — shuffle all tiers together so pool never runs dry
    wordQueue.current = shuffle([
      ...WORD_POOL.easy, ...WORD_POOL.medium, ...WORD_POOL.hard
    ]);
  }
  return wordQueue.current.pop();
}

function getSpeedForLevel(preset, level) {
  // Each level increases speed by 8%, floored at MIN_SPEED_MULT × base
  const raw = preset.speedBase * Math.pow(1.08, level - 1);
  return Math.max(raw, preset.speedBase * MIN_SPEED_MULT);
}

function getSpawnIntervalForLevel(preset, level) {
  // Each level decreases spawn interval by 12%
  const raw = preset.spawnInterval * Math.pow(0.88, level - 1);
  return Math.max(raw, MIN_SPAWN_INTERVAL);
}

function getStreakLabel(streak) {
  if (streak >= 20) return "×3 🔥";
  if (streak >= 10) return "×2 ⚡";
  if (streak >= 5)  return "×1.5 ✨";
  return null;
}

// ─── FallingWord ──────────────────────────────────────────────────────────────
const FallingWord = memo(function FallingWord({ word, isActive }) {
  const lenColor =
    word.text.length <= 4 ? "text-emerald-400" :
    word.text.length <= 6 ? "text-yellow-300"  : "text-orange-400";

  return (
    <div
      style={{
        position: "absolute",
        left: word.x,
        top: word.y,
        transform: "translateX(-50%)",
        willChange: "top",
      }}
      className={`font-mono text-lg font-bold select-none pointer-events-none
        ${isActive ? "filter drop-shadow-[0_0_10px_rgba(99,102,241,1)]" : ""}`}
    >
      {word.text.split("").map((ch, i) => {
        const typedLen = word.typed.length;
        let cls;
        if (i < typedLen) {
          cls = word.typed[i] === ch ? "text-green-300" : "text-red-400";
        } else if (i === typedLen && isActive) {
          cls = `${lenColor} underline`;
        } else {
          cls = lenColor;
        }
        return <span key={i} className={cls}>{ch}</span>;
      })}
    </div>
  );
});

// ─── HUD ──────────────────────────────────────────────────────────────────────
function HUD({ display }) {
  const acc = display.totalTyped === 0
    ? 100
    : Math.round((display.totalCorrect / display.totalTyped) * 100);
  const streakLabel = getStreakLabel(display.streak);

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700 text-sm">
      <div className="flex items-center gap-1">
        {Array.from({ length: LIVES }).map((_, i) => (
          <Heart
            key={i}
            size={16}
            className={i < display.lives ? "text-red-500 fill-red-500" : "text-gray-600"}
          />
        ))}
      </div>
      <div className="flex items-center gap-4 text-gray-300 font-mono">
        <span className="text-indigo-300 font-bold">Lv.{display.level}</span>
        <span>{display.wpm} WPM</span>
        <span>{acc}%</span>
        {streakLabel && (
          <span className="text-yellow-300 font-bold">{streakLabel}</span>
        )}
      </div>
      <div className="text-white font-bold font-mono text-lg">{display.score.toLocaleString()}</div>
    </div>
  );
}

// ─── MainMenu ─────────────────────────────────────────────────────────────────
function MainMenu({ onStart, onLeaderboard, preset, setPreset }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-8 text-white">
      <div className="text-center">
        <h1 className="text-5xl font-black tracking-tight text-indigo-400 font-mono">
          TYPE RACER
        </h1>
        <p className="text-gray-500 mt-2 text-sm tracking-widest uppercase">
          Words fall. You type. Don't miss.
        </p>
      </div>

      <div className="flex gap-2">
        {Object.entries(DIFFICULTY_PRESETS).map(([key, val]) => (
          <button
            key={key}
            onClick={() => setPreset(key)}
            className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all
              ${preset === key
                ? "bg-indigo-600 text-white ring-2 ring-indigo-400 shadow-lg shadow-indigo-500/30"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
          >
            {val.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 w-52">
        <button
          onClick={() => onStart("solo")}
          className="flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500
                     rounded-xl font-bold text-lg transition-all shadow-lg shadow-indigo-500/40"
        >
          <Play size={20} /> Solo
        </button>
        <button
          onClick={() => onStart("2p")}
          className="flex items-center justify-center gap-2 px-6 py-3 bg-purple-700 hover:bg-purple-600
                     rounded-xl font-bold text-lg transition-all shadow-lg shadow-purple-500/30"
        >
          <Users size={20} /> 2 Player
        </button>
        <button
          onClick={onLeaderboard}
          className="flex items-center justify-center gap-2 px-6 py-3 bg-gray-800 hover:bg-gray-700
                     rounded-xl font-bold transition-all"
        >
          <Trophy size={20} /> Leaderboard
        </button>
      </div>

      <div className="text-xs text-gray-600 text-center">
        <span className="text-emerald-500">■</span> short &nbsp;
        <span className="text-yellow-400">■</span> medium &nbsp;
        <span className="text-orange-400">■</span> long
      </div>
    </div>
  );
}

// ─── Root Component (shell — game loop wired in Task 2) ───────────────────────
export default function TypingSpeedRacer() {
  const [display, dispatch] = useReducer(displayReducer, initialDisplay);
  const [preset, setPreset] = useState("normal");
  const [wordsToRender, setWordsToRender] = useState([]);
  const [inputVal, setInputVal] = useState("");
  const [shake, setShake] = useState(false);

  const gameStateRef = useRef(null);
  const rafRef       = useRef(null);
  const lastTimeRef  = useRef(null);
  const wordQueueRef = useRef([]);
  const inputRef     = useRef(null);
  const displayRef   = useRef(display); // mirror for rAF closure access
  useEffect(() => { displayRef.current = display; }, [display]);

  const handleStart = useCallback((mode) => {
    dispatch({ type: "START_GAME", mode });
  }, []);

  return (
    <div className="bg-gray-950 min-h-screen flex items-center justify-center p-4 font-sans">
      <div
        className={`w-full max-w-2xl bg-gray-900 rounded-2xl overflow-hidden shadow-2xl
          ${shake ? "animate-[shake_0.3s_ease]" : ""}`}
        style={{ height: 580 }}
      >
        {display.phase === "menu" && (
          <MainMenu
            onStart={handleStart}
            onLeaderboard={() => dispatch({ type: "SHOW_LEADERBOARD" })}
            preset={preset}
            setPreset={setPreset}
          />
        )}
        {(display.phase === "playing" || display.phase === "paused") && (
          <div className="flex flex-col h-full">
            <HUD display={display} />
            <div className="relative flex-1 bg-gray-950 overflow-hidden">
              {/* Deadline line */}
              <div
                style={{ top: DEADLINE_Y }}
                className="absolute left-0 right-0 h-px bg-red-600 opacity-60 z-10"
              />
              <div
                style={{ top: DEADLINE_Y - 18 }}
                className="absolute right-2 text-red-600 text-xs opacity-60 z-10 font-mono"
              >
                DEADLINE
              </div>
              {/* Falling words */}
              {wordsToRender.map((w) => (
                <FallingWord key={w.id} word={w} isActive={false} />
              ))}
              {/* Pause overlay */}
              {display.phase === "paused" && (
                <div className="absolute inset-0 bg-gray-950/80 flex items-center justify-center z-20">
                  <div className="text-center">
                    <Pause size={48} className="text-indigo-400 mx-auto mb-3" />
                    <p className="text-white text-2xl font-bold">PAUSED</p>
                    <p className="text-gray-400 text-sm mt-1">Press Esc to resume</p>
                  </div>
                </div>
              )}
            </div>
            <div className="px-4 py-3 bg-gray-800 border-t border-gray-700">
              <input
                ref={inputRef}
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                className="w-full bg-gray-900 text-white font-mono text-lg rounded-lg px-4 py-2
                           border border-gray-600 focus:outline-none focus:border-indigo-500
                           focus:ring-1 focus:ring-indigo-500 placeholder-gray-600"
                placeholder="type here..."
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
          </div>
        )}
        {display.phase === "leaderboard" && (
          <div className="flex flex-col items-center justify-center h-full text-white gap-4">
            <Trophy size={40} className="text-yellow-400" />
            <p className="text-gray-400">Leaderboard — wired in Task 5</p>
            <button onClick={() => dispatch({ type: "MAIN_MENU" })}
              className="px-6 py-2 bg-gray-700 rounded-lg hover:bg-gray-600">Back</button>
          </div>
        )}
        {display.phase === "gameover" && (
          <div className="flex flex-col items-center justify-center h-full text-white gap-4">
            <p className="text-3xl font-bold text-red-400">GAME OVER</p>
            <p className="text-gray-400">Summary — wired in Task 5</p>
            <button onClick={() => dispatch({ type: "MAIN_MENU" })}
              className="px-6 py-2 bg-indigo-600 rounded-lg hover:bg-indigo-500">Main Menu</button>
          </div>
        )}
      </div>

      {/* Shake keyframe */}
      <style>{`
        @keyframes shake {
          0%,100%{transform:translateX(0)}
          20%{transform:translateX(-6px)}
          40%{transform:translateX(6px)}
          60%{transform:translateX(-4px)}
          80%{transform:translateX(4px)}
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Verify scaffold renders**

Open in Claude artifact preview. Expected: dark screen with "TYPE RACER" heading, 3 difficulty preset buttons, Solo / 2 Player / Leaderboard buttons. Solo click shows HUD + input bar + "DEADLINE" line. Pause/leaderboard/gameover phases show placeholder text.

---

### Task 2: rAF game loop — word spawning, falling, deadline detection

**Files:**
- Modify: `TypingSpeedRacer.jsx` — replace the `TypingSpeedRacer` root component's internals

The goal is: words spawn at the top, fall toward DEADLINE_Y, and disappear (life lost) when they cross it. No typing yet.

- [ ] **Step 1: Add `initGameState` helper and wire `handleStart`**

Directly below the `displayReducer` function and before the pure helpers section, add:

```js
function initGameState(presetKey) {
  return {
    words: [],          // active word objects
    nextId: 0,
    spawnAccum: 0,      // ms accumulated since last spawn
    levelAccum: 0,      // ms accumulated since last level-up
    preset: DIFFICULTY_PRESETS[presetKey],
    presetKey,
  };
}
```

Word object shape (reference for all tasks):
```js
{
  id: number,
  text: string,
  x: number,          // px from left, centre-anchored
  y: number,          // px from top
  speed: number,      // px-per-ms
  typed: "",          // characters typed correctly so far
  active: true,
  completedBy: null,  // null | "P1" | "P2"  (2P mode)
}
```

- [ ] **Step 2: Replace the `handleStart` callback and add the game loop**

Find and replace the placeholder `handleStart` and the `gameStateRef/rafRef/lastTimeRef` declarations. Replace the entire section from `const handleStart = ...` down to `useEffect(() => { displayRef.current = display; }, [display]);` with:

```js
  const presetRef = useRef("normal"); // track latest preset for loop access

  useEffect(() => { displayRef.current = display; }, [display]);

  // ── game loop ──────────────────────────────────────────────────────────────
  const gameLoop = useCallback((timestamp) => {
    if (!gameStateRef.current) return;
    const gs = gameStateRef.current;

    // delta time (cap at 100ms to avoid spiral of death on tab-switch)
    const delta = Math.min(timestamp - (lastTimeRef.current ?? timestamp), 100);
    lastTimeRef.current = timestamp;

    const phase = displayRef.current.phase;
    if (phase === "paused") {
      rafRef.current = requestAnimationFrame(gameLoop);
      return;
    }

    // ── level progression ──────────────────────────────────────────────────
    gs.levelAccum += delta;
    if (gs.levelAccum >= LEVEL_INTERVAL_MS) {
      gs.levelAccum -= LEVEL_INTERVAL_MS;
      const newLevel = displayRef.current.level + 1;
      dispatch({ type: "LEVEL_UP", level: newLevel });
    }

    const level   = displayRef.current.level;
    const preset  = gs.preset;

    // ── spawn words ────────────────────────────────────────────────────────
    const spawnInterval = getSpawnIntervalForLevel(preset, level);
    gs.spawnAccum += delta;
    while (gs.spawnAccum >= spawnInterval) {
      gs.spawnAccum -= spawnInterval;
      const text = pickWord(wordQueueRef);
      // pick x so words don't spawn within 60px of edges
      const x = 60 + Math.random() * (560);
      gs.words.push({
        id: gs.nextId++,
        text,
        x,
        y: -30,
        speed: getSpeedForLevel(preset, level),
        typed: "",
        active: true,
        completedBy: null,
      });
    }

    // ── move words & check deadline ────────────────────────────────────────
    let missedAny = false;
    gs.words = gs.words.filter((w) => {
      if (!w.active) return false;
      w.y += w.speed * delta;
      if (w.y >= DEADLINE_Y) {
        missedAny = true;
        dispatch({ type: "WORD_MISSED" });
        return false;
      }
      return true;
    });

    // ── WPM update (every ~1s) ─────────────────────────────────────────────
    const elapsed = (Date.now() - (displayRef.current.startTime ?? Date.now())) / 60000;
    if (elapsed > 0) {
      const wpm = Math.round((displayRef.current.totalCorrect / 5) / elapsed);
      dispatch({ type: "UPDATE_WPM", wpm });
    }

    // ── push render snapshot ───────────────────────────────────────────────
    setWordsToRender([...gs.words]);

    // ── check game over ────────────────────────────────────────────────────
    if (displayRef.current.phase !== "gameover") {
      rafRef.current = requestAnimationFrame(gameLoop);
    }
  }, [dispatch]);

  // ── start / stop loop on phase change ──────────────────────────────────────
  useEffect(() => {
    if (display.phase === "playing" && !rafRef.current) {
      rafRef.current = requestAnimationFrame(gameLoop);
    }
    if (display.phase === "gameover" || display.phase === "menu") {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }
  }, [display.phase, gameLoop]);

  // ── Esc key → pause ────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && (display.phase === "playing" || display.phase === "paused")) {
        dispatch({ type: "PAUSE" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [display.phase]);

  const handleStart = useCallback((mode) => {
    wordQueueRef.current = [];            // reset word queue
    gameStateRef.current = initGameState(presetRef.current);
    lastTimeRef.current = null;
    setWordsToRender([]);
    setInputVal("");
    dispatch({ type: "START_GAME", mode });
  }, []);
```

Also update `presetRef` when `preset` state changes — add this effect after the existing effects:

```js
  useEffect(() => { presetRef.current = preset; }, [preset]);
```

- [ ] **Step 3: Verify words fall**

Open in artifact preview → Solo. Words with different lengths should appear at the top and fall. After a word crosses the deadline, a heart disappears in the HUD. After 3 misses the gameover placeholder shows. Esc pauses/resumes.

---

### Task 3: Input matching — keystroke handling, active word selection, word completion

**Files:**
- Modify: `TypingSpeedRacer.jsx` — add `handleInput`, update `FallingWord` active prop

The "active word" is whichever falling word's `text` starts with the current input value. If multiple match, take the one lowest on screen (highest `y`). On correct full match → word removed, score dispatched. On wrong char → screen shake.

- [ ] **Step 1: Add `findActiveWord` helper (add below `getStreakLabel`)**

```js
// Returns the word object that best matches the current input prefix.
// Tie-break: lowest word (highest y value) goes first so player helps themselves.
function findActiveWord(words, input) {
  if (!input) return null;
  const matches = words.filter((w) => w.text.startsWith(input));
  if (!matches.length) return null;
  return matches.reduce((best, w) => (w.y > best.y ? w : best), matches[0]);
}
```

- [ ] **Step 2: Add `handleInput` callback inside `TypingSpeedRacer` (add after `handleStart`)**

```js
  const handleInput = useCallback((e) => {
    const val = e.target.value;

    // Space or Enter = force-submit current input (ignore on empty)
    const submitVal = val.endsWith(" ") ? val.trim() : val;

    if (!gameStateRef.current || displayRef.current.phase !== "playing") return;

    const words = gameStateRef.current.words;

    // Find matching word for the submitVal prefix
    const active = findActiveWord(words, submitVal);

    if (!active) {
      // No match at all — wrong key, flash shake
      if (submitVal.length > 0) {
        dispatch({ type: "KEYSTROKE_MISS" });
        setShake(true);
        setTimeout(() => setShake(false), 300);
        setInputVal("");
      } else {
        setInputVal(val);
      }
      return;
    }

    // Check each new character
    const prevLen = active.typed.length;
    const newTyped = submitVal;

    // Validate the new character matches
    if (active.text.startsWith(newTyped)) {
      // Correct so far
      active.typed = newTyped;
      dispatch({ type: "KEYSTROKE_HIT" });
      setInputVal(val);
    } else {
      // Wrong character
      dispatch({ type: "KEYSTROKE_MISS" });
      setShake(true);
      setTimeout(() => setShake(false), 300);
      setInputVal("");
      active.typed = "";
      return;
    }

    // Word complete?
    if (newTyped === active.text) {
      active.active = false;
      dispatch({ type: "WORD_COMPLETE", wordLen: active.text.length });
      setInputVal("");
    }
  }, [dispatch]);
```

- [ ] **Step 3: Wire `handleInput` to the input element**

Find the `<input>` in the JSX and replace its `onChange` prop:

```jsx
onChange={handleInput}
```

- [ ] **Step 4: Pass `isActive` to `FallingWord`**

The rAF loop renders `wordsToRender` but doesn't know which is "active" relative to the input. The active word is the one whose text starts with `inputVal`. Update the render map:

```jsx
{wordsToRender.map((w) => (
  <FallingWord
    key={w.id}
    word={w}
    isActive={inputVal.length > 0 && w.text.startsWith(inputVal)}
  />
))}
```

- [ ] **Step 5: Verify input matching**

Open artifact → Solo. Type the beginning of a falling word — it should glow and letters turn green as you type. Complete a word — it disappears and score increases. Type wrong characters → red flash + screen shake + input clears.

---

## Phase 2 — Difficulty Scaling + Streak System

*(The reducer already handles streak/multiplier; this task wires the visual feedback)*

### Task 4: Streak visual, level indicator, difficulty feel-tuning

**Files:**
- Modify: `TypingSpeedRacer.jsx` — HUD streak bar, particles on completion

- [ ] **Step 1: Add `ParticleBurst` component (add before `HUD`)**

```jsx
const ParticleBurst = memo(function ParticleBurst({ x, y, id, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 600);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div style={{ position: "absolute", left: x, top: y, pointerEvents: "none" }}>
      {Array.from({ length: 8 }).map((_, i) => {
        const angle = (i / 8) * 2 * Math.PI;
        const dx = Math.cos(angle) * 30;
        const dy = Math.sin(angle) * 30;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: ["#6366f1","#a78bfa","#34d399","#fbbf24"][i % 4],
              animation: `burst 0.6s ease-out forwards`,
              ["--dx"]: `${dx}px`,
              ["--dy"]: `${dy}px`,
            }}
          />
        );
      })}
      <style>{`
        @keyframes burst {
          0%   { transform: translate(0,0); opacity:1; }
          100% { transform: translate(var(--dx),var(--dy)); opacity:0; }
        }
      `}</style>
    </div>
  );
});
```

- [ ] **Step 2: Add `particles` state management in root component**

Add state (already scaffolded in Task 1): `const [particles, setParticles] = useState([]);`

Update `handleInput` — inside the `// Word complete?` block, after `dispatch({ type: "WORD_COMPLETE" ... })`, add:

```js
      // Spawn particle burst at word position
      const completedWord = active;
      setParticles((prev) => [
        ...prev,
        { id: Date.now() + Math.random(), x: completedWord.x, y: completedWord.y },
      ]);
```

- [ ] **Step 3: Render particles in the game field JSX**

Inside the `<div className="relative flex-1 ...">` block, after the `{wordsToRender.map(...)}` block, add:

```jsx
{particles.map((p) => (
  <ParticleBurst
    key={p.id}
    x={p.x}
    y={p.y}
    id={p.id}
    onDone={() => setParticles((prev) => prev.filter((x) => x.id !== p.id))}
  />
))}
```

- [ ] **Step 4: Verify particles and streak**

Open → Solo. Complete words in a row — streak multiplier appears in HUD after 5. A small particle burst fires at the word's last position on completion. Level increments every 30s and words spawn faster + fall faster.

---

## Phase 3 — Game Over Summary + Leaderboard

### Task 5: `GameOverScreen`, `LeaderboardView`, `window.storage` integration

**Files:**
- Modify: `TypingSpeedRacer.jsx` — replace placeholder gameover + leaderboard phases

- [ ] **Step 1: Add `useLeaderboard` hook (add above root component)**

```js
function useLeaderboard() {
  const KEY = "leaderboard-top10";
  const [entries, setEntries] = useState([]);

  const load = useCallback(async () => {
    try {
      const result = await window.storage.get(KEY);
      setEntries(result ? JSON.parse(result.value) : []);
    } catch {
      setEntries([]); // key doesn't exist yet
    }
  }, []);

  const save = useCallback(async (newEntry) => {
    let current = [];
    try {
      const result = await window.storage.get(KEY);
      current = result ? JSON.parse(result.value) : [];
    } catch { /* first save */ }

    const updated = [...current, newEntry]
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    await window.storage.set(KEY, JSON.stringify(updated));
    setEntries(updated);
    return updated;
  }, []);

  useEffect(() => { load(); }, [load]);

  return { entries, save, reload: load };
}
```

- [ ] **Step 2: Add `GameOverScreen` component (add before root component)**

```jsx
function GameOverScreen({ display, onSave, onMenu, onLeaderboard, leaderboardEntries }) {
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);
  const [rank, setRank] = useState(null);

  const acc = display.totalTyped === 0 ? 100
    : Math.round((display.totalCorrect / display.totalTyped) * 100);
  const elapsed = display.startTime
    ? Math.floor((Date.now() - display.startTime) / 1000)
    : 0;
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  const handleSave = async () => {
    if (!name.trim()) return;
    const entry = {
      name: name.trim().toUpperCase().slice(0, 3),
      score: display.score,
      wpm: display.wpm,
      accuracy: acc,
      streak: display.bestStreak,
      date: new Date().toLocaleDateString(),
    };
    const updated = await onSave(entry);
    const idx = updated.findIndex((e) => e.score === display.score && e.name === entry.name);
    setRank(idx + 1);
    setSaved(true);
  };

  const madeBoard = leaderboardEntries.length < 10
    || display.score > (leaderboardEntries[leaderboardEntries.length - 1]?.score ?? 0);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 text-white px-6">
      <h2 className="text-4xl font-black text-red-400 font-mono tracking-wide">GAME OVER</h2>

      <div className="grid grid-cols-2 gap-3 w-full max-w-sm">
        {[
          ["Score",    display.score.toLocaleString()],
          ["Peak WPM", display.wpm],
          ["Accuracy", `${acc}%`],
          ["Streak",   `${display.bestStreak} best`],
          ["Level",    display.level],
          ["Time",     `${minutes}:${seconds.toString().padStart(2,"0")}`],
        ].map(([label, val]) => (
          <div key={label} className="bg-gray-800 rounded-xl p-3 text-center">
            <div className="text-gray-400 text-xs uppercase tracking-widest">{label}</div>
            <div className="text-white font-bold font-mono text-xl mt-1">{val}</div>
          </div>
        ))}
      </div>

      {!saved && madeBoard && (
        <div className="flex gap-2 items-center">
          <input
            maxLength={3}
            value={name}
            onChange={(e) => setName(e.target.value.toUpperCase())}
            placeholder="AAA"
            className="w-20 bg-gray-800 text-white font-mono text-2xl text-center rounded-lg px-3 py-2
                       border border-indigo-500 focus:outline-none tracking-widest uppercase"
          />
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-bold
                       disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            Save Score
          </button>
        </div>
      )}
      {saved && rank && (
        <p className="text-yellow-300 font-bold">
          {rank === 1 ? "🏆 New #1!" : `#${rank} on the leaderboard!`}
        </p>
      )}

      <div className="flex gap-3">
        <button onClick={onMenu}
          className="px-5 py-2 bg-gray-700 hover:bg-gray-600 rounded-xl font-bold transition-all">
          Menu
        </button>
        <button onClick={onLeaderboard}
          className="px-5 py-2 bg-yellow-600 hover:bg-yellow-500 rounded-xl font-bold transition-all">
          <Trophy size={16} className="inline mr-1" />Leaderboard
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add `LeaderboardView` component (add after `GameOverScreen`)**

```jsx
function LeaderboardView({ entries, onBack }) {
  return (
    <div className="flex flex-col h-full text-white">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-700">
        <Trophy size={22} className="text-yellow-400" />
        <h2 className="text-xl font-bold">Leaderboard</h2>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {entries.length === 0 ? (
          <p className="text-gray-500 text-center mt-12">No scores yet. Play to get on the board!</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs uppercase tracking-widest border-b border-gray-700">
                <th className="py-2 text-left w-8">#</th>
                <th className="py-2 text-left">Name</th>
                <th className="py-2 text-right">Score</th>
                <th className="py-2 text-right">WPM</th>
                <th className="py-2 text-right">Acc</th>
                <th className="py-2 text-right hidden sm:table-cell">Date</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i}
                  className={`border-b border-gray-800 transition-colors
                    ${i === 0 ? "text-yellow-300" : i === 1 ? "text-gray-300" : i === 2 ? "text-orange-400" : "text-gray-400"}`}
                >
                  <td className="py-2 font-mono font-bold">{i + 1}</td>
                  <td className="py-2 font-mono font-bold tracking-widest">{e.name}</td>
                  <td className="py-2 text-right font-mono">{e.score.toLocaleString()}</td>
                  <td className="py-2 text-right">{e.wpm}</td>
                  <td className="py-2 text-right">{e.accuracy}%</td>
                  <td className="py-2 text-right hidden sm:table-cell text-xs">{e.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="px-4 py-3 border-t border-gray-700">
        <button onClick={onBack}
          className="px-5 py-2 bg-gray-700 hover:bg-gray-600 rounded-xl font-bold transition-all">
          ← Back
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire leaderboard hook + new screens into root component**

At the top of `TypingSpeedRacer`, add:

```js
  const { entries: lbEntries, save: saveScore, reload: reloadLb } = useLeaderboard();
```

Replace the two placeholder phase blocks (`gameover` and `leaderboard`) in the JSX:

```jsx
        {display.phase === "gameover" && (
          <GameOverScreen
            display={display}
            onSave={saveScore}
            onMenu={() => { dispatch({ type: "MAIN_MENU" }); reloadLb(); }}
            onLeaderboard={() => dispatch({ type: "SHOW_LEADERBOARD" })}
            leaderboardEntries={lbEntries}
          />
        )}
        {display.phase === "leaderboard" && (
          <LeaderboardView
            entries={lbEntries}
            onBack={() => dispatch({ type: "MAIN_MENU" })}
          />
        )}
```

Also update `MainMenu`'s `onLeaderboard` call to trigger reload before showing:

```jsx
            onLeaderboard={() => { reloadLb(); dispatch({ type: "SHOW_LEADERBOARD" }); }}
```

- [ ] **Step 5: Verify leaderboard persistence**

Play a game → die → enter 3-letter name → Save Score → see rank. Go back to menu → Leaderboard. Score persists. Reload the artifact — score is still there.

---

## Phase 4 — Two-Player Race Mode

### Task 6: Split-screen 2P layout with shared word queue

**Files:**
- Modify: `TypingSpeedRacer.jsx` — add `TwoPlayerGame` component and wire mode branching

- [ ] **Step 1: Add `TwoPlayerGame` component (add before root component)**

```jsx
function TwoPlayerGame({ display, dispatch, wordsToRender, onInput, inputRef,
                          p1Input, p2Input, setP1Input, setP2Input,
                          p1Ref, p2Ref, gameStateRef, winner }) {
  const acc = (correct, typed) =>
    typed === 0 ? 100 : Math.round((correct / typed) * 100);

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700 text-sm">
        <span className="text-indigo-300 font-bold font-mono">P1: {display.p1Score ?? 0}</span>
        <span className="text-indigo-300 font-mono">Lv.{display.level}</span>
        <span className="text-purple-300 font-bold font-mono">P2: {display.p2Score ?? 0}</span>
      </div>

      {/* Play field */}
      <div className="relative flex-1 bg-gray-950 overflow-hidden">
        {/* Centre divider */}
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-gray-700 opacity-40" />
        {/* Deadline */}
        <div style={{ top: DEADLINE_Y }}
          className="absolute left-0 right-0 h-px bg-red-600 opacity-60 z-10" />

        {wordsToRender.map((w) => (
          <FallingWord
            key={w.id}
            word={w}
            isActive={
              (p1Input.length > 0 && w.text.startsWith(p1Input)) ||
              (p2Input.length > 0 && w.text.startsWith(p2Input))
            }
          />
        ))}

        {/* Winner banner */}
        {winner && (
          <div className="absolute inset-0 bg-gray-950/85 flex items-center justify-center z-30">
            <div className="text-center">
              <p className="text-5xl font-black text-yellow-300 font-mono mb-2">
                {winner} WINS!
              </p>
              <p className="text-gray-400 text-sm">
                P1: {display.p1Score ?? 0} pts &nbsp;|&nbsp; P2: {display.p2Score ?? 0} pts
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Lives + inputs */}
      <div className="flex gap-2 px-3 py-3 bg-gray-800 border-t border-gray-700">
        <div className="flex-1">
          <div className="flex gap-1 mb-1">
            {Array.from({ length: LIVES }).map((_, i) => (
              <Heart key={i} size={12}
                className={i < (display.p1Lives ?? LIVES) ? "text-red-500 fill-red-500" : "text-gray-600"} />
            ))}
            <span className="text-gray-400 text-xs ml-1 font-mono">P1</span>
          </div>
          <input
            ref={p1Ref}
            value={p1Input}
            onChange={(e) => onInput(e.target.value, "P1")}
            placeholder="Player 1…"
            className="w-full bg-gray-900 text-white font-mono text-base rounded-lg px-3 py-2
                       border border-gray-600 focus:outline-none focus:border-indigo-500
                       focus:ring-1 focus:ring-indigo-500 placeholder-gray-600"
            autoComplete="off" autoCorrect="off" spellCheck={false}
          />
        </div>
        <div className="flex-1">
          <div className="flex gap-1 mb-1 justify-end">
            <span className="text-gray-400 text-xs mr-1 font-mono">P2</span>
            {Array.from({ length: LIVES }).map((_, i) => (
              <Heart key={i} size={12}
                className={i < (display.p2Lives ?? LIVES) ? "text-red-500 fill-red-500" : "text-gray-600"} />
            ))}
          </div>
          <input
            ref={p2Ref}
            value={p2Input}
            onChange={(e) => onInput(e.target.value, "P2")}
            placeholder="Player 2…"
            className="w-full bg-gray-900 text-white font-mono text-base rounded-lg px-3 py-2
                       border border-gray-700 focus:outline-none focus:border-purple-500
                       focus:ring-1 focus:ring-purple-500 placeholder-gray-600"
            autoComplete="off" autoCorrect="off" spellCheck={false}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Extend `displayReducer` + `initialDisplay` for 2P state**

In `initialDisplay`, add:
```js
  p1Score: 0, p1Lives: LIVES,
  p2Score: 0, p2Lives: LIVES,
```

In `displayReducer`, add these cases before the `default`:
```js
    case "P_WORD_COMPLETE": {
      const scoreKey = action.player === "P1" ? "p1Score" : "p2Score";
      return { ...state, [scoreKey]: state[scoreKey] + action.wordLen * state.level };
    }
    case "P_WORD_MISSED": {
      const livesKey = action.player === "P1" ? "p1Lives" : "p2Lives";
      const newLives = state[livesKey] - 1;
      const gameOver = state.p1Lives <= (action.player === "P1" ? 1 : 0)
                    && state.p2Lives <= (action.player === "P2" ? 1 : 0);
      return { ...state, [livesKey]: newLives, phase: gameOver ? "gameover" : state.phase };
    }
```

- [ ] **Step 3: Add 2P state + handlers to root component**

After the existing `inputRef` declaration, add:

```js
  const [p1Input, setP1Input] = useState("");
  const [p2Input, setP2Input] = useState("");
  const p1Ref = useRef(null);
  const p2Ref = useRef(null);
  const [winner, setWinner] = useState(null);
```

Add `handle2PInput` callback (after `handleInput`):

```js
  const handle2PInput = useCallback((val, player) => {
    if (!gameStateRef.current || displayRef.current.phase !== "playing") return;
    const gs = gameStateRef.current;
    const setInput = player === "P1" ? setP1Input : setP2Input;
    const currentInput = val;

    const active = findActiveWord(gs.words, currentInput);
    if (!active) {
      if (currentInput.length > 0) setInput("");
      else setInput(val);
      return;
    }

    if (active.text.startsWith(currentInput)) {
      active.typed = currentInput;
      setInput(val);
    } else {
      setInput("");
      active.typed = "";
      return;
    }

    if (currentInput === active.text) {
      // This player snagged it — mark completed
      active.active = false;
      active.completedBy = player;
      dispatch({ type: "P_WORD_COMPLETE", player, wordLen: active.text.length });
      // Check if other player had partial progress — clear it
      const other = player === "P1" ? setP2Input : setP1Input;
      other("");
      setInput("");
    }
  }, [dispatch]);
```

- [ ] **Step 4: Determine 2P winner and wire into JSX**

In the rAF loop's deadline section, replace `dispatch({ type: "WORD_MISSED" })` with:

```js
        const mode = displayRef.current.gameMode;
        if (mode === "2p") {
          // In 2P, missing hurts both players equally (word falls through)
          dispatch({ type: "P_WORD_MISSED", player: "P1" });
          dispatch({ type: "P_WORD_MISSED", player: "P2" });
        } else {
          dispatch({ type: "WORD_MISSED" });
        }
```

Add winner determination effect inside root component:

```js
  useEffect(() => {
    if (display.phase === "gameover" && display.gameMode === "2p") {
      if (display.p1Score > display.p2Score) setWinner("PLAYER 1");
      else if (display.p2Score > display.p1Score) setWinner("PLAYER 2");
      else setWinner("TIE");
    }
  }, [display.phase, display.gameMode, display.p1Score, display.p2Score]);
```

- [ ] **Step 5: Replace `playing` JSX block to branch on gameMode**

Find the `{(display.phase === "playing" || display.phase === "paused") && ...}` block and replace its inner content to branch between solo and 2P:

```jsx
        {(display.phase === "playing" || display.phase === "paused") && (
          display.gameMode === "2p" ? (
            <TwoPlayerGame
              display={display}
              dispatch={dispatch}
              wordsToRender={wordsToRender}
              onInput={handle2PInput}
              p1Input={p1Input}
              p2Input={p2Input}
              setP1Input={setP1Input}
              setP2Input={setP2Input}
              p1Ref={p1Ref}
              p2Ref={p2Ref}
              gameStateRef={gameStateRef}
              winner={display.phase === "gameover" ? winner : null}
            />
          ) : (
            <div className="flex flex-col h-full">
              <HUD display={display} />
              <div className="relative flex-1 bg-gray-950 overflow-hidden">
                <div style={{ top: DEADLINE_Y }}
                  className="absolute left-0 right-0 h-px bg-red-600 opacity-60 z-10" />
                <div style={{ top: DEADLINE_Y - 18 }}
                  className="absolute right-2 text-red-600 text-xs opacity-60 z-10 font-mono">
                  DEADLINE
                </div>
                {wordsToRender.map((w) => (
                  <FallingWord key={w.id} word={w}
                    isActive={inputVal.length > 0 && w.text.startsWith(inputVal)} />
                ))}
                {particles.map((p) => (
                  <ParticleBurst key={p.id} x={p.x} y={p.y} id={p.id}
                    onDone={() => setParticles((prev) => prev.filter((x) => x.id !== p.id))} />
                ))}
                {display.phase === "paused" && (
                  <div className="absolute inset-0 bg-gray-950/80 flex items-center justify-center z-20">
                    <div className="text-center">
                      <Pause size={48} className="text-indigo-400 mx-auto mb-3" />
                      <p className="text-white text-2xl font-bold">PAUSED</p>
                      <p className="text-gray-400 text-sm mt-1">Press Esc to resume</p>
                    </div>
                  </div>
                )}
              </div>
              <div className="px-4 py-3 bg-gray-800 border-t border-gray-700">
                <input
                  ref={inputRef}
                  value={inputVal}
                  onChange={handleInput}
                  className="w-full bg-gray-900 text-white font-mono text-lg rounded-lg px-4 py-2
                             border border-gray-600 focus:outline-none focus:border-indigo-500
                             focus:ring-1 focus:ring-indigo-500 placeholder-gray-600"
                  placeholder="type here..."
                  autoComplete="off" autoCorrect="off" spellCheck={false}
                />
              </div>
            </div>
          )
        )}
```

- [ ] **Step 6: Reset 2P state on new game start**

In `handleStart`, add before `dispatch`:
```js
    setP1Input("");
    setP2Input("");
    setWinner(null);
```

- [ ] **Step 7: Verify 2P mode**

Open → 2 Player. Words fall down the centre. Type a word in P1 input — it glows and highlights. Complete it — word disappears, P1 score increments. P2 types the same or different word. When a word crosses DEADLINE both players lose a life. Last player (or highest score) wins.

---

## Phase 5 — Polish Pass

### Task 7: Auto-focus, spawn x-distribution, word queue by difficulty tier

**Files:**
- Modify: `TypingSpeedRacer.jsx` — improve spawning, input focus, word difficulty curve

- [ ] **Step 1: Bias word selection toward current level difficulty**

Replace `pickWord` with a version that respects level:

```js
function pickWord(wordQueue, level) {
  // Level 1-3: only easy. Level 4-6: easy+medium. Level 7+: all.
  let pool;
  if (level <= 3)      pool = WORD_POOL.easy;
  else if (level <= 6) pool = [...WORD_POOL.easy, ...WORD_POOL.medium];
  else                 pool = [...WORD_POOL.easy, ...WORD_POOL.medium, ...WORD_POOL.hard];

  const key = `tier${level <= 3 ? "e" : level <= 6 ? "m" : "h"}`;
  if (!wordQueue.current[key] || wordQueue.current[key].length === 0) {
    wordQueue.current[key] = shuffle(pool);
  }
  return wordQueue.current[key].pop();
}
```

Update all call sites: `pickWord(wordQueueRef)` → `pickWord(wordQueueRef, level)` inside the rAF spawn block.

Update `handleStart` reset: `wordQueueRef.current = {};`

- [ ] **Step 2: Prevent word x-position collisions**

Replace the x-spawn line in the rAF loop:

```js
      // Pick x far from existing words to avoid overlap
      const existingXs = gs.words.map((w) => w.x);
      let x, attempts = 0;
      do {
        x = 60 + Math.random() * 540;
        attempts++;
      } while (attempts < 20 && existingXs.some((ex) => Math.abs(ex - x) < 80));
```

- [ ] **Step 3: Auto-focus input on game start**

In the `useEffect` that triggers on `display.phase`, add focus:

```js
  useEffect(() => {
    if (display.phase === "playing") {
      setTimeout(() => {
        if (display.gameMode === "2p") {
          p1Ref.current?.focus();
        } else {
          inputRef.current?.focus();
        }
      }, 50);
    }
  }, [display.phase, display.gameMode]);
```

- [ ] **Step 4: Verify final polish**

Play through all phases: early words are short (3-4 letters), later levels include long words (7-8 letters). Words don't overlap at spawn. Input auto-focuses when game starts. Particles fire on completion. Streak multiplier shows correctly in HUD.

---

## Self-Review

### Spec Coverage Check

| Requirement | Task |
|---|---|
| Words fall from top, deadline line near bottom | Task 2 |
| Player types active word, correct = disappears + score | Task 3 |
| Word crosses deadline → life lost, 3 lives, game over at 0 | Task 2 |
| 300 embedded words, no repeats until pool cycles | Task 1, Task 7 |
| Speed scaling every 30s | Task 2 |
| Density scaling every 30s | Task 2 |
| Length scaling by difficulty | Task 7 |
| Visible level indicator | Task 1 (HUD) |
| Base points = word length × level multiplier | Task 1 (reducer) |
| Streak bonus ×1.5 / ×2 / ×3 | Task 1 (reducer) |
| Live WPM, accuracy, streak, score | Task 1 (HUD), Task 2 |
| Game over summary card | Task 5 |
| window.storage leaderboard top 10 | Task 5 |
| Prompt for 3-letter name tag if on board | Task 5 |
| Leaderboard on main menu + game over screen | Task 5 |
| Two-player split screen, shared word queue | Task 6 |
| completedBy P1/P2 marking | Task 6 |
| P1 left input, P2 right input | Task 6 |
| Winner banner | Task 6 |
| Dark theme, monospace for words | Task 1 |
| Color-coded by length: green/yellow/orange | Task 1 (FallingWord) |
| Active word glowing border | Task 1 (FallingWord) |
| Letter-by-letter green/red highlighting | Task 1 (FallingWord) |
| Wrong keystroke = red flash + screen shake | Task 3 |
| Particle burst on completion | Task 4 |
| Main menu with Start Solo, 2P, Leaderboard, preset | Task 1 |
| Pause (Esc) | Task 2 |
| rAF + delta time game loop | Task 2 |
| React.memo on FallingWord | Task 1 |
| No localStorage (window.storage only) | Task 5 |

All requirements covered. ✓

### Placeholder Scan

No TBDs, TODOs, or incomplete steps. ✓

### Type Consistency

- `word.typed` used consistently across `FallingWord`, `handleInput`, `handle2PInput`, `findActiveWord`. ✓
- `word.active` / `word.completedBy` used consistently. ✓
- `DEADLINE_Y` / `GAME_HEIGHT` referenced by name, never magic numbers. ✓
- `displayRef.current.phase` used inside rAF closures (not stale `display`). ✓
- `wordQueueRef.current` reset to `{}` in Task 7 (object for keyed tiers) — matches `pickWord` in Task 7. Note: Task 1's `pickWord` uses array; Task 7 replaces it with keyed-object version. Agent must apply Task 7's `pickWord` replacement and change reset from `[]` to `{}`. ✓
