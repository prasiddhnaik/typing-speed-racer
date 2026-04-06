// ─── Architecture overview ────────────────────────────────────────────────────
//
// State is split into two layers to keep the 60fps game loop fast:
//
//   gameStateRef  — mutable world state (word positions, timers, speeds).
//                   Lives in a ref so the rAF loop can read/write it without
//                   triggering React re-renders every frame.
//
//   displayReducer — React state for the HUD and UI (score, lives, phase, WPM).
//                    Updated only when values actually change, not every frame.
//
//   displayRef    — mirror of the reducer state kept in a ref, so the rAF
//                   closure can read the latest phase/score without going stale.
//
// The game loop runs via requestAnimationFrame (rAF). Each frame it:
//   1. Moves words down by speed × delta
//   2. Checks for words crossing DEADLINE_Y (lose life)
//   3. Recalculates WPM
//   4. Calls setWordsToRender(snapshot) — the only React state update per frame
//
// Input matching works on prefix: the player types freely and the game
// highlights whichever word starts with the current input string.
// ─────────────────────────────────────────────────────────────────────────────

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
// All values here drive the visible UI. The rAF loop never writes directly to
// these — it dispatches actions which are batched by React between frames.
const initialDisplay = {
  score: 0, lives: LIVES, level: 1, wpm: 0, accuracy: 100,
  streak: 0, bestStreak: 0, totalTyped: 0, totalCorrect: 0,
  phase: "menu", // "menu" | "2p-lobby" | "playing" | "paused" | "gameover" | "leaderboard"
  gameMode: "solo", // "solo" | "2p"
  startTime: null,
  p1Score: 0, p1Lives: LIVES,
  p2Score: 0, p2Lives: LIVES,
  p1Ready: false, p2Ready: false, // 2P lobby ready state
};

function displayReducer(state, action) {
  switch (action.type) {
    case "START_GAME":
      return { ...initialDisplay, phase: "playing", gameMode: action.mode, startTime: Date.now() };
    case "OPEN_2P_LOBBY":
      return { ...initialDisplay, phase: "2p-lobby", gameMode: "2p" };
    case "P1_READY":
      return { ...state, p1Ready: true };
    case "P2_READY":
      return { ...state, p2Ready: true };
    case "WORD_COMPLETE": {
      // Score = wordLength × level × streakMultiplier
      // Note: totalCorrect/totalTyped are NOT updated here — KEYSTROKE_HIT handles
      // those per character, so we don't double-count on word completion.
      const streak = state.streak + 1;
      const bestStreak = Math.max(streak, state.bestStreak);
      const mult = streak >= 20 ? 3 : streak >= 10 ? 2 : streak >= 5 ? 1.5 : 1;
      const points = Math.round(action.wordLen * state.level * mult);
      return {
        ...state,
        score: state.score + points,
        streak,
        bestStreak,
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
    case "P_WORD_COMPLETE": {
      const scoreKey = action.player === "P1" ? "p1Score" : "p2Score";
      return { ...state, [scoreKey]: state[scoreKey] + Math.round(action.wordLen * state.level) };
    }
    case "P_WORD_MISSED": {
      const livesKey = action.player === "P1" ? "p1Lives" : "p2Lives";
      const newLives = state[livesKey] - 1;
      // Game over when both players have 0 lives
      const p1Dead = action.player === "P1" ? newLives <= 0 : state.p1Lives <= 0;
      const p2Dead = action.player === "P2" ? newLives <= 0 : state.p2Lives <= 0;
      return {
        ...state,
        [livesKey]: newLives,
        phase: (p1Dead && p2Dead) ? "gameover" : state.phase,
      };
    }
    case "P_SHARED_MISS": {
      // In 2P mode, a missed word costs BOTH players a life simultaneously.
      // Using a single shared action prevents the rAF loop from dispatching
      // P1_MISS and P2_MISS separately, which would cause two re-renders and
      // double the life deduction (bug: game over after only 3 misses instead of 6).
      const p1Lives = state.p1Lives - 1;
      const p2Lives = state.p2Lives - 1;
      return {
        ...state,
        p1Lives,
        p2Lives,
        phase: (p1Lives <= 0 && p2Lives <= 0) ? "gameover" : state.phase,
      };
    }
    default:
      return state;
  }
}

// ─── initGameState ────────────────────────────────────────────────────────────
// Mutable world state — lives in a ref, never in React state.
// The rAF loop mutates this object directly every frame for performance.
function initGameState(presetKey) {
  return {
    words: [],          // active word objects: { id, text, x, y, speed, typed, active }
    nextId: 0,          // monotonically increasing word ID for React keys
    spawnAccum: 0,      // ms accumulated since last spawn; spawn when >= spawnInterval
    levelAccum: 0,      // ms accumulated since last level-up; level up when >= LEVEL_INTERVAL_MS
    preset: DIFFICULTY_PRESETS[presetKey],
    presetKey,
    pausedMs: 0,        // total ms spent paused; subtracted from elapsed time for WPM calc
  };
}

// ─── Pure Helpers ─────────────────────────────────────────────────────────────
// Fisher-Yates shuffle — creates a new array, does not mutate the original.
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Level 1-3: easy only. Level 4-6: easy+medium. Level 7+: all tiers.
// wordQueue is a ref holding a keyed object { easy: [...], medium: [...], hard: [...] }.
// Each tier is a shuffled deck — words are popped off. When empty, the deck is
// reshuffled from the full pool, so words repeat only after exhaustion (no true repeats).
function pickWord(wordQueue, level) {
  let tierKey;
  let pool;
  if (level <= 3) {
    tierKey = "easy";
    pool = WORD_POOL.easy;
  } else if (level <= 6) {
    tierKey = "medium";
    pool = [...WORD_POOL.easy, ...WORD_POOL.medium];
  } else {
    tierKey = "hard";
    pool = [...WORD_POOL.easy, ...WORD_POOL.medium, ...WORD_POOL.hard];
  }

  if (!wordQueue.current[tierKey] || wordQueue.current[tierKey].length === 0) {
    wordQueue.current[tierKey] = shuffle(pool);
  }
  return wordQueue.current[tierKey].pop();
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

// Returns the word object that best matches the current input prefix.
// Tie-break: lowest word (highest y value) wins — player clears the most dangerous one.
function findActiveWord(words, input) {
  if (!input) return null;
  const matches = words.filter((w) => w.text.startsWith(input));
  if (!matches.length) return null;
  return matches.reduce((best, w) => (w.y > best.y ? w : best), matches[0]);
}

// ─── FallingWord ──────────────────────────────────────────────────────────────
// Wrapped in memo to skip re-renders when props haven't changed.
// IMPORTANT: all props must be primitives (not objects/arrays). The rAF loop
// mutates word objects in-place then calls setWordsToRender(gs.words.map(w => ({...w})))
// to spread each word into a new object — this gives memo fresh references to diff.
// If we passed the word object directly, memo would always see the same reference
// (since the loop mutates in-place) and words would never visually move.
const FallingWord = memo(function FallingWord({ id, text, x, y, typed, isActive }) {
  const lenColor =
    text.length <= 4 ? "text-emerald-400" :
    text.length <= 6 ? "text-yellow-300"  : "text-orange-400";

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: "translateX(-50%)",
        willChange: "top",
      }}
      className={`font-mono text-lg font-bold select-none pointer-events-none
        ${isActive ? "filter drop-shadow-[0_0_10px_rgba(99,102,241,1)]" : ""}`}
    >
      {text.split("").map((ch, i) => {
        const typedLen = typed.length;
        let cls;
        if (i < typedLen) {
          cls = typed[i] === ch ? "text-green-300" : "text-red-400";
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

// ─── ParticleBurst ────────────────────────────────────────────────────────────
const BURST_DURATION = 600; // ms — must match the CSS animation duration in @keyframes burst

const ParticleBurst = memo(function ParticleBurst({ x, y, onDone }) {
  // Two-effect pattern to keep a stable callback without restarting the timer:
  //
  //   Effect 1 (no deps): runs after every render to keep onDoneRef in sync
  //                        with the latest onDone prop. No cleanup needed.
  //
  //   Effect 2 ([] deps): fires ONCE on mount. Reads onDoneRef at timeout time,
  //                        so it always calls the latest version of onDone.
  //
  // Without this pattern, putting onDone in Effect 2's deps would restart the
  // 600ms timer whenever the parent re-renders (every rAF frame), meaning the
  // particle would never be cleaned up — it would live forever.
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }); // sync without restarting timer

  useEffect(() => {
    const t = setTimeout(() => onDoneRef.current(), BURST_DURATION);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ position: "absolute", left: x, top: y, pointerEvents: "none" }}>
      {Array.from({ length: 8 }).map((_, i) => {
        const angle = (i / 8) * 2 * Math.PI;
        const dx = Math.cos(angle) * 30;
        const dy = Math.sin(angle) * 30;
        const color = ["#6366f1","#a78bfa","#34d399","#fbbf24"][i % 4];
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: color,
              animation: `burst ${BURST_DURATION}ms ease-out forwards`,
              "--dx": `${dx}px`,
              "--dy": `${dy}px`,
            }}
          />
        );
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
    <div className="flex items-center justify-between px-5 py-2.5 bg-gray-900/95 border-b border-gray-700/60 text-sm backdrop-blur-sm">
      {/* Lives */}
      <div className="flex items-center gap-1.5">
        {Array.from({ length: LIVES }).map((_, i) => (
          <Heart
            key={i}
            size={15}
            className={i < display.lives
              ? "text-red-500 fill-red-500 drop-shadow-[0_0_4px_rgba(239,68,68,0.7)]"
              : "text-gray-700"}
          />
        ))}
      </div>

      {/* Center stats */}
      <div className="flex items-center gap-1 text-gray-300 font-mono">
        <div className="flex items-center gap-1 px-3 py-1 rounded-md bg-indigo-500/10 border border-indigo-500/20">
          <Zap size={12} className="text-indigo-400" />
          <span className="text-indigo-300 font-bold text-xs tracking-wider">LV {display.level}</span>
        </div>
        <div className="w-px h-4 bg-gray-700 mx-1" />
        <div className="px-3 py-1 rounded-md">
          <span className="text-white font-bold">{display.wpm}</span>
          <span className="text-gray-500 text-xs ml-1">WPM</span>
        </div>
        <div className="w-px h-4 bg-gray-700" />
        <div className="px-3 py-1 rounded-md">
          <span className={`font-bold ${acc >= 90 ? "text-emerald-400" : acc >= 70 ? "text-yellow-400" : "text-red-400"}`}>{acc}</span>
          <span className="text-gray-500 text-xs ml-0.5">%</span>
        </div>
        {streakLabel && (
          <>
            <div className="w-px h-4 bg-gray-700" />
            <div className="px-3 py-1 rounded-md bg-yellow-500/10 border border-yellow-500/20">
              <span className="text-yellow-300 font-bold text-xs">{streakLabel}</span>
            </div>
          </>
        )}
      </div>

      {/* Score */}
      <div className="font-mono">
        <span className="text-gray-500 text-xs mr-1.5 tracking-wider">SCORE</span>
        <span className="text-white font-black text-lg tracking-tight">{display.score.toLocaleString()}</span>
      </div>
    </div>
  );
}

// ─── MainMenu ─────────────────────────────────────────────────────────────────
function MainMenu({ onStart, onStart2p, onLeaderboard, preset, setPreset }) {
  const difficultyMeta = {
    chill:    { color: "emerald", desc: "Relaxed pace" },
    normal:   { color: "indigo",  desc: "Balanced challenge" },
    hardcore: { color: "red",     desc: "No mercy" },
  };

  return (
    <div className="relative flex flex-col items-center justify-center h-full gap-10 text-white overflow-hidden">
      {/* Atmospheric background glows */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] rounded-full bg-indigo-600/10 blur-[80px]" />
        <div className="absolute bottom-1/4 left-1/3 w-[300px] h-[200px] rounded-full bg-purple-600/8 blur-[60px]" />
        <div className="absolute top-1/3 right-1/4 w-[200px] h-[200px] rounded-full bg-indigo-500/6 blur-[50px]" />
        {/* Subtle grid pattern */}
        <div className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: "linear-gradient(rgba(99,102,241,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.5) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
      </div>

      {/* Title block */}
      <div className="relative text-center">
        <div className="text-xs font-mono tracking-[0.4em] text-indigo-500/70 uppercase mb-3">
          — Speed Challenge —
        </div>
        <h1 className="text-7xl font-black tracking-tighter font-mono leading-none"
          style={{ background: "linear-gradient(135deg, #818cf8 0%, #a78bfa 40%, #c4b5fd 70%, #818cf8 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", filter: "drop-shadow(0 0 40px rgba(139,92,246,0.4))" }}>
          TYPE RACER
        </h1>
        <p className="text-gray-500 mt-3 text-sm tracking-[0.25em] uppercase font-mono">
          Words fall &nbsp;·&nbsp; You type &nbsp;·&nbsp; Don't miss
        </p>
      </div>

      {/* Difficulty selector */}
      <div className="relative flex gap-2">
        {Object.entries(DIFFICULTY_PRESETS).map(([key, val]) => {
          const meta = difficultyMeta[key];
          const isSelected = preset === key;
          const colorMap = {
            emerald: { sel: "bg-emerald-500/15 border-emerald-500/60 text-emerald-300 shadow-emerald-500/20", unsel: "border-gray-700/50 text-gray-500 hover:border-gray-600 hover:text-gray-300" },
            indigo:  { sel: "bg-indigo-500/15 border-indigo-500/60 text-indigo-300 shadow-indigo-500/20",   unsel: "border-gray-700/50 text-gray-500 hover:border-gray-600 hover:text-gray-300" },
            red:     { sel: "bg-red-500/15 border-red-500/60 text-red-300 shadow-red-500/20",               unsel: "border-gray-700/50 text-gray-500 hover:border-gray-600 hover:text-gray-300" },
          };
          const colors = colorMap[meta.color];
          return (
            <button
              key={key}
              onClick={() => setPreset(key)}
              className={`px-5 py-2.5 rounded-xl font-semibold text-sm border transition-all duration-200
                ${isSelected
                  ? `${colors.sel} shadow-lg scale-105`
                  : `bg-gray-900/60 ${colors.unsel} hover:scale-105`}`}
            >
              <div className="font-bold">{val.label}</div>
              <div className={`text-xs mt-0.5 font-normal ${isSelected ? "opacity-80" : "opacity-50"}`}>{meta.desc}</div>
            </button>
          );
        })}
      </div>

      {/* Action buttons */}
      <div className="relative flex flex-col gap-3 w-56">
        <button
          onClick={() => onStart("solo")}
          className="group flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-2xl font-bold text-base
                     transition-all duration-200 active:scale-95
                     hover:scale-[1.03] hover:brightness-110"
          style={{ background: "linear-gradient(135deg, #4f46e5, #6d28d9)", boxShadow: "0 8px 32px rgba(79,70,229,0.4), inset 0 1px 0 rgba(255,255,255,0.1)" }}
        >
          <Play size={18} className="group-hover:translate-x-0.5 transition-transform" />
          Solo Run
        </button>
        <button
          onClick={() => onStart2p()}
          className="group flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-2xl font-bold text-base
                     transition-all duration-200 active:scale-95 hover:scale-[1.03] hover:brightness-110"
          style={{ background: "linear-gradient(135deg, #7c3aed, #9333ea)", boxShadow: "0 8px 24px rgba(124,58,237,0.35), inset 0 1px 0 rgba(255,255,255,0.08)" }}
        >
          <Users size={18} className="group-hover:scale-110 transition-transform" />
          2 Player
        </button>
        <button
          onClick={onLeaderboard}
          className="group flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-2xl font-bold text-base
                     bg-gray-800/80 border border-gray-700/60 text-gray-300 hover:text-white
                     hover:bg-gray-700/80 hover:border-gray-600 hover:scale-[1.02]
                     transition-all duration-200 active:scale-95"
        >
          <Trophy size={18} className="text-yellow-400 group-hover:scale-110 transition-transform" />
          Leaderboard
        </button>
      </div>

      {/* Word length legend */}
      <div className="relative flex items-center gap-4 text-xs font-mono">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-sm bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
          <span className="text-gray-600">short</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-sm bg-yellow-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]" />
          <span className="text-gray-600">medium</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-sm bg-orange-400 shadow-[0_0_6px_rgba(251,146,60,0.6)]" />
          <span className="text-gray-600">long</span>
        </div>
      </div>
    </div>
  );
}

// ─── useLeaderboard ───────────────────────────────────────────────────────────
// Persists top-10 scores to localStorage. Synchronous — no async needed since
// localStorage is a blocking API. The `save` function returns the updated array
// so callers can show the player's rank immediately after saving.
function useLeaderboard() {
  const KEY = "leaderboard-top10";
  const [entries, setEntries] = useState([]);

  const load = useCallback(() => {
    try {
      const raw = localStorage.getItem(KEY);
      setEntries(raw ? JSON.parse(raw) : []);
    } catch {
      setEntries([]);
    }
  }, []);

  const save = useCallback((newEntry) => {
    let current = [];
    try {
      const raw = localStorage.getItem(KEY);
      current = raw ? JSON.parse(raw) : [];
    } catch {}
    const updated = [...current, newEntry]
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    try {
      localStorage.setItem(KEY, JSON.stringify(updated));
    } catch {}
    setEntries(updated);
    return updated;
  }, []);

  useEffect(() => { load(); }, [load]);

  return { entries, save, reload: load };
}

// ─── GameOverScreen ───────────────────────────────────────────────────────────
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

  // Per-stat accent definitions: [accentColor, gradientFrom, gradientTo, borderColor]
  const statConfig = {
    "Score":    { accent: "text-indigo-300",  border: "border-indigo-500/30",  bg: "from-indigo-500/10 to-transparent",   glow: "rgba(99,102,241,0.15)"  },
    "Peak WPM": { accent: "text-cyan-300",    border: "border-cyan-500/30",    bg: "from-cyan-500/10 to-transparent",     glow: "rgba(6,182,212,0.15)"   },
    "Accuracy": { accent: acc >= 90 ? "text-emerald-300" : acc >= 70 ? "text-yellow-300" : "text-red-400", border: acc >= 90 ? "border-emerald-500/30" : acc >= 70 ? "border-yellow-500/30" : "border-red-500/30", bg: acc >= 90 ? "from-emerald-500/10 to-transparent" : acc >= 70 ? "from-yellow-500/10 to-transparent" : "from-red-500/10 to-transparent", glow: acc >= 90 ? "rgba(52,211,153,0.12)" : "rgba(251,191,36,0.12)" },
    "Streak":   { accent: "text-yellow-300",  border: "border-yellow-500/30",  bg: "from-yellow-500/10 to-transparent",   glow: "rgba(251,191,36,0.15)"  },
    "Level":    { accent: "text-purple-300",  border: "border-purple-500/30",  bg: "from-purple-500/10 to-transparent",   glow: "rgba(168,85,247,0.15)"  },
    "Time":     { accent: "text-gray-200",    border: "border-gray-600/40",    bg: "from-gray-700/20 to-transparent",     glow: "rgba(148,163,184,0.08)" },
  };

  return (
    <div className="relative flex flex-col items-center justify-center h-full gap-7 text-white px-8 overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[200px] rounded-full bg-red-600/8 blur-[70px]" />
      </div>

      {/* Title */}
      <div className="relative text-center">
        <h2 className="text-6xl font-black font-mono tracking-wider"
          style={{ background: "linear-gradient(135deg, #f87171 0%, #ef4444 50%, #dc2626 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", filter: "drop-shadow(0 0 30px rgba(239,68,68,0.4))" }}>
          GAME OVER
        </h2>
        <div className="mt-1.5 text-gray-600 text-xs font-mono tracking-[0.3em] uppercase">Session ended</div>
      </div>

      {/* Stat cards grid */}
      <div className="relative grid grid-cols-3 gap-3 w-full max-w-lg">
        {[
          ["Score",    display.score.toLocaleString()],
          ["Peak WPM", display.wpm],
          ["Accuracy", `${acc}%`],
          ["Streak",   `${display.bestStreak}x`],
          ["Level",    display.level],
          ["Time",     `${minutes}:${seconds.toString().padStart(2,"0")}`],
        ].map(([label, val]) => {
          const cfg = statConfig[label] || statConfig["Time"];
          return (
            <div key={label}
              className={`relative rounded-2xl p-4 text-center border ${cfg.border} bg-gradient-to-b ${cfg.bg} overflow-hidden`}
              style={{ boxShadow: `0 4px 24px ${cfg.glow}, inset 0 1px 0 rgba(255,255,255,0.05)` }}>
              <div className="text-gray-500 text-xs uppercase tracking-[0.15em] font-mono mb-1.5">{label}</div>
              <div className={`${cfg.accent} font-black font-mono text-2xl leading-none`}>{val}</div>
            </div>
          );
        })}
      </div>

      {/* Save score area */}
      {!saved && madeBoard && (
        <div className="relative flex flex-col items-center gap-3">
          <div className="text-xs text-indigo-400 font-mono tracking-widest uppercase">You made the leaderboard!</div>
          <div className="flex gap-3 items-center">
            <input
              maxLength={3}
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase())}
              placeholder="AAA"
              className="w-24 bg-gray-900 text-white font-mono text-2xl text-center rounded-xl px-3 py-2.5
                         border border-indigo-500/60 focus:outline-none focus:border-indigo-400
                         focus:ring-2 focus:ring-indigo-500/30 tracking-widest uppercase
                         placeholder-gray-700 transition-all"
            />
            <button
              onClick={handleSave}
              disabled={!name.trim()}
              className="px-6 py-2.5 rounded-xl font-bold text-base
                         disabled:opacity-30 disabled:cursor-not-allowed
                         transition-all duration-200 active:scale-95 hover:scale-[1.03] hover:brightness-110"
              style={{ background: "linear-gradient(135deg, #4f46e5, #6d28d9)", boxShadow: "0 6px 20px rgba(79,70,229,0.4)" }}
            >
              Save Score
            </button>
          </div>
        </div>
      )}
      {saved && rank && (
        <div className="relative px-6 py-2.5 rounded-xl bg-yellow-500/10 border border-yellow-500/30">
          <p className="text-yellow-300 font-bold text-lg font-mono tracking-wide">
            {rank === 1 ? "New #1 — Top of the board!" : `Ranked #${rank} on the leaderboard!`}
          </p>
        </div>
      )}

      {/* Navigation buttons */}
      <div className="relative flex gap-3">
        <button onClick={onMenu}
          className="px-7 py-2.5 bg-gray-800/80 border border-gray-700/60 hover:bg-gray-700/80
                     hover:border-gray-600 rounded-xl font-bold text-base text-gray-300 hover:text-white
                     transition-all duration-200 active:scale-95 hover:scale-[1.02]">
          Menu
        </button>
        <button onClick={onLeaderboard}
          className="flex items-center gap-2.5 px-7 py-2.5 rounded-xl font-bold text-base
                     transition-all duration-200 active:scale-95 hover:scale-[1.02] hover:brightness-110"
          style={{ background: "linear-gradient(135deg, #d97706, #b45309)", boxShadow: "0 6px 20px rgba(217,119,6,0.35)" }}>
          <Trophy size={18} />
          Leaderboard
        </button>
      </div>
    </div>
  );
}

// ─── LeaderboardView ──────────────────────────────────────────────────────────
function LeaderboardView({ entries, onBack }) {
  const medalConfig = [
    { bg: "bg-yellow-500/12", border: "border-yellow-500/30", rank: "text-yellow-400", name: "text-yellow-200", row: "hover:bg-yellow-500/5",  badge: "bg-yellow-500/20 text-yellow-300" },
    { bg: "bg-gray-400/8",   border: "border-gray-500/25",   rank: "text-gray-300",   name: "text-gray-200",   row: "hover:bg-gray-500/5",   badge: "bg-gray-500/20 text-gray-300"   },
    { bg: "bg-orange-500/8", border: "border-orange-500/25", rank: "text-orange-400", name: "text-orange-200", row: "hover:bg-orange-500/5", badge: "bg-orange-500/20 text-orange-400" },
  ];

  return (
    <div className="flex flex-col h-full text-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-700/60 bg-gray-900/60">
        <div className="p-1.5 rounded-lg bg-yellow-500/15 border border-yellow-500/25">
          <Trophy size={18} className="text-yellow-400" />
        </div>
        <div>
          <h2 className="text-base font-black tracking-wide">LEADERBOARD</h2>
          <p className="text-gray-600 text-xs font-mono">Top {entries.length || 0} scores</p>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <Trophy size={32} className="text-gray-700" />
            <p className="text-gray-500 text-sm">No scores yet.</p>
            <p className="text-gray-700 text-xs">Play a round to get on the board.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {/* Column headers */}
            <div className="grid grid-cols-[2rem_4rem_1fr_3.5rem_3.5rem_3rem] gap-2 px-3 py-1.5 text-gray-600 text-xs uppercase tracking-[0.12em] font-mono">
              <div>#</div>
              <div>Name</div>
              <div className="text-right">Score</div>
              <div className="text-right">WPM</div>
              <div className="text-right">Acc</div>
              <div className="text-right hidden sm:block">Date</div>
            </div>

            {entries.map((e, i) => {
              const medal = medalConfig[i];
              const isTop3 = i < 3;
              return (
                <div key={i}
                  className={`grid grid-cols-[2rem_4rem_1fr_3.5rem_3.5rem_3rem] gap-2 items-center
                    px-3 py-2.5 rounded-xl border font-mono text-sm transition-colors duration-150
                    ${isTop3
                      ? `${medal.bg} ${medal.border} ${medal.row}`
                      : "bg-gray-800/40 border-gray-700/30 hover:bg-gray-700/30"}`}
                >
                  {/* Rank */}
                  <div className={`font-black text-sm ${isTop3 ? medal.rank : "text-gray-500"}`}>
                    {i + 1}
                  </div>
                  {/* Name */}
                  <div className={`font-black tracking-widest text-sm ${isTop3 ? medal.name : "text-gray-300"}`}>
                    {e.name}
                  </div>
                  {/* Score */}
                  <div className={`text-right font-bold ${isTop3 ? medal.name : "text-gray-300"}`}>
                    {e.score.toLocaleString()}
                  </div>
                  {/* WPM */}
                  <div className={`text-right text-xs ${isTop3 ? medal.rank : "text-gray-400"}`}>
                    {e.wpm}
                  </div>
                  {/* Accuracy */}
                  <div className={`text-right text-xs ${e.accuracy >= 90 ? "text-emerald-400" : e.accuracy >= 70 ? "text-yellow-400" : "text-red-400"}`}>
                    {e.accuracy}%
                  </div>
                  {/* Date */}
                  <div className="text-right text-xs text-gray-700 hidden sm:block">
                    {e.date}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-gray-700/60 bg-gray-900/40">
        <button onClick={onBack}
          className="flex items-center gap-2 px-5 py-2 bg-gray-800/80 border border-gray-700/60
                     hover:bg-gray-700/80 hover:border-gray-600 rounded-xl font-bold text-sm
                     text-gray-300 hover:text-white transition-all duration-200 active:scale-95">
          ← Back to Menu
        </button>
      </div>
    </div>
  );
}

// ─── TwoPlayerLobby ──────────────────────────────────────────────────────────
// Shown before a 2P game starts. Each player clicks their own Ready button.
// Game only launches once both have confirmed — prevents one person starting
// a game before the second player is seated and ready.
function TwoPlayerLobby({ p1Ready, p2Ready, onP1Ready, onP2Ready }) {
  const bothReady = p1Ready && p2Ready;

  return (
    <div className="relative flex flex-col items-center justify-center h-full gap-10 text-white overflow-hidden">
      {/* Background glows */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/4 w-[300px] h-[200px] rounded-full bg-indigo-600/10 blur-[60px]" />
        <div className="absolute top-1/3 right-1/4 w-[300px] h-[200px] rounded-full bg-purple-600/10 blur-[60px]" />
      </div>

      <div className="relative text-center">
        <div className="text-xs font-mono tracking-[0.4em] text-gray-500 uppercase mb-3">2 Player Mode</div>
        <h2 className="text-5xl font-black font-mono tracking-tight"
          style={{ background: "linear-gradient(135deg, #818cf8, #a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
          GET READY
        </h2>
        <p className="text-gray-500 mt-3 text-sm font-mono tracking-widest">Each player press your Ready button</p>
      </div>

      <div className="relative flex gap-8">
        {/* P1 */}
        <button
          onClick={onP1Ready}
          disabled={p1Ready}
          className="flex flex-col items-center gap-4 w-44 py-8 px-6 rounded-2xl border transition-all duration-200"
          style={p1Ready
            ? { background: "rgba(99,102,241,0.15)", borderColor: "rgba(99,102,241,0.6)", boxShadow: "0 0 40px rgba(99,102,241,0.25)" }
            : { background: "rgba(99,102,241,0.05)", borderColor: "rgba(99,102,241,0.2)", cursor: "pointer" }}
        >
          <span className="text-2xl font-black font-mono tracking-widest text-indigo-300">P1</span>
          <span className="text-4xl">{p1Ready ? "✓" : "?"}</span>
          <span className={`text-sm font-bold font-mono tracking-wide ${p1Ready ? "text-indigo-400" : "text-gray-500"}`}>
            {p1Ready ? "READY" : "Click to Ready"}
          </span>
        </button>

        {/* Divider */}
        <div className="flex items-center">
          <div className="w-px h-24 bg-gradient-to-b from-transparent via-gray-700 to-transparent" />
        </div>

        {/* P2 */}
        <button
          onClick={onP2Ready}
          disabled={p2Ready}
          className="flex flex-col items-center gap-4 w-44 py-8 px-6 rounded-2xl border transition-all duration-200"
          style={p2Ready
            ? { background: "rgba(168,85,247,0.15)", borderColor: "rgba(168,85,247,0.6)", boxShadow: "0 0 40px rgba(168,85,247,0.25)" }
            : { background: "rgba(168,85,247,0.05)", borderColor: "rgba(168,85,247,0.2)", cursor: "pointer" }}
        >
          <span className="text-2xl font-black font-mono tracking-widest text-purple-300">P2</span>
          <span className="text-4xl">{p2Ready ? "✓" : "?"}</span>
          <span className={`text-sm font-bold font-mono tracking-wide ${p2Ready ? "text-purple-400" : "text-gray-500"}`}>
            {p2Ready ? "READY" : "Click to Ready"}
          </span>
        </button>
      </div>

      {bothReady && (
        <div className="relative text-center animate-pulse">
          <p className="text-green-400 font-black font-mono text-xl tracking-widest">Both ready — starting!</p>
        </div>
      )}

      {!bothReady && (
        <p className="relative text-gray-700 text-xs font-mono">
          Waiting for {!p1Ready && !p2Ready ? "both players" : !p1Ready ? "Player 1" : "Player 2"}…
        </p>
      )}
    </div>
  );
}

// ─── TwoPlayerGame ────────────────────────────────────────────────────────────
function TwoPlayerGame({ display, wordsToRender, onInput, p1Input, p2Input, p1Ref, p2Ref, winner, onMenu }) {
  return (
    <div className="flex flex-col h-full">
      {/* Score bar */}
      <div className="flex items-center justify-between px-5 py-2.5 bg-gray-900/95 border-b border-gray-700/60 text-sm backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="px-3 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
            <span className="text-indigo-300 font-black font-mono tracking-wide">P1</span>
            <span className="text-indigo-400 font-mono ml-2">{(display.p1Score ?? 0).toLocaleString()}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-gray-800/60 border border-gray-700/40">
          <Zap size={11} className="text-indigo-500" />
          <span className="text-gray-500 font-mono text-xs tracking-wider">LV {display.level} · RACE</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="px-3 py-1 rounded-lg bg-purple-500/10 border border-purple-500/20">
            <span className="text-purple-400 font-mono mr-2">{(display.p2Score ?? 0).toLocaleString()}</span>
            <span className="text-purple-300 font-black font-mono tracking-wide">P2</span>
          </div>
        </div>
      </div>

      {/* Play field */}
      <div className="game-field relative flex-1 bg-gray-950 overflow-hidden">
        {/* Centre divider */}
        <div className="absolute top-0 bottom-0 left-1/2 w-px opacity-20"
          style={{ background: "linear-gradient(180deg, transparent 0%, rgba(99,102,241,0.6) 20%, rgba(99,102,241,0.6) 80%, transparent 100%)" }} />
        {/* Deadline */}
        <div
          style={{ top: DEADLINE_Y, background: "linear-gradient(90deg, transparent 0%, rgba(239,68,68,0.15) 10%, rgba(239,68,68,0.6) 30%, rgba(239,68,68,0.6) 70%, rgba(239,68,68,0.15) 90%, transparent 100%)" }}
          className="absolute left-0 right-0 h-px z-10" />

        {wordsToRender.map((w) => (
          <FallingWord
            key={w.id}
            id={w.id}
            text={w.text}
            x={w.x}
            y={w.y}
            typed={p1Input.length > 0 && w.text.startsWith(p1Input) ? p1Input
                   : p2Input.length > 0 && w.text.startsWith(p2Input) ? p2Input
                   : ""}
            isActive={
              (p1Input.length > 0 && w.text.startsWith(p1Input)) ||
              (p2Input.length > 0 && w.text.startsWith(p2Input))
            }
          />
        ))}

        {/* Winner banner */}
        {winner && (
          <div className="absolute inset-0 bg-gray-950/88 flex items-center justify-center z-30 backdrop-blur-[2px]">
            <div className="text-center px-12 py-10 rounded-2xl border border-yellow-500/20 bg-yellow-500/5"
              style={{ boxShadow: "0 0 80px rgba(234,179,8,0.12), inset 0 1px 0 rgba(255,255,255,0.05)" }}>
              <Trophy size={40} className="text-yellow-400 mx-auto mb-4" style={{ filter: "drop-shadow(0 0 16px rgba(234,179,8,0.5))" }} />
              <p className="text-5xl font-black font-mono mb-1"
                style={{ background: "linear-gradient(135deg, #fde047, #eab308)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                {winner} WINS!
              </p>
              <p className="text-gray-500 text-sm mt-3 font-mono">
                <span className="text-indigo-400">{display.p1Score ?? 0}</span>
                <span className="text-gray-700 mx-2">·</span>
                <span className="text-purple-400">{display.p2Score ?? 0}</span>
              </p>
              <button
                onClick={onMenu}
                className="mt-6 px-7 py-2.5 rounded-xl font-bold text-white text-base
                           transition-all duration-200 active:scale-95 hover:scale-[1.03] hover:brightness-110"
                style={{ background: "linear-gradient(135deg, #4f46e5, #6d28d9)", boxShadow: "0 6px 20px rgba(79,70,229,0.4)" }}
              >
                Back to Menu
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Lives + inputs */}
      <div className="flex gap-3 px-4 py-3 bg-gray-900/80 border-t border-gray-700/60">
        <div className="flex-1">
          <div className="flex gap-1 mb-1.5 items-center">
            {Array.from({ length: LIVES }).map((_, i) => (
              <Heart key={i} size={11}
                className={i < (display.p1Lives ?? LIVES) ? "text-red-500 fill-red-500" : "text-gray-700"} />
            ))}
            <span className="text-indigo-400 text-xs ml-1.5 font-black tracking-wider">P1</span>
          </div>
          <input
            ref={p1Ref}
            value={p1Input}
            onChange={(e) => onInput(e.target.value, "P1")}
            placeholder="Player 1…"
            className="w-full bg-gray-950 text-white font-mono text-base rounded-xl px-3 py-2
                       border border-indigo-600/50 focus:outline-none focus:border-indigo-400/80
                       focus:ring-2 focus:ring-indigo-500/20 placeholder-gray-700 transition-all"
            autoComplete="off" autoCorrect="off" spellCheck={false}
          />
        </div>
        <div className="flex-1">
          <div className="flex gap-1 mb-1.5 items-center justify-end">
            <span className="text-purple-400 text-xs mr-1.5 font-black tracking-wider">P2</span>
            {Array.from({ length: LIVES }).map((_, i) => (
              <Heart key={i} size={11}
                className={i < (display.p2Lives ?? LIVES) ? "text-red-500 fill-red-500" : "text-gray-700"} />
            ))}
          </div>
          <input
            ref={p2Ref}
            value={p2Input}
            onChange={(e) => onInput(e.target.value, "P2")}
            placeholder="Player 2…"
            className="w-full bg-gray-950 text-white font-mono text-base rounded-xl px-3 py-2
                       border border-purple-700/50 focus:outline-none focus:border-purple-500/80
                       focus:ring-2 focus:ring-purple-500/20 placeholder-gray-700 transition-all"
            autoComplete="off" autoCorrect="off" spellCheck={false}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Root Component (shell — game loop wired in Task 2) ───────────────────────
export default function TypingSpeedRacer() {
  const [display, dispatch] = useReducer(displayReducer, initialDisplay);
  const { entries: lbEntries, save: saveScore, reload: reloadLb } = useLeaderboard();
  const [preset, setPreset] = useState("normal");
  const [wordsToRender, setWordsToRender] = useState([]);
  const [inputVal, setInputVal] = useState("");
  const [shake, setShake] = useState(false);
  const [particles, setParticles] = useState([]);

  const presetRef   = useRef("normal"); // latest preset key; readable inside rAF closure without stale value
  const pausedAtRef = useRef(null);     // timestamp when the current pause began; null when not paused
  const gameStateRef = useRef(null);    // mutable world state — mutated in-place every frame
  const rafRef       = useRef(null);    // active rAF handle; null when loop is stopped
  const lastTimeRef  = useRef(null);    // timestamp of previous frame for delta-time calculation
  const shouldRunRef = useRef(false);   // guard: prevents the rAF loop body from running after stop
                                        // (needed in React Strict Mode where effects fire twice)
  const wordQueueRef = useRef([]);      // shuffled word decks keyed by tier { easy, medium, hard }
  const inputRef     = useRef(null);    // ref to the solo-mode text input for programmatic focus
  const [p1Input, setP1Input] = useState("");
  const [p2Input, setP2Input] = useState("");
  const p1Ref = useRef(null);
  const p2Ref = useRef(null);
  const [winner, setWinner] = useState(null);
  // displayRef mirrors the reducer state so the rAF loop can read the latest
  // phase, level, etc. without capturing a stale closure value.
  const displayRef   = useRef(display);
  useEffect(() => { displayRef.current = display; }, [display]);
  useEffect(() => { presetRef.current = preset; }, [preset]);

  // ── game loop ────────────────────────────────────────────────────────────────
  const gameLoop = useCallback((timestamp) => {
    if (!shouldRunRef.current) return;
    if (!gameStateRef.current) return;
    const gs = gameStateRef.current;

    // delta time — cap at 100ms to avoid spiral of death on tab-switch
    const delta = Math.min(timestamp - (lastTimeRef.current ?? timestamp), 100);
    lastTimeRef.current = timestamp;

    const phase = displayRef.current.phase;
    if (phase === "paused") {
      if (pausedAtRef.current === null) {
        pausedAtRef.current = timestamp; // record when pause started
      }
      rafRef.current = requestAnimationFrame(gameLoop);
      return;
    }
    // If we just unpaused, accumulate paused duration
    if (pausedAtRef.current !== null) {
      gs.pausedMs += timestamp - pausedAtRef.current;
      pausedAtRef.current = null;
    }

    // ── level progression ──────────────────────────────────────────────────
    gs.levelAccum += delta;
    if (gs.levelAccum >= LEVEL_INTERVAL_MS) {
      gs.levelAccum -= LEVEL_INTERVAL_MS;
      const newLevel = displayRef.current.level + 1;
      dispatch({ type: "LEVEL_UP", level: newLevel });
    }

    const level  = displayRef.current.level;
    const preset = gs.preset;

    // ── spawn words ────────────────────────────────────────────────────────
    const spawnInterval = getSpawnIntervalForLevel(preset, level);
    gs.spawnAccum += delta;
    while (gs.spawnAccum >= spawnInterval) {
      gs.spawnAccum -= spawnInterval;
      const text = pickWord(wordQueueRef, level);
      // Pick x far from existing words to avoid overlap
      const existingXs = gs.words.map((w) => w.x);
      let x, attempts = 0;
      do {
        x = 60 + Math.random() * 540;
        attempts++;
      } while (attempts < 20 && existingXs.some((ex) => Math.abs(ex - x) < 80));
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
    gs.words = gs.words.filter((w) => {
      if (!w.active) return false;
      w.y += w.speed * delta;
      if (w.y >= DEADLINE_Y) {
        const mode = displayRef.current.gameMode;
        if (mode === "2p") {
          dispatch({ type: "P_SHARED_MISS" });
        } else {
          dispatch({ type: "WORD_MISSED" });
        }
        return false;
      }
      return true;
    });

    // ── WPM update ─────────────────────────────────────────────────────────
    const startTime = displayRef.current.startTime;
    if (startTime) {
      const elapsedMin = (Date.now() - startTime - gs.pausedMs) / 60000;
      if (elapsedMin > 0) {
        const newWpm = Math.round((displayRef.current.totalCorrect / 5) / elapsedMin);
        if (newWpm !== displayRef.current.wpm) {
          dispatch({ type: "UPDATE_WPM", wpm: newWpm });
        }
      }
    }

    // ── push render snapshot ────────────────────────────────────────────────
    // Create new word objects so React.memo on FallingWord can diff correctly
    setWordsToRender(gs.words.map((w) => ({ ...w })));

    // ── continue loop ───────────────────────────────────────────────────────
    if (displayRef.current.phase !== "gameover") {
      rafRef.current = requestAnimationFrame(gameLoop);
    }
  }, [dispatch]);

  // ── start / stop loop on phase change ────────────────────────────────────
  // shouldRunRef is set to true HERE (inside the effect), not in handleStart.
  // Reason: the effect cleanup always sets shouldRunRef=false. If handleStart set
  // it to true, the cleanup from the previous render would overwrite it before
  // the new effect fires — and the game loop would immediately bail on its first frame.
  // By setting it inside the effect that starts the loop, we run after cleanup.
  useEffect(() => {
    if (display.phase === "playing" && !rafRef.current) {
      shouldRunRef.current = true;
      rafRef.current = requestAnimationFrame(gameLoop);
    }
    if (display.phase === "gameover" || display.phase === "menu") {
      shouldRunRef.current = false;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }
    return () => {
      shouldRunRef.current = false;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [display.phase, gameLoop]);

  // ── Esc key → pause ───────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      const phase = displayRef.current.phase;
      if (phase === "playing" || phase === "paused") {
        dispatch({ type: "PAUSE" });
      } else if (phase === "gameover" || phase === "leaderboard" || phase === "2p-lobby") {
        dispatch({ type: "MAIN_MENU" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch]);

  useEffect(() => {
    if (display.phase === "playing") {
      const t = setTimeout(() => {
        if (display.gameMode === "2p") {
          p1Ref.current?.focus();
        } else {
          inputRef.current?.focus();
        }
      }, 50);
      return () => clearTimeout(t);
    }
  }, [display.phase, display.gameMode]);

  useEffect(() => {
    if (display.phase === "gameover" && display.gameMode === "2p") {
      if (display.p1Score > display.p2Score) setWinner("PLAYER 1");
      else if (display.p2Score > display.p1Score) setWinner("PLAYER 2");
      else setWinner("TIE");
    }
  }, [display.phase, display.gameMode, display.p1Score, display.p2Score]);

  // When both players ready up in the lobby, start the game after a short delay
  // so the "Both ready — starting!" message is visible briefly.
  useEffect(() => {
    if (display.phase === "2p-lobby" && display.p1Ready && display.p2Ready) {
      const t = setTimeout(() => handleStart("2p"), 800);
      return () => clearTimeout(t);
    }
  }, [display.phase, display.p1Ready, display.p2Ready, handleStart]);

  const handleStart = useCallback((mode) => {
    wordQueueRef.current = {};
    gameStateRef.current = initGameState(presetRef.current);
    lastTimeRef.current  = null;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setWordsToRender([]);
    setInputVal("");
    setP1Input("");
    setP2Input("");
    setWinner(null);
    dispatch({ type: "START_GAME", mode });
  }, [dispatch]);

  // handleInput — called on every keystroke in solo mode.
  // Prefix-matching approach: the player types freely; we find whichever falling
  // word starts with the current input string. No word selection needed — the
  // first matching prefix wins (tie-break: lowest word, i.e. most dangerous).
  const handleInput = useCallback((e) => {
    const raw = e.target.value;
    // Allow space as a submit gesture — strip trailing space before matching
    const val = raw.endsWith(" ") ? raw.trim() : raw;

    if (!gameStateRef.current || displayRef.current.phase !== "playing") return;

    const words = gameStateRef.current.words;

    if (!val) {
      // Cleared input — reset typed progress on all words
      words.forEach((w) => { w.typed = ""; });
      setInputVal("");
      return;
    }

    const active = findActiveWord(words, val);

    if (!active) {
      // No matching word — wrong input
      dispatch({ type: "KEYSTROKE_MISS" });
      setShake(true);
      setTimeout(() => setShake(false), 300);
      setInputVal("");
      // Clear typed progress on all words
      words.forEach((w) => { w.typed = ""; });
      return;
    }

    // Valid prefix — update typed progress on the matched word
    if (active.text.startsWith(val)) {
      const prevLen = active.typed.length;
      active.typed = val;
      if (val.length > prevLen) {
        // Only count as a hit when the input grew (new character added).
        // Backspace shrinks the value — we don't penalise that here.
        dispatch({ type: "KEYSTROKE_HIT" });
      }
      setInputVal(raw); // keep raw so a trailing space in-flight is preserved briefly
    }

    // Word complete?
    if (val === active.text) {
      active.active = false;
      active.completedBy = "P1";
      dispatch({ type: "WORD_COMPLETE", wordLen: active.text.length });
      // Spawn particle burst at word's last known position
      setParticles((prev) => [
        ...prev,
        { id: Date.now() + Math.random(), x: active.x, y: active.y },
      ]);
      setInputVal("");
      words.forEach((w) => { if (w !== active) w.typed = ""; });
    }
  }, [dispatch]);

  // handle2PInput — same prefix-matching logic as solo, but called for both players.
  // Both players share the same falling word queue; whoever completes a word first
  // claims it. Eliminated players (0 lives) are blocked from typing.
  const handle2PInput = useCallback((val, player) => {
    const raw = val;
    const trimmed = raw.endsWith(" ") ? raw.trim() : raw;

    if (!gameStateRef.current || displayRef.current.phase !== "playing") return;

    // Block input from an eliminated player — their words are already cleared
    const lives = player === "P1"
      ? displayRef.current.p1Lives
      : displayRef.current.p2Lives;
    if (lives <= 0) {
      const setInput = player === "P1" ? setP1Input : setP2Input;
      setInput("");
      return;
    }

    const gs = gameStateRef.current;
    const setInput = player === "P1" ? setP1Input : setP2Input;

    if (!trimmed) {
      gs.words.forEach((w) => { w.typed = ""; });
      setInput("");
      return;
    }

    const active = findActiveWord(gs.words, trimmed);
    if (!active) {
      setInput("");
      return;
    }

    if (active.text.startsWith(trimmed)) {
      active.typed = trimmed;
      setInput(raw);
    }

    if (trimmed === active.text) {
      active.active = false;
      active.completedBy = player;
      dispatch({ type: "P_WORD_COMPLETE", player, wordLen: active.text.length });
      // Clear both players' inputs when word is snagged
      setP1Input("");
      setP2Input("");
    }
  }, [dispatch]);

  return (
    <div className="bg-gray-950 min-h-screen flex items-center justify-center font-sans">
      <div
        className={`w-full bg-gray-900 overflow-hidden
          ${shake ? "animate-[shake_0.3s_ease]" : ""}`}
        style={{ height: "100vh" }}
      >
        {display.phase === "menu" && (
          <MainMenu
            onStart={handleStart}
            onStart2p={() => dispatch({ type: "OPEN_2P_LOBBY" })}
            onLeaderboard={() => { reloadLb(); dispatch({ type: "SHOW_LEADERBOARD" }); }}
            preset={preset}
            setPreset={setPreset}
          />
        )}
        {display.phase === "2p-lobby" && (
          <TwoPlayerLobby
            p1Ready={display.p1Ready}
            p2Ready={display.p2Ready}
            onP1Ready={() => dispatch({ type: "P1_READY" })}
            onP2Ready={() => dispatch({ type: "P2_READY" })}
          />
        )}
        {(display.phase === "playing" || display.phase === "paused" ||
          (display.phase === "gameover" && display.gameMode === "2p")) && (
          display.gameMode === "2p" ? (
            <TwoPlayerGame
              display={display}
              wordsToRender={wordsToRender}
              onInput={handle2PInput}
              p1Input={p1Input}
              p2Input={p2Input}
              p1Ref={p1Ref}
              p2Ref={p2Ref}
              winner={winner}
              onMenu={() => { dispatch({ type: "MAIN_MENU" }); }}
            />
          ) : (
            <div className="flex flex-col h-full">
              <HUD display={display} />
              <div className="game-field relative flex-1 bg-gray-950 overflow-hidden">
                <div
                  style={{ top: DEADLINE_Y, background: "linear-gradient(90deg, transparent 0%, rgba(239,68,68,0.15) 10%, rgba(239,68,68,0.6) 30%, rgba(239,68,68,0.6) 70%, rgba(239,68,68,0.15) 90%, transparent 100%)" }}
                  className="absolute left-0 right-0 h-px z-10" />
                <div
                  style={{ top: DEADLINE_Y - 18, color: "rgba(239,68,68,0.5)" }}
                  className="absolute right-3 text-xs z-10 font-mono tracking-widest">
                  DEADLINE
                </div>
                {wordsToRender.map((w) => (
                  <FallingWord
                    key={w.id}
                    id={w.id}
                    text={w.text}
                    x={w.x}
                    y={w.y}
                    typed={w.typed}
                    isActive={inputVal.length > 0 && w.text.startsWith(inputVal)}
                  />
                ))}
                {particles.map((p) => (
                  <ParticleBurst
                    key={p.id}
                    x={p.x}
                    y={p.y}
                    onDone={() => setParticles((prev) => prev.filter((x) => x.id !== p.id))}
                  />
                ))}
                {display.phase === "paused" && (
                  <div className="absolute inset-0 bg-gray-950/85 flex items-center justify-center z-20 backdrop-blur-[2px]">
                    <div className="text-center px-10 py-8 rounded-2xl border border-indigo-500/20 bg-indigo-500/5"
                      style={{ boxShadow: "0 0 60px rgba(99,102,241,0.15), inset 0 1px 0 rgba(255,255,255,0.05)" }}>
                      <Pause size={40} className="text-indigo-400 mx-auto mb-4" style={{ filter: "drop-shadow(0 0 12px rgba(99,102,241,0.6))" }} />
                      <p className="text-white text-3xl font-black font-mono tracking-wider">PAUSED</p>
                      <p className="text-gray-500 text-xs mt-2 font-mono tracking-widest uppercase">Press Esc to resume</p>
                    </div>
                  </div>
                )}
              </div>
              <div className="px-4 py-3 bg-gray-900/80 border-t border-gray-700/60">
                <input
                  ref={inputRef}
                  value={inputVal}
                  onChange={handleInput}
                  className="w-full bg-gray-950 text-white font-mono text-lg rounded-xl px-4 py-2.5
                             border border-gray-700/60 focus:outline-none focus:border-indigo-500/70
                             focus:ring-2 focus:ring-indigo-500/20 placeholder-gray-700
                             transition-all duration-200"
                  placeholder="type here..."
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
            </div>
          )
        )}
        {display.phase === "leaderboard" && (
          <LeaderboardView
            entries={lbEntries}
            onBack={() => dispatch({ type: "MAIN_MENU" })}
          />
        )}
        {display.phase === "gameover" && display.gameMode !== "2p" && (
          <GameOverScreen
            display={display}
            onSave={saveScore}
            onMenu={() => { dispatch({ type: "MAIN_MENU" }); reloadLb(); }}
            onLeaderboard={() => dispatch({ type: "SHOW_LEADERBOARD" })}
            leaderboardEntries={lbEntries}
          />
        )}
      </div>

      {/* Global styles */}
      <style>{`
        @keyframes shake {
          0%,100%{transform:translateX(0)}
          20%{transform:translateX(-6px)}
          40%{transform:translateX(6px)}
          60%{transform:translateX(-4px)}
          80%{transform:translateX(4px)}
        }
        @keyframes burst {
          0%   { transform: translate(0,0); opacity:1; }
          100% { transform: translate(var(--dx),var(--dy)); opacity:0; }
        }
        /* Subtle scanline effect on the game field */
        .game-field::before {
          content: '';
          position: absolute;
          inset: 0;
          background: repeating-linear-gradient(
            0deg,
            transparent,
            transparent 2px,
            rgba(0,0,0,0.04) 2px,
            rgba(0,0,0,0.04) 4px
          );
          pointer-events: none;
          z-index: 1;
        }
        /* Smooth focus transitions */
        input { transition: border-color 0.15s ease, box-shadow 0.15s ease; }
        /* Prevent text selection flash on buttons */
        button { user-select: none; -webkit-user-select: none; }
        /* Consistent scrollbar styling for leaderboard */
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(99,102,241,0.25); border-radius: 2px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(99,102,241,0.45); }
      `}</style>
    </div>
  );
}
