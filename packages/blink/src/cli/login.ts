import { login as loginFn } from "./lib/auth";

export default async function login() {
  await loginFn();
}
