<!-- Auto-generated summary — 2026-04-25 -->
# kg-service-mutation

KG service uses **PATCH /api/v1/knowledge/{id}** for general mutations (content, tags, status), not PUT, with relations encoded as markdown sections inside documents rather than in a separate `/relationships` endpoint. The service is a **mutable document store** where AI summaries are managed via a distinct PUT sub-resource (`/ai`), and all mutations advance `updated_at` timestamps for tracking.
