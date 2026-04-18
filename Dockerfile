# OpenClaw Echo: Production Container
# Uses ts-node --transpile-only to avoid high-memory tsc compilation
FROM node:18-alpine
WORKDIR /app

# Install curl for healthchecks
RUN apk add --no-cache curl

# Install dependencies including devDependencies (needed for ts-node/typescript)
COPY package*.json ./
RUN npm install

# Copy the full source
COPY . .

# Ensure sandbox directory and dynamic skills exist
RUN mkdir -p src/sandbox src/skills/dynamic

EXPOSE 3005

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:3005/api/status || exit 1

CMD ["npm", "start"]
