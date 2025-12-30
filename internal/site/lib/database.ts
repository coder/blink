import connectToPostgres from "@blink.so/database/postgres";
import Querier from "@blink.so/database/querier";

// getQuerier is a helper function for all functions in the site
// that need to connect to the database.
//
// They do not need to be concerned about ending connections.
// This all runs serverless, and we have max idle time
// which will close the connection.
export const getQuerier = async (): Promise<Querier> => {
  const conn = await connectToPostgres(
    process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? ""
  );
  return new Querier(conn);
};
