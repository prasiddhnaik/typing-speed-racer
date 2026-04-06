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
  p1Score: 0, p1Lives: LIVES,
  p2Score: 0, p2Lives: LIVES,
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

// Level 1-3: easy only. Level 4-6: easy+medium. Level 7+: all tiers.
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
const BURST_DURATION = 600; // ms — must match CSS animation duration

const ParticleBurst = memo(function ParticleBurst({ x, y, onDone }) {
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }); // keep ref current without restarts

  useEffect(() => {
    // Empty deps — fires once on mount, never restarted
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

// ─── useLeaderboard ───────────────────────────────────────────────────────────
function useLeaderboard() {
  const KEY = "leaderboard-top10";
  const [entries, setEntries] = useState([]);

  const load = useCallback(async () => {
    try {
      const result = await window.storage.get(KEY);
      setEntries(result ? JSON.parse(result.value) : []);
    } catch {
      setEntries([]); // key doesn't exist yet — first time
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
    try {
      await window.storage.set(KEY, JSON.stringify(updated));
      setEntries(updated);
    } catch {
      // Storage write failed — still update local state so the session shows the score
      setEntries(updated);
    }
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
        <p className="text-yellow-300 font-bold text-lg">
          {rank === 1 ? "🏆 New #1!" : `#${rank} on the leaderboard!`}
        </p>
      )}

      <div className="flex gap-3">
        <button onClick={onMenu}
          className="px-5 py-2 bg-gray-700 hover:bg-gray-600 rounded-xl font-bold transition-all">
          Menu
        </button>
        <button onClick={onLeaderboard}
          className="flex items-center gap-1 px-5 py-2 bg-yellow-600 hover:bg-yellow-500 rounded-xl font-bold transition-all">
          <Trophy size={16} />Leaderboard
        </button>
      </div>
    </div>
  );
}

// ─── LeaderboardView ──────────────────────────────────────────────────────────
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

// ─── TwoPlayerGame ────────────────────────────────────────────────────────────
function TwoPlayerGame({ display, wordsToRender, onInput, p1Input, p2Input, p1Ref, p2Ref, winner, onMenu }) {
  return (
    <div className="flex flex-col h-full">
      {/* Score bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700 text-sm">
        <span className="text-indigo-300 font-bold font-mono">P1: {display.p1Score ?? 0}</span>
        <span className="text-gray-500 font-mono text-xs">Lv.{display.level} · Race</span>
        <span className="text-purple-300 font-bold font-mono">P2: {display.p2Score ?? 0}</span>
      </div>

      {/* Play field */}
      <div className="relative flex-1 bg-gray-950 overflow-hidden">
        {/* Centre divider */}
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-gray-700 opacity-30" />
        {/* Deadline */}
        <div style={{ top: DEADLINE_Y }}
          className="absolute left-0 right-0 h-px bg-red-600 opacity-60 z-10" />

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
          <div className="absolute inset-0 bg-gray-950/85 flex items-center justify-center z-30">
            <div className="text-center">
              <p className="text-5xl font-black text-yellow-300 font-mono mb-2">
                {winner} WINS!
              </p>
              <p className="text-gray-400 text-sm mt-2">
                P1: {display.p1Score ?? 0} · P2: {display.p2Score ?? 0}
              </p>
              <button
                onClick={onMenu}
                className="mt-6 px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-bold text-white transition-all"
              >
                Back to Menu
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Lives + inputs */}
      <div className="flex gap-2 px-3 py-3 bg-gray-800 border-t border-gray-700">
        <div className="flex-1">
          <div className="flex gap-1 mb-1 items-center">
            {Array.from({ length: LIVES }).map((_, i) => (
              <Heart key={i} size={12}
                className={i < (display.p1Lives ?? LIVES) ? "text-red-500 fill-red-500" : "text-gray-600"} />
            ))}
            <span className="text-indigo-400 text-xs ml-1 font-bold">P1</span>
          </div>
          <input
            ref={p1Ref}
            value={p1Input}
            onChange={(e) => onInput(e.target.value, "P1")}
            placeholder="Player 1…"
            className="w-full bg-gray-900 text-white font-mono text-base rounded-lg px-3 py-2
                       border border-indigo-600 focus:outline-none focus:border-indigo-400
                       focus:ring-1 focus:ring-indigo-400 placeholder-gray-600"
            autoComplete="off" autoCorrect="off" spellCheck={false}
          />
        </div>
        <div className="flex-1">
          <div className="flex gap-1 mb-1 items-center justify-end">
            <span className="text-purple-400 text-xs mr-1 font-bold">P2</span>
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
                       border border-purple-700 focus:outline-none focus:border-purple-500
                       focus:ring-1 focus:ring-purple-500 placeholder-gray-600"
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

  const presetRef   = useRef("normal"); // tracks latest preset for rAF closure access
  const pausedAtRef = useRef(null);     // timestamp when current pause started
  const gameStateRef = useRef(null);
  const rafRef       = useRef(null);
  const lastTimeRef  = useRef(null);
  const shouldRunRef = useRef(false);
  const wordQueueRef = useRef([]);
  const inputRef     = useRef(null);
  const [p1Input, setP1Input] = useState("");
  const [p2Input, setP2Input] = useState("");
  const p1Ref = useRef(null);
  const p2Ref = useRef(null);
  const [winner, setWinner] = useState(null);
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
  useEffect(() => {
    if (display.phase === "playing" && !rafRef.current) {
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
      if (e.key === "Escape" &&
          (displayRef.current.phase === "playing" || displayRef.current.phase === "paused")) {
        dispatch({ type: "PAUSE" });
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

  const handleStart = useCallback((mode) => {
    wordQueueRef.current = {};
    gameStateRef.current = initGameState(presetRef.current);
    lastTimeRef.current  = null;
    shouldRunRef.current = true;
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
      // Spawn particle burst at word's last known position
      setParticles((prev) => [
        ...prev,
        { id: Date.now() + Math.random(), x: active.x, y: active.y },
      ]);
      setInputVal("");
      words.forEach((w) => { if (w !== active) w.typed = ""; });
    }
  }, [dispatch]);

  const handle2PInput = useCallback((val, player) => {
    const raw = val;
    const trimmed = raw.endsWith(" ") ? raw.trim() : raw;

    if (!gameStateRef.current || displayRef.current.phase !== "playing") return;

    // Don't allow input from an eliminated player
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
    <div className="bg-gray-950 min-h-screen flex items-center justify-center p-4 font-sans">
      <div
        className={`w-full max-w-2xl bg-gray-900 rounded-2xl overflow-hidden shadow-2xl
          ${shake ? "animate-[shake_0.3s_ease]" : ""}`}
        style={{ height: 580 }}
      >
        {display.phase === "menu" && (
          <MainMenu
            onStart={handleStart}
            onLeaderboard={() => { reloadLb(); dispatch({ type: "SHOW_LEADERBOARD" }); }}
            preset={preset}
            setPreset={setPreset}
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
              <div className="relative flex-1 bg-gray-950 overflow-hidden">
                <div style={{ top: DEADLINE_Y }}
                  className="absolute left-0 right-0 h-px bg-red-600 opacity-60 z-10" />
                <div style={{ top: DEADLINE_Y - 18 }}
                  className="absolute right-2 text-red-600 text-xs opacity-60 z-10 font-mono">
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

      {/* Shake keyframe */}
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
      `}</style>
    </div>
  );
}
