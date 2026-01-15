import { deleteAuthToken } from "./lib/auth";

export default function logout() {
  deleteAuthToken();
  console.log("Logged out successfully.");
}
