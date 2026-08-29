# layoverjoy-dind-v1 Snapshot 定义（08 文档 §16）。
# 基础镜像固定版本，禁止 latest。包含 Docker daemon、Compose、Git 与 Node LTS。
FROM docker:28.3.3-dind

RUN apk add --no-cache \
    bash \
    curl \
    git \
    jq \
    nodejs=22.16.0-r2 \
    npm \
    && ln -sf /bin/sh /usr/bin/sh || true

# Docker Compose v2 插件（固定版本）
RUN mkdir -p /usr/local/lib/docker/cli-plugins \
    && curl -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose \
       https://github.com/docker/compose/releases/download/v2.36.2/docker-compose-linux-$(uname -m) \
    && chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

WORKDIR /workspace

# entrypoint：先拉起 dockerd 再执行命令（Daytona DinD snapshot 约定）
RUN printf '#!/bin/sh\ndockerd-entrypoint.sh &\nexec "$@"\n' > /entrypoint.sh && chmod +x /entrypoint.sh
