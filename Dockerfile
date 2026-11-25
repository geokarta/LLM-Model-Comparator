# Stage 1: Build Vite frontend
FROM node:22-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Production runtime (Express API + Static Frontend + Live Harvester)
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package*.json ./
RUN npm ci

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/tsconfig*.json ./

RUN mkdir -p /app/data

EXPOSE 8080

CMD ["npx", "tsx", "server/index.ts"]
