# Free & Low-Cost Cloud Compute for Small AI Models (0.8B-3B) - 2026

## Executive Summary

For an AI agent system running small models (0.8B-3B parameters) as "tentacles," the best
strategy combines: **(1)** Oracle Cloud Free Tier for persistent self-hosted inference,
**(2)** free inference APIs (Groq, Cerebras, Google AI Studio, OpenRouter) for burst capacity,
and **(3)** Cloudflare Workers AI for edge/serverless inference. This combination can provide
substantial inference capacity at zero cost.

---

## 1. FREE TIER CLOUD COMPUTE (Self-Hosted Inference)

### Comparison Table

| Provider | Always Free? | Compute | RAM | Storage | Can Run 0.8B-3B? | Notes |
|----------|-------------|---------|-----|---------|-------------------|-------|
| **Oracle Cloud** | Yes, forever | 4 ARM OCPUs (Ampere A1) | 24 GB | 200 GB block | **YES - Best option** | Run Ollama + multiple small models simultaneously |
| **Google Cloud** | Yes, forever | 1 e2-micro (0.25 vCPU burst to 2) | 1 GB | 30 GB | **NO** - insufficient RAM | Only useful for lightweight orchestration/proxy |
| **AWS** | Lambda: forever; EC2: 12 months | Lambda: 1M req/mo; EC2: t2.micro | Lambda: 10 GB; EC2: 1 GB | 5 GB Lambda, 30 GB EBS | **NO** for EC2; Lambda too short | Lambda useful for orchestration (15 min max) |
| **Azure** | VMs: 12 months | B1S + B2pts v2 (ARM) + B2ats v2 | 0.5-8 GB | 64 GB | **Maybe** B2pts with 8 GB for 0.8B quantized | $200 credit first 30 days; VMs only free 12 months |
| **Modal** | Yes (credits) | $30/mo free credits, serverless GPU | Varies | Ephemeral | **YES** with GPU credits | ~30 min of T4 GPU or ~1hr CPU per month at $30 |

### Detailed Breakdown

#### Oracle Cloud Free Tier (BEST FOR SELF-HOSTED)
- **What's free**: 4 OCPUs ARM Ampere Altra, 24 GB RAM, 200 GB block storage - FOREVER
- **AI inference capability**: Excellent. Can run multiple small models via Ollama simultaneously
- **Performance**: 0.8B-1.5B models: ~10-15 tokens/sec; 3B models: ~3-8 tokens/sec on ARM CPU
- **Setup**: Install Ollama, pull quantized models (Q4_K_M), expose via API
- **Gotcha**: Instance provisioning can be difficult in popular regions; may need to try off-peak or temporarily upgrade to PAYG
- **Proven**: Oracle's own blog documents running Llama models on Ampere A1 free tier

#### Google Cloud Free Tier
- **What's free**: 1 e2-micro VM (0.25 vCPU, 1 GB RAM), 30 GB disk, 1 GB egress/month - FOREVER
- **AI inference capability**: Cannot run models. Useful only as API gateway/orchestrator
- **Also free**: Various AI APIs have free quotas (Vision, NLP, Translation)
- **Bonus**: $300 credit for 90 days (new accounts) - can run T4 GPU instances temporarily

#### AWS Free Tier
- **Lambda (forever free)**: 1M requests/month, 400K GB-seconds. Good for orchestration, not model hosting
- **SageMaker (2 months)**: 125 hours m4.xlarge for inference - useful but temporary
- **EC2 (12 months)**: t2.micro with 1 GB RAM - insufficient for model inference
- **Best use**: Lambda as API orchestration layer routing to free inference APIs

#### Azure Free Tier
- **VMs (12 months)**: B1S (1 vCPU, 1 GB), B2pts v2 (ARM, 2 vCPU, 1 GB), B2ats v2 (AMD, 2 vCPU, 1 GB)
- **Credits**: $200 for first 30 days
- **AI inference**: Too little RAM for model hosting on always-free VMs
- **Best use**: Temporary experimentation with $200 credit

---

## 2. FREE AI INFERENCE APIs

### Comparison Table

| Provider | Free Tier | Rate Limits | Latency | Small Models Available | Best For |
|----------|-----------|-------------|---------|----------------------|----------|
| **Groq** | Forever free | 30 RPM, 14.4K req/day (8B) | ~50ms TTFT, 800 tok/s | Llama 3.2 1B/3B, Gemma | **Fastest inference** |
| **Cerebras** | Forever free | 30 RPM, 1M tokens/day | Ultra-fast | Llama 3.3 70B, Qwen3 | Speed + generous daily tokens |
| **Google AI Studio** | Forever free | 10 RPM, 250 req/day (Flash) | Good | Gemini 3.1 Flash/Pro | Best model quality on free tier |
| **Cloudflare Workers AI** | 10K neurons/day | 1.5-3K RPM | Edge-low | Llama 3.2 1B, Mistral, Phi | **Edge inference, simple API** |
| **OpenRouter** | Forever free | 50 req/day (or 1K with $10 purchase) | Varies | 24 free models | **Model variety/routing** |
| **SambaNova** | Forever free | 10-30 RPM by model size | Fast | Llama 3.1 8B/70B/405B | Large model access |
| **Hugging Face** | ~$0.10/mo credits | Low, cold starts 10-30s | Slow | Thousands of models | Testing/prototyping only |
| **Together AI** | $100 signup credit | Standard API limits | Good | 200+ models | Large initial credit pool |
| **Mistral** | Free for small models | Limited | Good | Mistral small variants | Mistral ecosystem |

### Detailed Breakdown

#### Groq (RECOMMENDED - Primary Fast Inference)
- **Free forever**: No credit card required
- **Rate limits**: ~30 RPM on most models, 1K req/day on 70B, 14.4K req/day on 8B
- **Speed**: 800+ tokens/second on Llama 3, sub-100ms time to first token
- **Models**: Llama 3.2 1B, Llama 3.2 3B, Llama 3.3 70B, Gemma, Mixtral
- **Best for**: High-speed inference tentacles needing fast responses

#### Cerebras (RECOMMENDED - High Volume)
- **Free forever**: 1 million tokens per day
- **Rate limits**: 30 RPM, 8K context window
- **Speed**: Claims 20x faster than NVIDIA
- **Models**: Llama 3.3 70B, Qwen3 32B, GPT-OSS 120B
- **Best for**: Workloads needing high daily token throughput

#### Google AI Studio / Gemini API (RECOMMENDED - Quality)
- **Free forever**: No credit card, all regions
- **Rate limits**: 5-15 RPM depending on model, 100-250 requests/day
- **Models**: Gemini 3.1 Pro, Gemini 2.5 Flash (as of March 2026)
- **Best for**: Tasks requiring highest model quality on free tier

#### Cloudflare Workers AI (RECOMMENDED - Edge)
- **Free**: 10,000 neurons/day (roughly maps to tokens)
- **Beyond free**: $0.011 per 1,000 neurons
- **Models**: Llama 3.2 (including 1B), Mistral 7B, Whisper, FLUX.2
- **Best for**: Edge inference, low-latency global distribution
- **Note**: Neurons != tokens; actual free capacity depends on model

#### OpenRouter (RECOMMENDED - Routing)
- **Free**: 24 free models, 50 req/day (1K/day with any $10+ purchase)
- **Models**: Gemini 2.0 Flash, Llama 3.3 70B, various community models
- **Special**: `openrouter/free` meta-model auto-routes to best available free model
- **Best for**: Failover routing, testing multiple models

#### SambaNova Cloud
- **Free forever**: Indefinite access
- **Rate limits**: 10-30 RPM depending on model
- **Speed**: 461 tok/s on 70B, 132 tok/s on 405B
- **Best for**: Access to very large models (405B) for free

---

## 3. FREE COMPUTE PLATFORMS (Notebook/GPU Access)

### Comparison Table

| Platform | Free GPU | GPU Type | Session Limit | Weekly/Monthly Hours | Storage | Persistent? |
|----------|----------|----------|---------------|---------------------|---------|------------|
| **Google Colab** | Yes | T4/K80 | 12 hrs max | ~30 hrs/week | 100 GB temp | No |
| **Kaggle** | Yes | T4/P100 | 9 hrs | 30 hrs/week | 20 GB | Limited |
| **Lightning.ai** | Yes | T4/L4/A10G | 4 hr restart | 15-35 hrs/month | 100 GB | **Yes** |
| **GitHub Codespaces** | CPU only | None | Continuous | 60 hrs/month (2-core) | 15 GB | Yes |

### Detailed Breakdown

#### Google Colab (BEST FREE GPU)
- **Free GPU**: T4 (sometimes K80), not guaranteed
- **Limits**: ~12 hours max session, ~30 hours/week GPU, 2 concurrent notebooks
- **RAM**: 12-13 GB system RAM + GPU VRAM
- **Storage**: Temporary, wiped on disconnect
- **Can run 0.8B-3B**: Yes, easily with T4 GPU (16 GB VRAM)
- **Limitation**: Not suitable for persistent inference (sessions disconnect)

#### Kaggle Notebooks
- **Free GPU**: T4 or P100, 30 hours/week
- **Session limit**: 9 hours per session
- **Background execution**: Yes - can run after closing browser
- **Storage**: 20 GB
- **Can run 0.8B-3B**: Yes
- **Advantage**: Background execution makes it better than Colab for longer jobs

#### Lightning.ai Studios
- **Free GPU**: T4, L4, A10G - ~15-35 hours/month
- **Persistent storage**: 100 GB included
- **Features**: Full IDE environment, not just notebooks
- **Can run 0.8B-3B**: Yes
- **Advantage**: Persistent environment means less setup time

#### GitHub Codespaces
- **Free**: 60 hours/month on 2-core, 15 GB storage
- **GPU**: None on free tier
- **Can run 0.8B-3B**: Only tiny models on CPU, very slow
- **Best use**: Development environment, orchestration code

---

## 4. SERVERLESS / EDGE OPTIONS

### Comparison Table

| Platform | Free Tier | Execution Limit | Memory | AI Inference? | Best For |
|----------|-----------|----------------|--------|---------------|----------|
| **Cloudflare Workers AI** | 10K neurons/day | 30s CPU / streaming | 128 MB Worker | **Yes, native** | Edge AI inference |
| **Cloudflare Workers** | 100K req/day | 10ms CPU (free) | 128 MB | Orchestration only | API routing/proxy |
| **Vercel Edge** | 100 GB bandwidth | 25s (streaming 300s) | 128 MB | No native GPU | Frontend/API proxy |
| **Deno Deploy** | 1M req/month | 50ms CPU | 512 MB | No native GPU | Lightweight API |
| **Fly.io** | Trial only (2 hrs) | Varies | 256 MB | **No GPU support** | Not recommended |
| **AWS Lambda** | 1M req/month forever | 15 min max | Up to 10 GB | CPU inference possible | Orchestration |

### Key Insight for Serverless AI

**Cloudflare Workers AI is the only serverless platform with native AI model inference on the free tier.**
All others require calling external inference APIs from within your serverless function.

The recommended pattern for edge/serverless:
1. Use Cloudflare Workers AI for direct small model inference at the edge
2. Use Vercel/Deno/Workers as API gateways that route to free inference APIs (Groq, Cerebras, etc.)
3. Use AWS Lambda for longer-running orchestration tasks (up to 15 min)

---

## 5. COST OPTIMIZATION STRATEGIES

### Strategy 1: Multi-Provider Free Tier Stacking

Combine free tiers across providers for maximum capacity:

```
Daily Free Capacity (estimated):
- Groq:              ~14,400 requests (8B models) or ~500K-1M tokens
- Cerebras:          ~1,000,000 tokens
- Google AI Studio:  ~250 requests (Flash) = ~250K tokens
- Cloudflare:        ~10,000 neurons
- OpenRouter:        ~50 requests
- SambaNova:         ~1,000+ requests
------------------------------------------------------
TOTAL:               ~2-3 million tokens/day FREE
```

### Strategy 2: Oracle Cloud as Persistent Base

1. **Set up Oracle Cloud Free Tier** with Ollama running Llama 3.2 1B (Q4 quantized)
2. This gives you 24/7 inference at ~10-15 tok/s - no rate limits, no daily caps
3. Use free inference APIs (Groq, Cerebras) for burst/overflow
4. Route via Cloudflare Workers for load balancing

### Strategy 3: Tiered Routing by Task Complexity

```
Simple tasks (classification, extraction) --> Oracle Cloud self-hosted 0.8B-1B
Medium tasks (summarization, Q&A)         --> Groq/Cerebras free tier (3B-8B)
Complex tasks (reasoning, planning)       --> Google AI Studio Gemini (free)
Fallback                                  --> OpenRouter free model router
```

### Strategy 4: Spot/Preemptible for Cheap Burst

When free tiers are exhausted:
- **Vast.ai**: GPU from $0.15/hr (marketplace model, 50-70% cheaper than hyperscalers)
- **RunPod spot**: T4 from $0.20/hr
- **GCP preemptible**: T4 at ~$0.11/hr (80% off on-demand)
- **Modal**: Pay-per-second with scale-to-zero, $30/mo free credit

### Strategy 5: Model Size Optimization

For 0.8B-3B models, prefer quantized versions:
- **Q4_K_M quantization**: ~50% size reduction, minimal quality loss
- **0.8B model**: ~500 MB RAM (quantized) - runs on almost anything
- **1.5B model**: ~1 GB RAM (quantized) - comfortable on free VMs
- **3B model**: ~2 GB RAM (quantized) - needs Oracle Cloud or GPU platform

---

## 6. RECOMMENDED ARCHITECTURE FOR "TENTACLES"

### Zero-Cost Tentacle Setup

```
                    +------------------+
                    |   Orchestrator   |
                    | (Cloudflare      |
                    |  Worker / Lambda)|
                    +--------+---------+
                             |
              +--------------+--------------+
              |              |              |
     +--------v---+  +------v------+  +----v--------+
     | Oracle OCI |  | Groq API    |  | Cerebras    |
     | Free ARM   |  | Free Tier   |  | Free Tier   |
     | Ollama     |  | 14K req/day |  | 1M tok/day  |
     | 0.8B-3B    |  | 800 tok/s   |  | Ultra-fast  |
     | 24/7       |  | Llama 3.2   |  | Llama/Qwen  |
     +------------+  +-------------+  +-------------+
              |              |              |
     +--------v---+  +------v------+  +----v--------+
     | Google AI  |  | Cloudflare  |  | OpenRouter  |
     | Studio     |  | Workers AI  |  | Free Models |
     | Gemini     |  | 10K neur/d  |  | 24 models   |
     | 250 req/d  |  | Edge deploy |  | 50 req/day  |
     +------------+  +-------------+  +-------------+
```

### Priority Order for Tentacle Deployment

1. **Oracle Cloud Free Tier** - Deploy first. 24/7 persistent, no rate limits, your own infra
2. **Groq Free API** - Fastest inference, generous free limits for small models
3. **Cerebras Free API** - 1M tokens/day, excellent speed
4. **Google AI Studio** - Highest quality models on free tier
5. **Cloudflare Workers AI** - Edge deployment, global low-latency
6. **SambaNova Cloud** - Additional free capacity, fast inference
7. **OpenRouter** - Fallback routing to 24 free models

### Cost Projection

| Usage Level | Monthly Cost | How |
|-------------|-------------|-----|
| Light (10K req/day) | **$0** | Oracle + Groq + Cerebras free tiers |
| Medium (50K req/day) | **$0-5** | All free tiers + occasional Cloudflare overflow |
| Heavy (200K req/day) | **$15-30** | Free tiers + Modal $30/mo + spot instances |
| Very Heavy (1M req/day) | **$50-100** | Free tiers + Vast.ai/RunPod spot GPUs |

---

## 7. KEY FINDINGS & WARNINGS

### What Works in 2026
- Oracle Cloud Free Tier is the undisputed champion for persistent self-hosted inference
- The free inference API landscape is remarkably generous (Groq, Cerebras, Google AI Studio)
- 0.8B-3B models run well on ARM CPUs with quantization - GPU not required
- Multi-provider stacking can provide millions of free tokens daily

### Watch Out For
- **Oracle Cloud provisioning**: ARM instances are hard to get in popular regions; be persistent
- **Google AI Studio rate cuts**: Google quietly reduced free tier limits in Dec 2025; may happen again
- **Fly.io**: No longer has a meaningful free tier and abandoned GPU ambitions
- **Hugging Face free tier**: Only $0.10/month in credits; essentially unusable for production
- **Cold starts**: HuggingFace (10-30s), some OpenRouter models have significant cold start delays
- **Cloudflare neurons**: 10K neurons/day sounds generous but maps to fewer tokens than you'd expect

### Models Recommended for Tentacles
| Model | Params | Quantized Size | Best On | Use Case |
|-------|--------|---------------|---------|----------|
| Llama 3.2 1B | 1B | ~700 MB | Oracle ARM, Groq | Fast classification, extraction |
| Qwen 2.5 1.5B | 1.5B | ~1 GB | Oracle ARM, Cerebras | Multilingual, coding |
| Phi-3.5 Mini | 3.8B | ~2.3 GB | Oracle ARM, GPU platforms | Reasoning, math |
| Gemma 2 2B | 2B | ~1.5 GB | Oracle ARM, Groq | General purpose |
| SmolLM2 1.7B | 1.7B | ~1 GB | Oracle ARM, any CPU | Quality per parameter |
