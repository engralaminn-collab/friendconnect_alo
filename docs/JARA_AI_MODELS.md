# Jara AI Model Catalog

Curated open-source AI models and infrastructure for **Jara** (FriendConnect's AI companion) and ALO Labs. This catalog tracks candidate repositories for digital human/avatar, Bengali voice, speech recognition, LLM brain, real-time meeting, and supporting infrastructure.

> Status: catalog/reference. Adding a repository here does not mean it is installed or bundled in production. Evaluate license, maintenance, hardware requirements, and Bangla quality before integration.

## 1. Digital Human & AI Avatar

| # | Project | GitHub | Notes |
|---|---------|--------|-------|
| 1 | Mynah | [honwee/mynah](https://github.com/honwee/mynah) | Lightweight 2D avatar baseline |
| 2 | AI Avatar System | [PunithVT/ai-avatar-system](https://github.com/PunithVT/ai-avatar-system) | Avatar system reference implementation |
| 3 | Vivora | [sur950/vivora](https://github.com/sur950/vivora) | Digital human/avatar project |
| 4 | Nosi | [ZoreAnuj/nosi](https://github.com/ZoreAnuj/nosi) | Avatar/assistant experiment |
| 5 | MuseTalk | [TMElyralab/MuseTalk](https://github.com/TMElyralab/MuseTalk) | Real-time lip-sync / talking head |
| 6 | LivePortrait | [KlingAIResearch/LivePortrait](https://github.com/KlingAIResearch/LivePortrait) | Portrait animation / facial reenactment |

## 2. Bengali Text-to-Speech (TTS)

| # | Project | GitHub | Notes |
|---|---------|--------|-------|
| 7 | Orpheus Bengali Fine-tuning | [kawshikbuet17/Orpheus-TTS-Bengali-Finetuning](https://github.com/kawshikbuet17/Orpheus-TTS-Bengali-Finetuning) | Bengali fine-tuning for Orpheus TTS |
| 8 | Chatterbox Bangla | [jongy5/chatterbox-bangla](https://github.com/jongy5/chatterbox-bangla) | Bangla adaptation of Chatterbox |
| 9 | Chatterbox Original | [resemble-ai/chatterbox](https://github.com/resemble-ai/chatterbox) | Upstream Chatterbox TTS |
| 10 | Bangladeshi Bangla TTS | [EMTIAZ-RUET/bangladeshi-bangla-tts-finetuning](https://github.com/EMTIAZ-RUET/bangladeshi-bangla-tts-finetuning) | Bangladeshi Bangla TTS fine-tuning |
| 11 | BanglaTTS | [shhossain/BanglaTTS](https://github.com/shhossain/BanglaTTS) | Bangla TTS toolkit/model |
| 12 | Text-to-Speech | [ratscse/text-to-speech](https://github.com/ratscse/text-to-speech) | General/Bangla TTS reference |

## 3. Bengali Speech Recognition (ASR)

| # | Project | GitHub | Notes |
|---|---------|--------|-------|
| 13 | IndicConformer ASR | [AI4Bharat/IndicConformerASR](https://github.com/AI4Bharat/IndicConformerASR) | Indic ASR, strong Bengali candidate |
| 14 | Whisper | [openai/whisper](https://github.com/openai/whisper) | Multilingual ASR baseline |
| 15 | Faster Whisper | [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper) | Optimized Whisper inference |
| 16 | FunASR | [modelscope/FunASR](https://github.com/modelscope/FunASR) | ASR toolkit with production features |
| 17 | ESPnet | [espnet/espnet](https://github.com/espnet/espnet) | End-to-end speech toolkit |
| 18 | NVIDIA NeMo | [NVIDIA/NeMo](https://github.com/NVIDIA/NeMo) | Speech/LLM toolkit, GPU-oriented |

## 4. Bengali AI Brain (LLM)

| # | Project | GitHub | Notes |
|---|---------|--------|-------|
| 19 | BanglaLlama | [BanglaLLM/bangla-llama](https://github.com/BanglaLLM/bangla-llama) | Bangla-focused Llama adaptation |
| 20 | BanglaLLM-7B | [FHJibon/BanglaLLM-7B](https://github.com/FHJibon/BanglaLLM-7B) | Bangla 7B LLM |
| 21 | Qwen3 | [QwenLM/Qwen3](https://github.com/QwenLM/Qwen3) | Strong multilingual base model family |
| 22 | Bornomala | [konkomaji/bornomala](https://github.com/konkomaji/bornomala) | Bengali language AI project |
| 23 | Awesome Bengali AI | [Iamsdt/awesome-bengali-ai](https://github.com/Iamsdt/awesome-bengali-ai) | Curated Bengali AI resource list |

## 5. Live Video Meeting & Real-time AI

| # | Project | GitHub | Notes |
|---|---------|--------|-------|
| 24 | LiveKit Server | [livekit/livekit](https://github.com/livekit/livekit) | SFU/media server for realtime audio/video |
| 25 | LiveKit Agents | [livekit/agents](https://github.com/livekit/agents) | Realtime voice/AI agent framework |
| 26 | Pipecat | [pipecat-ai/pipecat](https://github.com/pipecat-ai/pipecat) | Voice/multimodal agent pipeline |

## 6. Additional Infrastructure

| # | Project | GitHub | Notes |
|---|---------|--------|-------|
| 27 | Ollama | [ollama/ollama](https://github.com/ollama/ollama) | Local LLM runtime |
| 28 | vLLM | [vllm-project/vllm](https://github.com/vllm-project/vllm) | High-throughput LLM serving |
| 29 | llama.cpp | [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp) | CPU/edge LLM inference |
| 30 | Open WebUI | [open-webui/open-webui](https://github.com/open-webui/open-webui) | Self-hosted AI UI/admin surface |
| 31 | Rasa | [RasaHQ/rasa](https://github.com/RasaHQ/rasa) | Conversational AI / assistant framework |
| 32 | LangGraph | [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph) | Stateful agent orchestration/memory |
| 33 | OpenVoice | [myshell-ai/OpenVoice](https://github.com/myshell-ai/OpenVoice) | Voice cloning / tone control |
| 34 | Coqui TTS | [coqui-ai/TTS](https://github.com/coqui-ai/TTS) | Open-source TTS toolkit |
| 35 | Wav2Lip | [Rudrabha/Wav2Lip](https://github.com/Rudrabha/Wav2Lip) | Lip-sync generation baseline |

## 7. ALO Labs Implementation Priority

| Priority | কাজ (Work) | Repository | Suggested first milestone |
|----------|------------|------------|---------------------------|
| P0 | Bengali voice | Orpheus / Chatterbox | Pick one Bengali TTS path, benchmark naturalness + latency on Bangla scripts |
| P0 | Bengali ASR | IndicConformer | Evaluate Bangla WER/latency against Whisper/Faster Whisper baseline |
| P0 | AI Brain | Qwen3 / BanglaLlama | Select primary Bangla-capable LLM and define Jara system prompt/eval set |
| P1 | Digital Human | Mynah / MuseTalk | Prototype talking avatar with prerecorded Bangla audio |
| P1 | Facial animation | LivePortrait | Evaluate portrait-driven animation quality and GPU cost |
| P1 | Real-time meeting | LiveKit / Pipecat | Prototype realtime voice agent in meeting/group context |
| P2 | Local inference | Ollama / llama.cpp | Local dev/offline fallback runtime |
| P2 | High-performance inference | vLLM | Production GPU serving path for selected LLM |
| P2 | Agent memory | LangGraph | Stateful memory/tool orchestration for Jara |
| P2 | Voice cloning | OpenVoice | Controlled voice identity experiments with consent/safety gates |

## Integration Notes

- **Jara identity is stable**: model/runtime changes should not change Jara's user identity, history, or governance audit trail.
- **Bangla-first evaluation**: benchmark ASR/TTS/LLM on Bangla and Banglish, not only English demos.
- **Self-hosted preference**: prefer deployable/open components where latency, privacy, and cost require it; document any external API dependency explicitly.
- **Safety & consent**: voice cloning, face animation, and meeting listening require explicit consent, audit logs, and clear UI disclosure.
- **License review required**: verify each repo/model license before production use, especially for commercial deployment, model weights, and redistributed assets.

## Related Docs

- [JARA_ARCHITECTURE.md](./JARA_ARCHITECTURE.md) — Jara system architecture and governance flow.
- [JARA_DEPENDENCY_INVENTORY.md](./JARA_DEPENDENCY_INVENTORY.md) — current dependency/license inventory.
- [JARA_BANGLA_VOICE_REPORT.md](./JARA_BANGLA_VOICE_REPORT.md) — Bangla voice findings.
- [open-source-ai-models.md](./open-source-ai-models.md) — AI gateway/provider configuration.
