import { useStdout } from "ink";
import { useEffect, useState } from "react";

export default function useTerminalSize() {
  const { stdout } = useStdout();
  const [size, setSize] = useState<{
    columns: number;
    rows: number | undefined;
  }>({
    columns: process.stdout.columns,
    rows: process.stdout.rows,
  });

  useEffect(() => {
    if (!stdout || !stdout.isTTY) return;
    const handleResize = () => {
      setSize({ columns: stdout.columns, rows: stdout.rows });
    };
    process.stdout.on("resize", handleResize);
    return () => {
      process.stdout.off("resize", handleResize);
    };
  }, [stdout]);

  return {
    columns: size.columns,
    // For some reason, if we use the full height, the terminal will
    // truncate the top line.
    rows: size.rows ? size.rows - 1 : undefined,
  };
}
