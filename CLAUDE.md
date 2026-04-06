# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # start local dev server at localhost:5173
npm run build     # production build → dist/
npm run preview   # serve the production build locally
vercel --prod     # deploy to Vercel
```

There are no tests or linters configured.

## Architecture

The entire game lives in one file: **`TypingSpeedRacer.jsx`**. `src/main.jsx` only mounts it. Do not split it into multiple files without a deliberate decision — it was designed as a single deployable artifact.

### Two-layer state pattern

Game state is split to keep the 60fps loop fast:

- **`gameStateRef`** — mutable world state (word positions, timers, accumulators). Mutated in-place every rAF frame. Never triggers React renders.
- **`displayReducer`** — React state for UI (score, lives, phase, WPM). Updated only when values change.
- **`displayRef`** — mirrors reducer state in a ref so the rAF closure can read the latest values without going stale.

### rAF game loop (`gameLoop` in `TypingSpeedRacer`)

- Uses delta time capped at 100ms (`Math.min(delta, 100)`) to prevent spiral of death on tab-switch.
- `shouldRunRef` boolean guards against double-start in React Strict Mode — set to `true` inside the phase-change `useEffect`, not in `handleStart`. Setting it in `handleStart` would be overwritten by the effect cleanup before the new effect fires.
- Loop calls `setWordsToRender(gs.words.map(w => ({ ...w })))` once per frame — the only React state update per frame. The spread creates new objects so `React.memo` on `FallingWord` can diff by reference.

### Input matching

Prefix-based: the player types freely; `findActiveWord` finds whichever falling word starts with the current input string. Tie-break: lowest word (highest `y`) wins — clears the most dangerous one first.

### Key non-obvious patterns

**`FallingWord` must receive primitive props** — passing the word object directly breaks `memo` because the rAF loop mutates objects in-place (same reference, memo bails out).

**`ParticleBurst` two-effect pattern** — `onDone` changes every render (new closure), but the 600ms timer must fire exactly once. Two effects solve it: one syncs `onDoneRef` every render (no deps), one starts the timer once on mount (empty deps). Without this, `setWordsToRender` firing every frame restarts the timer perpetually.

**`P_SHARED_MISS`** — In 2P mode, a missed word dispatches one shared action that decrements both players' lives atomically. Two separate dispatches would double the deduction.

**2P lobby** — Clicking "2 Player" opens a `"2p-lobby"` phase where each player clicks their own Ready button. An effect watches `p1Ready && p2Ready` and calls `handleStart("2p")` after 800ms.

### Phase flow

```
"menu" → "2p-lobby" (2P only) → "playing" → "paused" (Esc toggle)
                                           → "gameover"
"menu" → "leaderboard"
```

Esc from `"gameover"`, `"leaderboard"`, or `"2p-lobby"` returns to `"menu"`.

### Word difficulty tiers

`pickWord(wordQueue, level)` uses a keyed shuffled-deck queue (`wordQueue.current["easy"|"medium"|"hard"]`). Level 1–3 = easy only, 4–6 = easy+medium, 7+ = all tiers. Each deck reshuffles when exhausted.

### Storage

`useLeaderboard` uses synchronous `localStorage` (top 10, key `"leaderboard-top10"`). The original `window.storage` (Claude.ai artifact API) was replaced when scaffolding for Vercel.
