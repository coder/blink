# Build OpenTelemetry collector
FROM golang:1.25-alpine AS otel-builder

WORKDIR /build

# Install ocb (OpenTelemetry Collector Builder)
RUN go install go.opentelemetry.io/collector/cmd/builder@v0.143.0

# Copy builder config
COPY otel/builder-config.yaml .

# Build the collector
RUN builder --config builder-config.yaml

FROM node:22-alpine

# Install bash (for process substitution)
RUN apk add --no-cache bash

COPY --from=otel-builder /build/dist/collector /usr/local/bin/collector

COPY otel/config.yaml otel/start-collector.sh /opt/otel/

# Create a non-root user with a high UID unlikely to exist on the host
# Using UID 65532 which is high but within typical kernel limits
RUN addgroup -g 65532 agent && \
    adduser -u 65532 -G agent -D -H agent && \
    chmod +x /opt/otel/start-collector.sh && \
    mkdir -p /var/log/agent && \
    chown agent:agent /var/log/agent

USER agent
