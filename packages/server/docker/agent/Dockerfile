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

# Install bash (for process substitution) and netcat (for piping logs to collector)
RUN apk add --no-cache bash netcat-openbsd

COPY --from=otel-builder /build/dist/collector /usr/local/bin/collector

COPY otel/config.yaml otel/start-collector.sh /opt/otel/
