import { connectToPostgres } from "@blink.so/database/postgres";
import { default as Querier } from "@blink.so/database/querier";
import { withSpan } from "./telemetry";

let instrumented = false;

async function connectToDatabase(env: Cloudflare.Env): Promise<Querier> {
  if (!instrumented) {
    const methods = Object.getOwnPropertyNames(Querier.prototype);
    for (const method of methods) {
      const fn = (Querier.prototype as any)[method];
      if (typeof fn === "function") {
        (Querier.prototype as any)[method] = function (...args: any[]) {
          return withSpan({ name: method }, async () => {
            return await fn.apply(this, args);
          });
        };
      }
    }
    instrumented = true;
  }

  // @ts-ignore
  const psql = await connectToPostgres(env.HYPERDRIVE.connectionString);
  const q = new Querier(psql);
  return q;
}

export default connectToDatabase;
