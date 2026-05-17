FROM node:22-bookworm-slim AS builder

ENV NODE_ENV=production
WORKDIR /app

# Install build dependencies and immediately clean apt cache
RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential python3 && \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/*

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production
WORKDIR /app

# Install runtime audio dependencies and strictly remove all apt/package cache
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg libopus0 && \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/*

COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src

USER node

CMD ["node", "--max-old-space-size=384", "src/index.js"]
