# Open-Source AI Model Integration

FriendConnect's AI Gateway supports multiple free/open-source AI providers.
Set ONE environment variable to enable AI features.

## Provider Priority (first available wins)

1. **Ollama** (self-hosted, 100% free, open-source)
2. **Z.ai SDK** (free tier, already installed)
3. **OpenRouter** (free models available)
4. **Hugging Face** (free inference tier)
5. **OpenAI-compatible** (any provider, paid)

---

## 1. Ollama (Recommended — 100% free, self-hosted)

### Install on your server
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

### Pull a model
```bash
ollama pull llama3.2      # Meta Llama 3.2 (3B params, fast)
ollama pull qwen2.5       # Qwen 2.5 (Alibaba)
ollama pull mistral       # Mistral 7B
ollama pull phi3          # Microsoft Phi-3 (small, fast)
ollama pull gemma2        # Google Gemma 2
ollama pull deepseek-r1   # DeepSeek R1 (reasoning)
```

### Configure in .env
```env
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
```

### Why Ollama?
- 100% free, no API keys, no rate limits
- Runs on your own server — data never leaves
- Open-source (MIT license)
- Supports Llama, Qwen, Mistral, Phi, Gemma, DeepSeek
- GPU acceleration (CUDA, Metal, ROCm)

---

## 2. Z.ai SDK (free tier)

Already installed in package.json (`z-ai-web-dev-sdk`).

### Configure
```env
ZAI_API_KEY=your-free-api-key
```

### Models
- GLM-4.6 (powerful, multilingual)
- GLM-4-Flash (fast, lightweight)

---

## 3. OpenRouter (free models)

### Configure
```env
OPENROUTER_API_KEY=your-key
OPENROUTER_MODEL=meta-llama/llama-3.2-3b-instruct:free
```

### Free models available
- `meta-llama/llama-3.2-3b-instruct:free`
- `google/gemma-2-9b-it:free`
- `qwen/qwen-2.5-7b-instruct:free`
- `mistralai/mistral-7b-instruct:free`

Get a free API key at https://openrouter.ai

---

## 4. Hugging Face (free inference tier)

### Configure
```env
HUGGINGFACE_API_KEY=your-key
HF_MODEL=mistralai/Mistral-7B-Instruct
```

Free tier: 1000 requests/day.
Get a key at https://huggingface.co/settings/tokens

---

## 5. OpenAI-compatible (any provider)

For any OpenAI-compatible API (OpenAI, Together, Anyscale, etc.):

```env
OPENAI_API_KEY=your-key
OPENAI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
```

---

## Multi-Agent Support (MetaGPT-style)

For multi-agent AI workflows (like MetaGPT), integrate with:

- **MetaGPT** (https://github.com/geekan/MetaGPT) — multi-agent framework
  where Product Manager, Architect, Engineer agents collaborate
- **CrewAI** (https://github.com/crewAIInc/crewAI) — role-playing AI agents
- **AutoGen** (https://github.com/microsoft/autogen) — Microsoft's multi-agent framework

### Integration approach
1. Run MetaGPT/CrewAI as a separate service (Python)
2. Expose a REST endpoint that accepts a task
3. FriendConnect's AI Gateway calls that endpoint for complex multi-agent tasks
4. Each agent uses the same Ollama/OpenRouter backend

### Example .env
```env
# Multi-agent service
MULTI_AGENT_URL=http://localhost:8000/api/task
MULTI_AGENT_API_KEY=your-key
```

---

## AI Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/ai/status` | Current provider, available models, configuration |
| `GET /api/ai/models` | List of available models for current provider |
| `POST /api/ai/chat` | Chat with AI (rate limited: 20/min/user) |
| `POST /api/ai/summarize` | Summarize last 50 messages in a conversation |
| `POST /api/ai/translate` | Translate text to any language |
| `POST /api/ai/moderate` | Content moderation (spam/abuse detection) |
| `POST /api/ai/transcribe` | Speech-to-text (voice message transcription) |

## Security
- All endpoints require authentication
- Rate limited (20 requests/min/user)
- AI outputs treated as untrusted
- No automatic action without user approval
- Self-hosted models (Ollama) keep data on your server
