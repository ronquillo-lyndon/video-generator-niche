# Quizframe Studio

A lightweight local quiz-video studio. Create a multiple-choice quiz, refine it on an editable scene timeline, preview the exact structured sequence, and render a local vertical MP4 when FFmpeg is available.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. The Vite client proxies its local API to `http://localhost:3001`.

To enable actual MP4 output, install FFmpeg and make sure `ffmpeg` is available on your `PATH`. The backend will accurately report an unavailable renderer instead of fabricating a download. Its lightweight renderer turns every timeline scene—hook, question, reveal, explanation, score, and CTA—into a 1080×1920 H.264 segment and joins them into one full-length MP4.

## What works without credentials

- Deterministic mock quiz generation, editable questions, timeline, countdown/reveal preview, themes, branding, and browser-local project persistence.
- Node API project persistence and server-side rendering queue.
- Full-timeline FFmpeg MP4 generation and protected download endpoint when FFmpeg is installed.
- Transparent mock publishing and integration status screens.

## Provider security

Copy `.env.example` to `.env` only when implementing a verified provider adapter. Never expose API keys in Vite environment variables or the React app. `docs/integrations.md` links only to official documentation and records integration status.

## Storage

Runtime data is written below `storage/`:

- `storage/projects` – project JSON
- `storage/renders` – rendered MP4s

It is gitignored by design.
