import { loginIfNeeded } from "./lib/auth";

export default async function login(url?: string) {
  await loginIfNeeded(url);
}
