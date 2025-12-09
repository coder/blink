import connectToPostgres from "@blink.so/database/postgres";
import Querier from "@blink.so/database/querier";

const querierCache = new Map<string, Querier>();

// getQuerier is a helper function for all functions in the site
// that need to connect to the database.
// TODO: it's janky that we're caching the querier globally like this.
// We should make it cleaner.
export const getQuerier = async (): Promise<Querier> => {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "";
  let querier = querierCache.get(url);
  if (!querier) {
    const conn = await connectToPostgres(url);
    querier = new Querier(conn);
    querierCache.set(url, querier);
  }
  return querier;
};
