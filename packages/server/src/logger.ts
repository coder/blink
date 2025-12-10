import chalk from "chalk";

function formatTimestamp(): string {
  const now = new Date();
  const date = now.toISOString().split("T")[0]!;
  const time = now.toTimeString().split(" ")[0]!;
  const ms = now.getMilliseconds().toString().padStart(3, "0");
  return chalk.gray(`${date} ${time}.${ms}`);
}

export function info(message: string) {
  console.log(`${formatTimestamp()} ${chalk.cyan("[info]")}  ${message}`);
}

export function warn(message: string) {
  console.log(`${formatTimestamp()} ${chalk.yellow("[warn]")}  ${message}`);
}

export function error(message: string) {
  console.log(`${formatTimestamp()} ${chalk.red("[error]")} ${message}`);
}

export function success(message: string) {
  console.log(`${formatTimestamp()} ${chalk.green("[info]")}  ${message}`);
}

export function plain(message: string) {
  console.log(message);
}
