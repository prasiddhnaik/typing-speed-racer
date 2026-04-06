# Typing Speed Racer

**Live demo:** https://typing-speed-racer-indol.vercel.app/

A falling-words typing speed game built with React + Vite. Words fall from the top of the screen — type them before they hit the deadline line or lose a life.

## Features

- **Solo mode** — race against falling words across difficulty levels
- **2 Player mode** — split-screen race on the same keyboard
- **Difficulty presets** — Chill, Normal, Hardcore
- **Difficulty scaling** — speed and spawn rate increase every 30 seconds
- **Streak multipliers** — ×1.5 at 5, ×2 at 10, ×3 at 20 consecutive words
- **Leaderboard** — top 10 scores saved locally via localStorage
- **Particle bursts** on word completion, screen shake on wrong input
- **Color-coded words** by length: emerald (short), yellow (medium), orange (long)

## Controls

| Key | Action |
|-----|--------|
| Type | Match falling words by prefix |
| `Space` | Submit current word |
| `Esc` | Pause / resume (or return to menu from Game Over) |

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Commands

```bash
make dev      # start dev server
make build    # production build
make preview  # build + serve locally
make deploy   # build + deploy to Vercel
```

## Tech Stack

- [React 18](https://react.dev)
- [Vite](https://vitejs.dev)
- [Tailwind CSS](https://tailwindcss.com)
- [lucide-react](https://lucide.dev) icons

## Project Structure

```
TypingSpeedRacer.jsx   # entire game — single component file
src/
  main.jsx             # React entry point
  index.css            # Tailwind directives + global reset
index.html             # HTML shell
vercel.json            # SPA rewrite rule for Vercel
```
