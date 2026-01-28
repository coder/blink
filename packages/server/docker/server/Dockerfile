FROM node:22-alpine

# Install docker CLI for docker-in-docker via socket mounting
RUN apk add --no-cache docker-cli

# Create a non-root user with home directory for config storage
RUN addgroup -g 65532 server && \
    adduser -u 65532 -G server -D -h /home/server server

USER server
WORKDIR /home/server/app

RUN --mount=type=bind,source=server.tgz,target=/tmp/server.tgz npm install /tmp/server.tgz

RUN mkdir -p /home/server/.config/blink-server \
    && chown server:server /home/server/.config/blink-server

VOLUME /home/server/.config/blink-server

CMD ["npx", "blink-server"]
