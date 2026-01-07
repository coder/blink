export type WorkspaceErrorPageAction = {
  label: string;
  href: string;
  external?: boolean;
  primary?: boolean;
};

export type WorkspaceErrorPageOptions = {
  title?: string;
  description?: string;
  actions?: WorkspaceErrorPageAction[];
  issueText?: string;
  brandHref?: string;
};

function escapeHTML(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function createWorkspaceErrorPage(
  options: WorkspaceErrorPageOptions = {}
): string {
  const brandHref = escapeHTML(
    options.brandHref ?? "https://blink.coder.com/chat"
  );
  const title = escapeHTML(options.title ?? "Workspace Error");
  const descriptionHtml = options.description
    ? `<p class="p">${escapeHTML(options.description)}</p>`
    : "";

  const actions: WorkspaceErrorPageAction[] = options.actions ?? [
    {
      label: "View Your Chats",
      href: "https://blink.coder.com/chat",
      external: true,
      primary: true,
    },
  ];
  const actionsHtml = actions
    .map((action) => {
      const href = escapeHTML(action.href);
      const attrs = action.external
        ? ' target="_blank" rel="noopener noreferrer"'
        : "";
      const classes = `btn${action.primary ? " btn-primary" : ""}`;
      return `<a class="${classes}" href="${href}"${attrs}>${escapeHTML(action.label)}</a>`;
    })
    .join("\n                    ");

  const issueHtml = options.issueText
    ? `<p class="footer">${escapeHTML(options.issueText)}</p>`
    : "";

  return `<!doctype html>
<html lang="en" class="dark" style="color-scheme: dark">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Blink | Workspace Error</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700;900&display=swap" rel="stylesheet">
    <style>
        :root {
            --background: 240 9% 7%;
            --foreground: 0 0% 98%;
            --card: 240 8% 7%;
            --popover: 240 6% 18%;
            --border: 240 3.7% 15.9%;
        }
        html, body { height: 100%; }
        body {
            margin: 0;
            font-family: Lato, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji";
            background-color: hsl(var(--background));
            color: hsl(var(--foreground));
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            display: flex;
            flex-direction: column;
            min-height: 100vh;
        }
        .container { max-width: 72rem; margin: 0 auto; padding: 1rem; }
        .nav {
            position: sticky; top: 0; z-index: 10;
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
        }
        .nav-inner { display: flex; align-items: center; gap: 0.75rem; padding: 1rem 0; }
        .brand { display: flex; align-items: center; gap: 0.75rem; color: #fff; text-decoration: none; }
        .built-by { color: #fff; font-size: 0.65rem; font-weight: 600; letter-spacing: 0.08em; line-height: 1; text-transform: uppercase; opacity: 0.9; }
        .main { display: grid; place-items: center; padding: 2rem; flex: 1; }
        .card {
            background: #000; border: 1px solid hsl(var(--border));
            border-radius: 0.75rem; padding: 2rem; width: 100%; max-width: 720px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.35);
        }
        .h1 { font-size: clamp(1.25rem, 2vw + 1rem, 1.75rem); font-weight: 600; margin: 0 0 0.5rem 0; }
        .p { color: #b3b3b3; margin: 0 0 1.5rem 0; line-height: 1.6; }
        .kbd { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; background: #0f1111; border: 1px solid #222; border-bottom-color: #1a1a1a; padding: 0.25rem 0.4rem; border-radius: 0.4rem; color: #eaeaea; }
        .actions { display: flex; gap: 0.75rem; flex-wrap: wrap; }
        .btn {
            display: inline-flex; align-items: center; gap: 0.5rem;
            padding: 0.5rem 0.9rem; border-radius: 999px; font-weight: 600; text-decoration: none;
            transition: opacity .15s ease, background-color .15s ease, color .15s ease;
            border: 1px solid #2a2a2a; color: #eaeaea; background: transparent;
        }
        .btn:hover { opacity: 0.85; }
        .btn-primary { background: #111; border-color: #2a2a2a; color: #fff; }
        .footer { color: #7a7a7a; font-size: 0.85rem; margin-top: 1.25rem; }
        .logo { display: inline-flex; color: #fff; }
        /* Small utility for subtle fade-in */
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .card { animation: fadeIn .28s ease-out .1s both; }
    </style>
</head>
<body>
    <header class="nav">
        <div class="container">
            <div class="nav-inner">
                <a class="brand" href="${brandHref}">
                    <span class="logo" aria-label="Blink">
                        <!-- Inline LogoBlink SVG (white) -->
                        <svg height="24" viewBox="0 0 138 32" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                            <rect x="112" width="26" height="32" fill="white"/>
                            <path d="M13.4413 32C11.812 32 10.3864 31.6512 9.1645 30.9537C7.97166 30.2561 7.04066 29.2825 6.37151 28.0327L6.24058 31.4768H0V0.523162H6.54607V11.4223C7.15703 10.347 8.05894 9.44596 9.25178 8.71935C10.4446 7.96367 11.8411 7.58583 13.4413 7.58583C15.4196 7.58583 17.1362 8.09446 18.5908 9.11172C20.0455 10.0999 21.1656 11.5095 21.9511 13.3406C22.7658 15.1717 23.1731 17.3224 23.1731 19.7929C23.1731 22.2634 22.7658 24.4142 21.9511 26.2452C21.1656 28.0763 20.0455 29.5005 18.5908 30.5177C17.1362 31.5059 15.4196 32 13.4413 32ZM11.6084 26.9864C13.063 26.9864 14.2268 26.3615 15.0996 25.1117C16.0015 23.8329 16.4525 22.0599 16.4525 19.7929C16.4525 17.5259 16.016 15.7675 15.1432 14.5177C14.2704 13.2389 13.1067 12.5995 11.652 12.5995C10.5755 12.5995 9.64454 12.8901 8.85901 13.4714C8.10258 14.0236 7.52071 14.8374 7.11339 15.9128C6.73518 16.9882 6.54607 18.2816 6.54607 19.7929C6.54607 21.2752 6.73518 22.554 7.11339 23.6294C7.52071 24.7048 8.10258 25.5332 8.85901 26.1144C9.64454 26.6957 10.561 26.9864 11.6084 26.9864Z" fill="white"/>
                            <path d="M33.5554 31.4768C31.6352 31.4768 30.1369 30.9973 29.0605 30.0381C27.984 29.079 27.4458 27.5241 27.4458 25.3733V0.523162H33.9918V24.6757C33.9918 25.3733 34.1518 25.8674 34.4719 26.158C34.7919 26.4487 35.2574 26.594 35.8684 26.594H37.4394V31.4768H33.5554Z" fill="white"/>
                            <path d="M40.7851 31.4768V8.10899H47.3311V31.4768H40.7851ZM40.6541 5.23161V0H47.4184V5.23161H40.6541Z" fill="white"/>
                            <path d="M53.3573 31.4768V8.10899H59.2487L59.5106 14.9537L58.6814 14.7357C58.9142 12.9918 59.3797 11.5967 60.0779 10.5504C60.8052 9.50409 61.7071 8.74841 62.7836 8.28338C63.8601 7.81835 65.0384 7.58583 66.3185 7.58583C68.0059 7.58583 69.4315 7.94914 70.5953 8.67575C71.7881 9.40236 72.69 10.4342 73.301 11.7711C73.941 13.079 74.261 14.634 74.261 16.436V31.4768H67.715V18.6158C67.715 17.366 67.6132 16.3052 67.4095 15.4332C67.2058 14.5613 66.8422 13.9074 66.3185 13.4714C65.7948 13.0064 65.0675 12.7738 64.1365 12.7738C62.7691 12.7738 61.7217 13.2825 60.9944 14.2997C60.267 15.2879 59.9033 16.7266 59.9033 18.6158V31.4768H53.3573Z" fill="white"/>
                            <path d="M79.6523 31.4768V0.523162H86.1984V17.7003L94.8829 8.10899H102.738L93.6609 17.7439L103 31.4768H95.843L89.4278 21.4496L86.1984 24.8937V31.4768H79.6523Z" fill="white"/>
                        </svg>
                    </span>
                    <span class="built-by">BUILT BY<br/>CODER</span>
                </a>
            </div>
        </div>
    </header>
    <main class="main">
        <div class="container">
            <section class="card" role="alert" aria-live="polite">
                <h1 class="h1">${title}</h1>
                ${descriptionHtml}
                <div class="actions">
                    ${actionsHtml}
                </div>
                ${issueHtml}
            </section>
        </div>
    </main>
</body>
</html>`;
}
