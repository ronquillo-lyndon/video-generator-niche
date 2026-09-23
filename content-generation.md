# Content Generation — AI Integration

## Overview

The quiz generation endpoint (`POST /api/quiz/generate`) supports two modes:

| Mode | Trigger | Behaviour |
|---|---|---|
| **Gemini AI** (live) | `AI_API_KEY` is set in `.env` | Calls `gemini-3.8-flash` via `@google/genai` SDK |
| **Mock** (demo) | `AI_API_KEY` is empty or unset | Returns hardcoded questions from the built-in bank |

The frontend always hits the same endpoint — the server picks the provider automatically.

---

## Environment Setup

Copy `.env.example` to `.env` and add your key:

```env
PORT=3001
AI_PROVIDER=gemini
AI_API_KEY=your_gemini_api_key_here
```

Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

---

## Request / Response Reference

See [`server/payload_request.json`](./server/payload_request.json) for the exact shape sent from:
- Frontend → Server (`frontend_to_server`)
- Server → Gemini API (`server_to_gemini`)

See [`server/payload_response.json`](./server/payload_response.json) for:
- Raw Gemini `output_text` (JSON string)
- Normalized response the server sends back to the frontend (`server_to_frontend`)
- Error shape (`error_response`)

---

## Server-Side Flow (`server/index.ts`)

```
POST /api/quiz/generate
       │
       ▼
  AI_API_KEY set?
  ┌──── Yes ─────────────────────────────────────────────────────┐
  │  GoogleGenAI client → interactions.create()                  │
  │  model: gemini-3.8-flash                                     │
  │  response_mime_type: application/json                        │
  │  Parse JSON array → attach UUIDs → return { questions, mode }│
  └──────────────────────────────────────────────────────────────┘
       │
       No
       ▼
  questionsFor() — static bank lookup (science / geography / general)
  Return { questions, mode: 'Demo quiz generator' }
```

---

## Gemini Prompt Design

The prompt instructs the model to return **only** a raw JSON array (no markdown fences) with exactly the fields the `QuizQuestion` type expects:

```
question       — max 110 chars, punchy/viral phrasing
options        — exactly 4 concise strings
correctAnswerIndex — 0–3
explanation    — ≤120 char "Did you know" fun fact
category       — mirrors the user's chosen category
difficulty     — "easy" | "medium" | "hard"
```

`response_mime_type: "application/json"` is set so Gemini returns structured JSON directly.

---

## Error Handling

- If parsing fails or Gemini returns an invalid array, the server falls back to the mock bank and logs the error.
- A `400` is returned immediately for invalid input (count out of 3–15, non-string topic, etc.).
- On Gemini API errors (rate limit, invalid key), the server returns `500` with `{ error: "AI generation failed. Please check your AI_API_KEY." }`.

---

## Future Extensions

| Feature | Variable | Status |
|---|---|---|
| Text-to-speech voiceover | `TTS_PROVIDER` / `TTS_API_KEY` | Not implemented |
| YouTube Shorts publishing | `YOUTUBE_CLIENT_ID/SECRET` | OAuth interface only |
| Instagram Reels | `INSTAGRAM_CLIENT_ID/SECRET` | OAuth interface only |
| TikTok posting | `TIKTOK_CLIENT_KEY/SECRET` | OAuth interface only |

