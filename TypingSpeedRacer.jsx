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

// ─── initGameState ────────────────────────────────────────────────────────────
function initGameState(presetKey) {
  return {
    words: [],          // active word objects
    nextId: 0,
    spawnAccum: 0,      // ms accumulated since last spawn
    levelAccum: 0,      // ms accumulated since last level-up
    preset: DIFFICULTY_PRESETS[presetKey],
    presetKey,
    pausedMs: 0,        // total milliseconds spent paused
  };
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

// Returns the word object that best matches the current input prefix.
// Tie-break: lowest word (highest y value) wins — player clears the most dangerous one.
function findActiveWord(words, input) {
  if (!input) return null;
  const matches = words.filter((w) => w.text.startsWith(input));
  if (!matches.length) return null;
  return matches.reduce((best, w) => (w.y > best.y ? w : best), matches[0]);
}

// ─── FallingWord ──────────────────────────────────────────────────────────────
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

  const presetRef   = useRef("normal"); // tracks latest preset for rAF closure access
  const pausedAtRef = useRef(null);     // timestamp when current pause started
  const gameStateRef = useRef(null);
  const rafRef       = useRef(null);
  const lastTimeRef  = useRef(null);
  const wordQueueRef = useRef([]);
  const inputRef     = useRef(null);
  const displayRef   = useRef(display);
  useEffect(() => { displayRef.current = display; }, [display]);
  useEffect(() => { presetRef.current = preset; }, [preset]);

  // ── game loop ────────────────────────────────────────────────────────────────
  const gameLoop = useCallback((timestamp) => {
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
      const text = pickWord(wordQueueRef);
      const x = 60 + Math.random() * 540;
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
        dispatch({ type: "WORD_MISSED" });
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
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [display.phase, gameLoop]);

  // ── Esc key → pause ───────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" &&
          (displayRef.current.phase === "playing" || displayRef.current.phase === "paused")) {
        dispatch({ type: "PAUSE" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch]);

  const handleStart = useCallback((mode) => {
    wordQueueRef.current = [];
    gameStateRef.current = initGameState(presetRef.current);
    lastTimeRef.current  = null;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setWordsToRender([]);
    setInputVal("");
    dispatch({ type: "START_GAME", mode });
  }, [dispatch]);

  const handleInput = useCallback((e) => {
    const raw = e.target.value;
    // Strip trailing space/enter — player can use space as submit gesture
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

    // Valid prefix — update typed progress
    if (active.text.startsWith(val)) {
      const prevLen = active.typed.length;
      active.typed = val;
      if (val.length > prevLen) {
        // Net new character — count as hit
        dispatch({ type: "KEYSTROKE_HIT" });
      }
      // If shorter (backspace), don't count — player made an error
      setInputVal(raw); // keep raw (with possible trailing space in flight)
    }

    // Word complete?
    if (val === active.text) {
      active.active = false;
      active.completedBy = "P1";
      dispatch({ type: "WORD_COMPLETE", wordLen: active.text.length });
      setInputVal("");
      words.forEach((w) => { if (w !== active) w.typed = ""; });
    }
  }, [dispatch]);

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
                onChange={handleInput}
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
