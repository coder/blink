export default function Keycap({
  children,
  className,
  ...props
}: { children: React.ReactNode } & React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={
        "hidden md:inline-flex items-center justify-center rounded-[6px] border border-black/20 dark:border-white/10 bg-linear-to-b from-white to-neutral-200 dark:from-neutral-800 dark:to-neutral-900 text-foreground px-1.5 py-0.5 text-[10px] font-mono font-semibold leading-none shadow-[inset_0_1px_0_rgba(255,255,255,0.7),inset_0_-2px_4px_rgba(0,0,0,0.25),0_1.5px_0_rgba(0,0,0,0.25),0_3px_6px_rgba(0,0,0,0.15)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_-2px_4px_rgba(0,0,0,0.5),0_1.5px_0_rgba(0,0,0,0.5),0_3px_6px_rgba(0,0,0,0.4)] [text-shadow:0_1px_0_rgba(255,255,255,0.6)] dark:[text-shadow:0_1px_0_rgba(0,0,0,0.6)] transition-transform active:translate-y-px active:shadow-[inset_0_1px_0_rgba(255,255,255,0.6),inset_0_-1px_2px_rgba(0,0,0,0.3),0_1px_0_rgba(0,0,0,0.15)]" +
        (className ? ` ${className}` : "")
      }
      {...props}
    >
      {children}
    </kbd>
  );
}
