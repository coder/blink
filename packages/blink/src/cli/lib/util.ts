import open from "open";
import chalk from "chalk";

export async function openUrl(
  url: string,
  errorMessage: string | undefined = undefined
): Promise<void> {
  try {
    const proc = await open(url);
    proc.once("error", (_error) => {
      console.log(
        chalk.yellow(
          errorMessage ??
            `Could not open the browser. Please visit the URL manually: ${url}`
        )
      );
    });
  } catch (_error) {
    console.log(
      chalk.yellow(
        errorMessage ??
          `Could not open the browser. Please visit the URL manually: ${url}`
      )
    );
  }
}
