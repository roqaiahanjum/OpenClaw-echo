# ============================================================
# OpenClaw Echo: Multi-Stage Production Build
# Stage 1: Build Dashboard  |  Stage 2: Production Runner
# ============================================================

# --- STAGE 1: BUILD THE DASHBOARD ---
FROM node:20-alpine AS dashboard-builder
WORKDIR /build

COPY dashboard/package*.json ./
RUN npm install --legacy-peer-deps --legacy-peer-deps

COPY dashboard/ ./
RUN npm run build


# --- STAGE 2: PRODUCTION RUNNER ---
FROM node:20-alpine
WORKDIR /app

# Install curl for healthchecks
RUN apk add --no-cache curl

# Install backend dependencies (includes devDeps for ts-node)
COPY package*.json ./
RUN npm install --legacy-peer-deps

# Copy backend source
COPY src/ ./src/
COPY tsconfig.json ./
COPY .env* ./

# Copy compiled dashboard from Stage 1
COPY --from=dashboard-builder /build/dist ./dashboard/dist

# Ensure sandbox & dynamic skill directories exist
RUN mkdir -p src/sandbox src/skills/dynamic

EXPOSE 3005

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:3005/api/status || exit 1

CMD ["npx", "ts-node", "--transpile-only", "src/index.ts"]
