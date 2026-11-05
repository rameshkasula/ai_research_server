# AI Research Assistant — Production Deployment & Monitoring Guide

## 1. Architecture Overview

| Component | Technology | Recommended Hosting |
| :--- | :--- | :--- |
| **Backend API & SSE Server** | Node.js + Express + TypeScript | Render / AWS ECS / Railway |
| **Database & Vector Search** | MongoDB + Atlas Vector Search (`vector_index`) | MongoDB Atlas |
| **Object Storage** | Cloudinary (`resource_type: 'raw'`) | Cloudinary |
| **Caching & Idempotency** | TTL Cache / Redis | Upstash / Managed Redis |
| **AI & Embeddings** | Google Gemini (`gemini-2.5-flash` + `text-embedding-004`) | Google AI Studio / Vertex AI |

---

## 2. Production Environment Variables

Configure these variables in your hosting provider (Render / AWS):

```env
NODE_ENV=production
PORT=5000
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/ai_research_assistant
CORS_ORIGIN=https://your-frontend-domain.vercel.app
LOG_LEVEL=info

# JWT Security (Use strong 64-character random secrets in production)
JWT_ACCESS_SECRET=<production_access_secret>
JWT_REFRESH_SECRET=<production_refresh_secret>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
BCRYPT_SALT_ROUNDS=12

# Cloudinary Object Storage
STORAGE_PROVIDER=cloudinary
CLOUDINARY_CLOUD_NAME=<cloud_name>
CLOUDINARY_API_KEY=<api_key>
CLOUDINARY_API_SECRET=<api_secret>
CLOUDINARY_FOLDER=ai_research_assistant

# Gemini AI
GEMINI_API_KEY=<gemini_api_key>
GEMINI_EMBEDDING_MODEL=text-embedding-004
GEMINI_CHAT_MODEL=gemini-2.5-flash
GEMINI_TIMEOUT_MS=45000

# Optional External Web Search Providers
TAVILY_API_KEY=<tavily_api_key>
SERPER_API_KEY=<serper_api_key>

# Rate Limiting & Redis
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
AI_RATE_LIMIT_MAX_REQUESTS=20
REDIS_URL=redis://<host>:6379
```

---

## 3. MongoDB Atlas Vector Search Index Setup

In MongoDB Atlas -> **Atlas Search** -> **Create Search Index** -> **JSON Editor** on collection `chunks`:
(You can also fetch this definition directly via `GET /api/search/atlas-index-config`):

```json
{
  "name": "vector_index",
  "type": "vectorSearch",
  "definition": {
    "fields": [
      {
        "type": "vector",
        "path": "embedding",
        "numDimensions": 768,
        "similarity": "cosine"
      },
      { "type": "filter", "path": "workspaceId" },
      { "type": "filter", "path": "documentId" },
      { "type": "filter", "path": "userId" }
    ]
  }
}
```

---

## 4. Docker Deployment

```bash
# Build and start full stack (API + MongoDB + Redis)
docker compose up -d --build

# Check health status
curl http://localhost:5000/health?detailed=true
```

---

## 5. Health Checks & Observability Endpoints

- **Health Check**: `GET /health?detailed=true` (Checks process uptime, memory usage, and MongoDB connection state)
- **AI Token & Cost Telemetry**: `GET /api/observability/usage`
- **System & Cache Metrics**: `GET /api/observability/metrics`
- **RAG Groundedness & Prompt Injection Evaluator**: `POST /api/observability/evaluate-rag`

