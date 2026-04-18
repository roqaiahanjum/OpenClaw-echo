# OpenClaw Echo: Production Container
# Uses ts-node --transpile-only to avoid high-memory tsc compilation
FROM node:18-alpine
WORKDIR /app

# Install dependencies including devDependencies (needed for ts-node/typescript)
COPY package*.json ./
RUN npm install

# Copy the full source
COPY . .

# Ensure sandbox directory and dynamic skills exist
RUN mkdir -p src/sandbox src/skills/dynamic

EXPOSE 3005

CMD ["npm", "start"]
