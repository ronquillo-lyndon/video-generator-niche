# Integration registry

Last reviewed: 2026-09-18. This local MVP ships with mock quiz, voice, and publishing adapters, so it is usable without credentials.

| Service | Purpose | Official documentation | Authentication | Status |
|---|---|---|---|---|
| OpenAI API | Optional server-side quiz or narration provider | https://platform.openai.com/docs/overview | API key stored only in `AI_API_KEY`/`TTS_API_KEY` | Not implemented; mock active |
| YouTube Data API | Potential upload/publishing adapter | https://developers.google.com/youtube/v3/docs/videos/insert | OAuth 2.0 client credentials and user authorization | Interface only; not connected |
| Instagram Graph API | Potential Reels publishing adapter | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/content-publishing | Meta OAuth and approved permissions | Interface only; requires app review/capability verification |
| TikTok Content Posting API | Potential posting adapter | https://developers.tiktok.com/doc/content-posting-api-get-started | TikTok OAuth and approved scopes | Interface only; not connected |

Before enabling any provider, verify its current eligibility, scopes, upload requirements, rate limits, and OAuth flow in its official documentation. Do not claim a successful social post unless the provider returns a verified successful result.
