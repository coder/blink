FROM ubuntu:24.04

ENV LANG="C.UTF-8"

### MINIMAL BASE PACKAGES ###
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        build-essential \
        unzip \
        xz-utils \
        sudo \
        gnupg \
        lsof \
        net-tools \
    && rm -rf /var/lib/apt/lists/*

### DOCKER ENGINE ###
RUN curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu noble stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        docker-ce \
    && rm -rf /var/lib/apt/lists/*

### GITHUB CLI ###
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | gpg --dearmor -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        gh \
    && rm -rf /var/lib/apt/lists/*

### CREATE BLINK USER ###
RUN groupadd -r blink && useradd -r -g blink -m -s /bin/bash blink \
    && echo 'blink ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers \
    && usermod -aG docker blink

### CREATE WORKSPACE DIRECTORY ###
RUN mkdir -p /workspace && chown blink:blink /workspace

USER blink
ENV HOME=/home/blink
WORKDIR /workspace

### NODE VIA NVM ###
ARG NODE_VERSION=22.13.0
ENV NVM_DIR=/home/blink/.nvm
ENV PATH=/home/blink/.local/bin:/home/blink/.local/bun/bin:$NVM_DIR/versions/node/v${NODE_VERSION}/bin:$PATH
RUN mkdir -p $NVM_DIR \
    && curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash \
    && . $NVM_DIR/nvm.sh \
    && nvm install $NODE_VERSION \
    && nvm use $NODE_VERSION \
    && nvm alias default $NODE_VERSION \
    && npm install -g typescript prettier eslint pnpm yarn \
    && echo 'export NVM_DIR="$HOME/.nvm"' >> /home/blink/.bashrc \
    && echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> /home/blink/.bashrc \
    && echo '[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"' >> /home/blink/.bashrc

### BUN ###
ARG BUN_VERSION=1.2.14
RUN mkdir -p /home/blink/.local/bun/bin \
    && curl -L "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64-baseline.zip" \
        -o /tmp/bun.zip \
    && unzip -q /tmp/bun.zip -d /tmp \
    && mv /tmp/bun-linux-x64-baseline/bun /home/blink/.local/bun/bin/ \
    && chmod +x /home/blink/.local/bun/bin/bun \
    && rm -rf /tmp/bun.zip /tmp/bun-linux-x64-baseline

### PYTHON (system python + pip) ###
USER root
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        python3-venv \
    && rm -rf /var/lib/apt/lists/*
USER blink
RUN python3 -m pip install --user --break-system-packages \
        black ruff mypy uv

### GO ###
ARG GO_VERSION=1.23.8
ENV PATH=/home/blink/.local/go/bin:/home/blink/go/bin:$PATH
RUN mkdir -p /home/blink/.local \
    && curl -L "https://dl.google.com/go/go${GO_VERSION}.linux-amd64.tar.gz" \
        | tar -xz -C /home/blink/.local \
    && mv /home/blink/.local/go /home/blink/.local/go-tmp \
    && mkdir -p /home/blink/.local/go \
    && mv /home/blink/.local/go-tmp/* /home/blink/.local/go/ \
    && rmdir /home/blink/.local/go-tmp

### RUST ###
ENV PATH=/home/blink/.cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
        sh -s -- -y --profile minimal --no-modify-path

### RIPGREP (manual install) ###
ARG RG_VERSION=14.1.1
RUN curl -L "https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
        | tar -xz --strip-components=1 -C /tmp \
    && mkdir -p /home/blink/.local/bin \
    && mv /tmp/rg /home/blink/.local/bin/

### JQ (manual install) ###
RUN curl -L "https://github.com/jqlang/jq/releases/download/jq-1.7.1/jq-linux-amd64" \
        -o /home/blink/.local/bin/jq \
    && chmod +x /home/blink/.local/bin/jq

### SHELL SETUP ###
RUN echo 'export PATH="$HOME/.local/bin:$HOME/.bun/bin:$HOME/.local/go/bin:$HOME/go/bin:$HOME/.cargo/bin:$PATH"' >> /home/blink/.bashrc

### GIT SETUP ###
RUN git config --global core.pager "cat"

ENTRYPOINT ["/bin/bash", "-c", "echo 'Installing blink...'; bun install -g blink@latest; echo 'Blink installed successfully!'; /home/blink/.bun/bin/blink compute server"]
