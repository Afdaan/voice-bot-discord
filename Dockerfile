FROM node:22-alpine AS builder

ENV NODE_ENV=production

WORKDIR /app

RUN apk add --no-cache g++ make python3

COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runner

ENV NODE_ENV=production

WORKDIR /app

RUN apk add --no-cache ffmpeg libopus

COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src

USER node

CMD ["node", "src/index.js"]
