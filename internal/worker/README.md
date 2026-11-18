## Restrict agent deployments

Set the worker environment variable `AGENT_DEPLOYMENT_ALLOWLIST` to a comma-separated list of existing agent IDs to allow deployments and redeployments only for those agents. Spaces around IDs are ignored. An empty string blocks all deployments. Any configured value also blocks new agent creation, including creation without an initial deployment.

The worker returns HTTP 403 for blocked requests on both preview and production targets. Deployments accepted before the restriction continue. Unset the variable to allow agent creation and deployments again.

## Traces

We use OpenTelemetry to collect traces from the worker. These traces are sent to GCP Cloud Trace via [the `otel-collector-otlp` Cloud Run service](https://console.cloud.google.com/run/detail/us-central1/otel-collector-otlp/metrics?inv=1&invt=Ab55YA&project=coder-blink) in the `coder-blink` project running the [OpenTelemetry Collector](https://github.com/open-telemetry/opentelemetry-collector-releases/releases).

The collector only processes traces that are authenticated with the `Basic` auth scheme. The username and bcrypt-hashed password are specified in the OpenTelemetry Collector configuration file, which is stored in [the `otel-collector-config` secret](https://console.cloud.google.com/security/secret-manager/secret/otel-collector-config/versions?inv=1&invt=Ab551g&project=coder-blink) in the `coder-blink` project.

A snapshot of the unhashed credentials is stored in [the `otel-collector-basicauth` secret](https://console.cloud.google.com/security/secret-manager/secret/otel-collector-basicauth/versions?inv=1&invt=Ab55pw&project=coder-blink).

### Deploy the OpenTelemetry Collector

First, set the project.

```bash
gcloud config set project coder-blink
```

Then, make the desired changes to the collector configuration in the `otel-collector-config` secret.

Download the current configuration file from the secret.

```bash
gcloud secrets versions access latest --secret=otel-collector-config --out-file=collector.yaml
```

Update the configuration file with the desired changes.

```bash
gcloud secrets versions add otel-collector-config \
  --data-file=collector.yaml
```

Deploy the new version of the collector.

```bash
SA="$(gcloud projects describe coder-blink --format='value(projectNumber)')-compute@developer.gserviceaccount.com"

gcloud run deploy otel-collector-otlp \
  --image=us-docker.pkg.dev/coder-blink/ghcr-remote/open-telemetry/opentelemetry-collector-releases/opentelemetry-collector-contrib:0.132.4 \
  --args=--config=/etc/otel/config.yaml \
  --service-account="${SA}" \
  --set-secrets=/etc/otel/config.yaml=otel-collector-config:latest \
  --ingress=all \
  --cpu=1 \
  --memory=512Mi \
  --port=4318
```

## Logs

`packages/tail-worker` is responsible for sending logs to the GCP Logging service. Logs are automatically correlated with traces thanks to [a custom logger](./src/telemetry/logger.ts).
