import React, { useMemo, useState } from "react";
import fs from "fs";
import { Box, useStdout } from "ink";
import {
  InputPrompt,
  useTextBuffer,
  KeypressProvider as KeypressProviderBase,
  Config,
  type InputPromptProps,
  useBracketedPaste,
} from "@jaaydenh/gemini-cli/ui";

function createMinimalConfig(): Config {
  return new Config({
    sessionId: "blink",
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
    model: "gemini-1.5-flash",
    telemetry: { enabled: false },
  });
}

export interface SlashCommand {
  name: string;
  altNames?: string[];
  description: string;
  completion?: (partialArg: string) => Promise<string[]>;
  action: (args: string) => void;
  subcommands?: Array<SlashCommand>;
}

type GeminiSlashCommand = InputPromptProps["slashCommands"][number];

const convertToCommands = (
  slashCommands: Array<SlashCommand>
): Array<GeminiSlashCommand> => {
  return slashCommands.map((cmd) => ({
    name: cmd.name,
    altNames: cmd.altNames,
    description: cmd.description,
    kind: "built-in" as any,
    completion: async (context, partialArg: string) => {
      return cmd.completion?.(partialArg) ?? [];
    },
    subCommands: cmd.subcommands
      ? convertToCommands(cmd.subcommands)
      : undefined,
  }));
};

function TextInput({
  onSubmit,
  placeholder,
  slashCommands,
  onLayoutChange,
  borderColor,
  visible,
}: {
  onSubmit: (value: string) => void;
  placeholder?: string;
  slashCommands?: Array<SlashCommand>;
  onLayoutChange?: () => void;
  borderColor?: string;
  visible: boolean;
}) {
  const config = useMemo(() => createMinimalConfig(), []);
  const [userMessages, setUserMessages] = useState<string[]>([]);
  const { stdout } = useStdout();

  const [isSlashOpen, setIsSlashOpen] = useState(false);
  const inputWidth = stdout.columns;
  const buffer = useTextBuffer({
    // If this is not -6, the input overflows when you type long lines.
    viewport: { width: inputWidth - 6, height: stdout.rows - 15 },
    isValidPath: (filePath) => {
      return fs.existsSync(filePath);
    },
    onChange: (value) => {
      if (value.startsWith("/")) {
        setIsSlashOpen(true);
      } else {
        setIsSlashOpen((prev) => {
          if (prev) {
            onLayoutChange?.();
          }
          return false;
        });
      }
    },
  });

  const commands = useMemo(() => {
    return convertToCommands(slashCommands ?? []);
  }, [slashCommands]);

  if (!visible) {
    return null;
  }

  return (
    <Box marginBottom={isSlashOpen ? 1 : 0} flexDirection="column">
      <InputPrompt
        borderColor={borderColor}
        buffer={buffer}
        onSubmit={(value) => {
          const args = value.trim().split(" ");
          const first = args[0];
          if (first && first.startsWith("/")) {
            const commandName = first.slice(1);
            const commandIndex =
              slashCommands?.findIndex(
                (c) =>
                  c.name === commandName ||
                  (c.altNames ? c.altNames.includes(commandName) : false)
              ) ?? -1;

            if (commandIndex !== -1 && slashCommands) {
              const root = slashCommands[commandIndex]!;
              const rest = args.slice(1);

              const execute = (cmd: SlashCommand, remaining: string[]) => {
                if (
                  remaining.length > 0 &&
                  cmd.subcommands &&
                  cmd.subcommands.length > 0
                ) {
                  const subName = remaining[0]!;
                  const next = cmd.subcommands.find(
                    (sc) =>
                      sc.name === subName ||
                      (sc.altNames ? sc.altNames.includes(subName) : false)
                  );
                  if (next) {
                    return execute(next, remaining.slice(1));
                  }
                }
                cmd.action(remaining.join(" "));
              };

              execute(root, rest);
              return; // Explicit return without value to avoid disrupting event flow
            }
          }

          setUserMessages((prev) => [value, ...prev]);
          onSubmit(value);
        }}
        placeholder={placeholder}
        userMessages={userMessages}
        onClearScreen={() => {}}
        config={config}
        slashCommands={commands}
        commandContext={
          {
            services: {
              config,
              settings: {} as any,
              git: undefined,
              logger: console as any,
            },
            ui: {
              addItem: () => {},
              clear: () => {},
              setDebugMessage: () => {},
              pendingItem: null,
              setPendingItem: () => {},
              loadHistory: () => {},
              toggleCorgiMode: () => {},
              toggleVimEnabled: async () => false,
              setGeminiMdFileCount: () => {},
              reloadCommands: () => {},
            },
            session: { stats: {} as any, sessionShellAllowlist: new Set() },
          } as any
        }
        inputWidth={inputWidth - 2}
        suggestionsWidth={inputWidth - 2}
        shellModeActive={false}
        setShellModeActive={() => {}}
      />
    </Box>
  );
}

export function KeypressProvider({ children }: { children: React.ReactNode }) {
  const config = useMemo(() => createMinimalConfig(), []);
  useBracketedPaste();

  return (
    <KeypressProviderBase kittyProtocolEnabled={true} config={config}>
      {children}
    </KeypressProviderBase>
  );
}

export default TextInput;
