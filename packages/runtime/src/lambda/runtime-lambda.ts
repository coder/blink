import { AwsClient } from "aws4fetch";
import JSZip from "jszip";
import { Readable } from "node:stream";
import lambdaWrapperCode from "./wrapper-lambda.generated";

const defaultRuntime = "nodejs22.x";

export interface AWSOptions {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region: string;
}

export interface DeployOptions {
  readonly aws: AWSOptions;
  readonly lambdaRoleArn: string;

  // ID is a unique identifier for the deployment.
  // This becomes the `FunctionName` for the Lambda.
  readonly id: string;
  readonly logGroupName: string;

  readonly files:
    | Record<string, string>
    | AsyncIterable<{ path: string; content: string | ReadableStream }>;

  readonly entrypoint: string;
  readonly env?: Record<string, string>;

  // The memory size of the Lambda function.
  // 128MB - 10240MB. Defaults to 256MB.
  readonly memoryMB?: number;
}

export interface Deployment {
  readonly url: string;
  readonly arn: string;
}

/**
 * Upserts a Lambda function by ID returning it's
 * accessible URL and ARN.
 *
 * @param options - The options for the deployment.
 * @returns The deployment information.
 * @example
 * ```ts
 * const { url, arn } = await deploy({
 *   aws: {
 *     accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
 *     secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
 *     region: "us-east-1",
 *   },
 *   lambdaRoleArn: "arn:aws:iam::816024705661:role/user-http-lambda-role",
 *   id: "blink-test-agent",
 *   files: {
 *     "index.js": "<source-code>",
 *   },
 *   entrypoint: "index.js",
 *   env: {
 *     AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
 *   },
 * });
 * ```
 */
export async function deploy(options: DeployOptions): Promise<Deployment> {
  const aws = createAWSClient(options.aws);

  // Create or update CloudWatch log group
  await upsertLogGroup(aws, options.aws.region, options.logGroupName);

  const zip = new JSZip();

  // Process files one at a time to reduce memory pressure
  if (Symbol.asyncIterator in options.files) {
    for await (const { path, content } of options.files) {
      // Convert ReadableStream to Promise<Uint8Array> which JSZip supports
      if (content instanceof ReadableStream) {
        // This works - it's just hacky because of web/node types.
        zip.file(path, Readable.fromWeb(content as any));
      } else {
        zip.file(path, content);
      }
    }
  } else {
    for (const [path, content] of Object.entries(options.files)) {
      zip.file(path, content);
    }
  }

  const wrapperEntrypoint = `__wrapper`;
  const lambdaHandler = `${wrapperEntrypoint}.handler`;
  // This wrapper code is a simple conversion of the default `fetch` function
  // agents export to run on AWS Lambda. We intentionally avoid doing any
  // platform-specific code at build, so that we can flexibly migrate to
  // other runtimes in the future.
  zip.file(`${wrapperEntrypoint}.js`, lambdaWrapperCode);

  const base64 = await zip.generateAsync({
    type: "base64",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    streamFiles: true,
  });

  // I don't know why, but there are separate versions of the API.
  // Someone later can experiment why it needs to work this way...
  const base2015 = `https://lambda.${options.aws.region}.amazonaws.com/2015-03-31`;
  const base2021 = `https://lambda.${options.aws.region}.amazonaws.com/2021-10-31`;

  const Environment = {
    Variables: {
      ...options.env,
      // This is a special environment variable used
      // by our wrapper code to determine the entrypoint.
      ENTRYPOINT: options.entrypoint,
    },
  };

  // We first attempt to update the configuration of an existing function.
  // This is weird, but if we update the code first, this request fails
  // with a 409 conflict.
  let res = await aws.fetch(
    `${base2015}/functions/${encodeURIComponent(options.id)}/configuration`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        Environment,
        Handler: lambdaHandler,
        // The default timeout is 3 seconds, which is too short
        // for the vast majority of agents.
        Timeout: 300,
        MemorySize: options.memoryMB ?? 256,
        LoggingConfig: {
          LogFormat: "JSON",
          LogGroup: options.logGroupName,
        },
      }),
    }
  );
  if (res.status === 404) {
    // Function does not exist, so we create it.
    res = await aws.fetch(`${base2015}/functions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        FunctionName: options.id,
        Runtime: defaultRuntime,
        Handler: lambdaHandler,
        Role: options.lambdaRoleArn,
        Code: { ZipFile: base64 },
        Publish: true,
        Environment,
        Timeout: 300,
        MemorySize: options.memoryMB ?? 256,
        LoggingConfig: {
          LogFormat: "JSON",
          LogGroup: options.logGroupName,
        },
      }),
    });

    if (res.status !== 201) {
      const body = await res.text();
      throw new Error(`Failed to create function: ${res.status} ${body}`);
    }
  } else if (res.status !== 200) {
    const body = await res.text();
    throw new Error(`Failed to deploy: ${res.status} ${body}`);
  } else {
    // If it was a 200, we updated env vars successfully
    // and we can now update the code.
    res = await aws.fetch(
      `${base2015}/functions/${encodeURIComponent(options.id)}/code`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ZipFile: base64,
          Publish: true,
        }),
      }
    );
  }

  const updatePolicy = (async () => {
    const policyRes = await aws.fetch(
      `${base2015}/functions/${encodeURIComponent(options.id)}/policy`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          StatementId: "furl-public",
          Action: "lambda:InvokeFunctionUrl",
          Principal: "*",
          FunctionUrlAuthType: "NONE",
        }),
      }
    );
    if (policyRes.status !== 201 && policyRes.status !== 409) {
      const body = await policyRes.text();
      throw new Error(
        `Failed to update function policy: ${policyRes.status} ${body}`
      );
    }
  })();

  const updateURL = (async () => {
    // Attempt to update the function URL configuration so that we can
    // actually invoke this bad-boy.
    const updateURLBody = {
      // TODO: Change this once we have the auth proxying.
      AuthType: "NONE",
      Cors: { AllowOrigins: ["*"] },
      InvokeMode: "RESPONSE_STREAM",
    };
    res = await aws.fetch(
      `${base2021}/functions/${encodeURIComponent(options.id)}/url`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(updateURLBody),
      }
    );
    if (res.status === 404) {
      // If the function URL configuration does not exist, we create it.
      res = await aws.fetch(
        `${base2021}/functions/${encodeURIComponent(options.id)}/url`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(updateURLBody),
        }
      );
    } else if (res.status !== 200) {
      const body = await res.text();
      throw new Error(
        `Failed to update function URL configuration: ${res.status} ${body}`
      );
    }

    const json = (await res.json()) as {
      FunctionUrl: string;
      FunctionArn: string;
    };
    return {
      url: json.FunctionUrl,
      arn: json.FunctionArn,
    };
  })();

  // We put these in parallel for speed.
  await updatePolicy;
  return updateURL;
}

function createAWSClient(options: AWSOptions): AwsClient {
  return new AwsClient({
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    region: options.region,
  });
}

async function upsertLogGroup(
  aws: AwsClient,
  region: string,
  logGroupName: string
): Promise<void> {
  const logsBaseUrl = `https://logs.${region}.amazonaws.com/`;

  // First, try to describe the log group to see if it exists
  let logGroupExists = false;
  try {
    const describeRes = await aws.fetch(logsBaseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "Logs_20140328.DescribeLogGroups",
      },
      body: JSON.stringify({
        logGroupNamePrefix: logGroupName,
        limit: 1,
      }),
    });

    if (describeRes.ok) {
      const data = (await describeRes.json()) as {
        logGroups: { logGroupName: string }[];
      };
      logGroupExists = data.logGroups.some(
        (lg) => lg.logGroupName === logGroupName
      );
    }
  } catch (error) {
    // If describe fails, assume log group doesn't exist
    logGroupExists = false;
  }

  if (!logGroupExists) {
    // Create the log group
    const createRes = await aws.fetch(logsBaseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "Logs_20140328.CreateLogGroup",
      },
      body: JSON.stringify({
        logGroupName,
      }),
    });

    if (!createRes.ok) {
      const body = await createRes.text();
      throw new Error(
        `Failed to create log group: ${createRes.status} ${body}`
      );
    }
  }

  // Set retention policy to 30 days
  const retentionRes = await aws.fetch(logsBaseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "Logs_20140328.PutRetentionPolicy",
    },
    body: JSON.stringify({
      logGroupName,
      retentionInDays: 30,
    }),
  });

  if (!retentionRes.ok) {
    const body = await retentionRes.text();
    throw new Error(
      `Failed to set log group retention: ${retentionRes.status} ${body}`
    );
  }
}
