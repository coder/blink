import { hash } from "bcrypt-ts";

const BCRYPT_COST = 12;

/**
 * Hash a password using bcrypt with a consistent cost factor.
 */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, BCRYPT_COST);
}
