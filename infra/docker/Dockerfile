# LayoverJoy 后端镜像（多阶段构建，固定版本标签）
FROM node:20.18.1-alpine3.20 AS builder
WORKDIR /app
# argon2 原生模块构建兜底依赖
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npx prisma generate && npm run build

FROM node:20.18.1-alpine3.20 AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npm i --no-save prisma@5.22.0 && npx prisma generate --no-hints
COPY --from=builder /app/dist ./dist
# entrypoint：api 模式先同步 schema与种子；worker 模式直接启动
RUN printf '#!/bin/sh\nset -e\nif [ "$1" = "worker" ]; then\n  exec node dist/worker.js\nfi\nnpx prisma db push --skip-generate\nnode dist/seed.js\nexec node dist/main.js\n' > /entrypoint.sh \
    && chmod +x /entrypoint.sh
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
CMD ["api"]
