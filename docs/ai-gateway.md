# AI Gateway

## Endpoints
- `POST /api/ai/chat` — AI chat assistant (rate limited: 20/min/user)
- `POST /api/ai/summarize` — Summarize last 50 messages in a conversation
- `POST /api/ai/translate` — Translate text to any language
- `POST /api/ai/moderate` — Content moderation (spam/abuse detection)

## Configuration
Set ONE of these in .env:
- `ZAI_API_KEY` — uses z-ai-web-dev-sdk (already installed)
- `OPENAI_API_KEY` — uses OpenAI-compatible API
- `AI_API_KEY` + `AI_MODEL` + `OPENAI_BASE_URL` — custom provider

## Components
- `src/components/fc/ai/AIPanel.tsx` — slide-in AI assistant panel

## Security
- All endpoints require authentication
- Rate limited (20 requests/min/user)
- AI outputs treated as untrusted
- No automatic action without user approval
