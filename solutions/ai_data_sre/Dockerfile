# ─── Stage 1: Build React frontend ────────────────────────────────────────
FROM node:18-alpine AS frontend

WORKDIR /app/web
COPY solutions/ai_data_sre/web/package.json solutions/ai_data_sre/web/package-lock.json* ./
RUN npm ci --ignore-scripts
COPY solutions/ai_data_sre/web/ ./
RUN npm run build

# ─── Stage 2: Python backend ─────────────────────────────────────────────
FROM python:3.11-slim AS backend

WORKDIR /app

# Install system deps for pymysql and httpx
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY solutions/ai_data_sre/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY solutions/ai_data_sre/core/ core/
COPY solutions/ai_data_sre/api/ api/

# Copy built frontend from stage 1
COPY --from=frontend /app/web/dist web/dist/

# Environment defaults (override at runtime)
ENV PORT=8000
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:8000/api/health || exit 1

CMD ["python", "-m", "api.server"]
