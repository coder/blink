"use client";

import {
  Check,
  CheckSquare,
  ChevronDown,
  Cloud,
  Container,
  Copy,
  ExternalLink,
  GitBranch,
  Key,
  Moon,
  Play,
  RotateCw,
  Sun,
  X,
  Zap,
} from "lucide-react";
import Image from "next/image";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function Home() {
  const [animationStep, setAnimationStep] = useState(0);
  const [visibleSections, setVisibleSections] = useState(new Set());
  const [openFAQ2, setOpenFAQ2] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedCommand1, setCopiedCommand1] = useState(false);
  const [copiedCommand2, setCopiedCommand2] = useState(false);
  const [copiedCommand3, setCopiedCommand3] = useState(false);
  const [copiedBottom, setCopiedBottom] = useState(false);
  const [lineAnimated, setLineAnimated] = useState(false);
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [terminalPrompt, setTerminalPrompt] = useState("laptop slackbot % ");
  const terminalAnimationStarted = useRef(false);
  const [secondTerminalInput, setSecondTerminalInput] = useState("");
  const [secondTerminalSubmitted, setSecondTerminalSubmitted] = useState(false);
  const [secondTerminalResponse, setSecondTerminalResponse] = useState("");
  const secondTerminalAnimationStarted = useRef(false);
  const secondTerminalMessagesRef = useRef<HTMLDivElement>(null);
  const secondTerminalLoopTimer = useRef<NodeJS.Timeout | null>(null);
  const [thirdTerminalLines, setThirdTerminalLines] = useState<string[]>([]);
  const [thirdTerminalPrompt, setThirdTerminalPrompt] =
    useState("laptop slackbot % ");
  const thirdTerminalAnimationStarted = useRef(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const [copiedPMIndex, setCopiedPMIndex] = useState<number | null>(null);
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const intervalIdsRef = useRef<number[]>([]);

  // Package manager configurations
  const packageManagers = [
    {
      id: "bun" as const,
      name: "bun",
      logo: "/package-managers/bun.svg",
      command: "bun i -g blink",
    },
    {
      id: "npm" as const,
      name: "npm",
      logo: "/package-managers/npm.svg",
      command: "npm i -g blink",
    },
    {
      id: "pnpm" as const,
      name: "pnpm",
      logo: "/package-managers/pnpm.svg",
      command: "pnpm add -g blink",
    },
    {
      id: "yarn" as const,
      name: "yarn",
      logo: "/package-managers/yarn.svg",
      command: "yarn global add blink",
    },
  ];

  // Track if component is mounted (for portal)
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Load dark mode preference from localStorage on mount, or default to dark mode
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedMode = localStorage.getItem("blinkDarkMode");
      if (savedMode !== null) {
        // User has a saved preference
        setIsDarkMode(savedMode === "true");
      } else {
        // No saved preference, default to dark mode
        setIsDarkMode(true);
      }
    }
  }, []);

  // Save dark mode preference to localStorage whenever it changes
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("blinkDarkMode", isDarkMode.toString());
    }
  }, [isDarkMode]);

  // Handle escape key to close video modal and lock body scroll
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isVideoModalOpen) {
        setIsVideoModalOpen(false);
      }
    };

    if (isVideoModalOpen) {
      // Lock body scroll when modal is open
      document.body.style.overflow = "hidden";
      document.addEventListener("keydown", handleEscape);
    }

    return () => {
      // Restore body scroll when modal closes
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isVideoModalOpen]);

  // Force scroll to top on page load/refresh (unless there's a hash fragment)
  useEffect(() => {
    if ("scrollRestoration" in history) {
      history.scrollRestoration = "manual";
    }
    if (!window.location.hash && window.scrollY === 0) {
      const timeoutId = setTimeout(() => {
        if (window.scrollY === 0) {
          document.documentElement.scrollTop = 0;
          document.body.scrollTop = 0;
          window.scrollTo(0, 0);
        }
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, []);

  // Cleanup all intervals on unmount
  useEffect(() => {
    return () => {
      intervalIdsRef.current.forEach((id) => clearInterval(id));
      intervalIdsRef.current = [];
    };
  }, []);

  // Overlapping cascade animation for masthead
  useEffect(() => {
    const timers = [
      setTimeout(() => setAnimationStep(1), 150), // CTAs only
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  // Intersection Observer for scroll animations
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const sectionIndex = parseInt(
              entry.target.getAttribute("data-section") || "0"
            );
            setVisibleSections((prev) => new Set([...prev, sectionIndex]));

            // Start second terminal animation
            if (sectionIndex === 3 && !secondTerminalAnimationStarted.current) {
              secondTerminalAnimationStarted.current = true;

              const userMessage =
                "Give my agent tools to research GitHub repositories";

              // Type the user message
              setTimeout(() => {
                let charIndex = 0;
                const typingInterval = setInterval(() => {
                  if (charIndex <= userMessage.length) {
                    setSecondTerminalInput(userMessage.substring(0, charIndex));
                    charIndex++;
                  } else {
                    clearInterval(typingInterval);

                    // Submit the message
                    setTimeout(() => {
                      setSecondTerminalSubmitted(true);
                      setSecondTerminalInput(""); // Clear input after submission

                      // Auto-scroll to bottom after submission
                      setTimeout(() => {
                        if (secondTerminalMessagesRef.current) {
                          secondTerminalMessagesRef.current.scrollTop =
                            secondTerminalMessagesRef.current.scrollHeight;
                        }
                      }, 100);

                      // Show Blink's response
                      setTimeout(() => {
                        const response =
                          "Sure, I'll read the agent source code to understand what currently exists, then add tools for researching GitHub repositories.";
                        setSecondTerminalResponse(response);

                        // Auto-scroll after response appears
                        setTimeout(() => {
                          if (secondTerminalMessagesRef.current) {
                            secondTerminalMessagesRef.current.scrollTop =
                              secondTerminalMessagesRef.current.scrollHeight;
                          }
                        }, 100);

                        // Schedule auto-restart after 5 seconds
                        secondTerminalLoopTimer.current = setTimeout(() => {
                          restartSecondTerminal(true);
                        }, 5000);
                      }, 500);
                    }, 800);
                  }
                }, 30);
              }, 300);
            }

            // Start third terminal animation
            if (sectionIndex === 4 && !thirdTerminalAnimationStarted.current) {
              thirdTerminalAnimationStarted.current = true;

              // Clear any existing lines first
              setThirdTerminalLines([]);
              setThirdTerminalPrompt("laptop slackbot % ");

              const commandToType = "blink deploy";
              const lines = [
                "",
                "[8/8] Uploaded files (8.17MB).",
                "Updated environment variables! (.env.production)",
                "Deployed: https://blink.coder.com/devteam/deployments/1",
                "Deployment successful. All chats will use this deployment!",
                "",
                "Send this agent webhooks from anywhere:",
                "https://d36547ec-2da5-414a-aasd-4c2d9d6a42cf.agent.blink.host/",
              ];

              // Start typing the command first
              setTimeout(() => {
                let charIndex = 0;
                const typingInterval = setInterval(() => {
                  if (charIndex <= commandToType.length) {
                    setThirdTerminalPrompt(
                      "laptop slackbot % " +
                        commandToType.substring(0, charIndex)
                    );
                    charIndex++;
                  } else {
                    clearInterval(typingInterval);

                    // After command is typed, start adding output lines
                    setTimeout(() => {
                      let currentLineIndex = 0;
                      const lineInterval = setInterval(() => {
                        if (currentLineIndex < lines.length) {
                          const lineToAdd = lines[currentLineIndex];
                          setThirdTerminalLines((prev) => [...prev, lineToAdd]);
                          currentLineIndex++;
                        } else {
                          clearInterval(lineInterval);
                        }
                      }, 200);
                    }, 300);
                  }
                }, 50);
              }, 50);
            }

            // Start terminal line animation for first section
            if (sectionIndex === 0 && !terminalAnimationStarted.current) {
              terminalAnimationStarted.current = true;
              setLineAnimated(true); // Trigger vertical line animation

              // Clear any existing lines first
              setTerminalLines([]);
              setTerminalPrompt("laptop slackbot % ");

              const commandToType = "blink init";
              const lines = [
                "Initializing a new Blink Agent",
                "Using bun as the package manager.",
                "17 packages installed [3.20s]",
                "",
                "To get started, run:",
                "  blink dev",
                "Changes to agent.ts will hot-reload your agent.",
              ];

              // Start typing the command first
              setTimeout(() => {
                let charIndex = 0;
                const typingInterval = setInterval(() => {
                  if (charIndex <= commandToType.length) {
                    setTerminalPrompt(
                      "laptop slackbot % " +
                        commandToType.substring(0, charIndex)
                    );
                    charIndex++;
                  } else {
                    clearInterval(typingInterval);

                    // After command is typed, start adding output lines
                    setTimeout(() => {
                      let currentLineIndex = 0;
                      const lineInterval = setInterval(() => {
                        if (currentLineIndex < lines.length) {
                          const lineToAdd = lines[currentLineIndex];
                          setTerminalLines((prev) => [...prev, lineToAdd]);
                          currentLineIndex++;
                        } else {
                          clearInterval(lineInterval);
                        }
                      }, 200);
                    }, 300);
                  }
                }, 50);
              }, 50);
            }
          }
        });
      },
      { threshold: 0.3, rootMargin: "0px" }
    );

    sectionRefs.current.forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => {
      observer.disconnect();
      // Clean up the second terminal loop timer
      if (secondTerminalLoopTimer.current) {
        clearTimeout(secondTerminalLoopTimer.current);
      }
    };
  }, []);

  // Handle copy to clipboard for default (bun) command
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText("bun i -g blink");
      setCopied(true);
      setLineAnimated(true);
      setTimeout(() => setCopied(false), 2000);

      // Dispatch custom event to trigger header typing animation
      window.dispatchEvent(new CustomEvent("blinkCopyEvent"));

      // Smooth scroll to the section - delayed by 500ms
      const section = document.getElementById("use-cases");
      if (section) {
        setTimeout(() => {
          section.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 500);
      }
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  // Handle copy for individual package manager commands
  const handlePMCopy = async (command: string, index: number) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedPMIndex(index);
      setLineAnimated(true);
      setTimeout(() => setCopiedPMIndex(null), 2000);

      // Dispatch custom event to trigger header typing animation
      window.dispatchEvent(new CustomEvent("blinkCopyEvent"));

      // Smooth scroll to the section - delayed by 500ms
      const section = document.getElementById("use-cases");
      if (section) {
        setTimeout(() => {
          section.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 500);
      }
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  // Handle copy to clipboard for bottom section (no scroll)
  const handleBottomCopy = async () => {
    try {
      await navigator.clipboard.writeText("bun i -g blink");
      setCopiedBottom(true);
      setTimeout(() => setCopiedBottom(false), 2000);

      // Dispatch custom event to trigger header typing animation
      window.dispatchEvent(new CustomEvent("blinkCopyEvent"));
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  // Restart first terminal animation
  const restartFirstTerminal = () => {
    // Clear existing intervals
    intervalIdsRef.current.forEach((id) => clearInterval(id));
    intervalIdsRef.current = [];

    setTerminalLines([]);
    setTerminalPrompt("laptop slackbot % ");

    const commandToType = "blink init";
    const lines = [
      "Initializing a new Blink Agent",
      "Using bun as the package manager.",
      "17 packages installed [3.20s]",
      "",
      "To get started, run:",
      "  blink dev",
      "Changes to agent.ts will hot-reload your agent.",
    ];

    setTimeout(() => {
      let charIndex = 0;
      const typingInterval = setInterval(() => {
        if (charIndex <= commandToType.length) {
          setTerminalPrompt(
            "laptop slackbot % " + commandToType.substring(0, charIndex)
          );
          charIndex++;
        } else {
          clearInterval(typingInterval);
          intervalIdsRef.current = intervalIdsRef.current.filter(
            (id) => id !== (typingInterval as unknown as number)
          );

          setTimeout(() => {
            let currentLineIndex = 0;
            const lineInterval = setInterval(() => {
              if (currentLineIndex < lines.length) {
                const lineToAdd = lines[currentLineIndex];
                setTerminalLines((prev) => [...prev, lineToAdd]);
                currentLineIndex++;
              } else {
                clearInterval(lineInterval);
                intervalIdsRef.current = intervalIdsRef.current.filter(
                  (id) => id !== (lineInterval as unknown as number)
                );
              }
            }, 200) as unknown as number;
            intervalIdsRef.current.push(lineInterval);
          }, 300);
        }
      }, 50) as unknown as number;
      intervalIdsRef.current.push(typingInterval);
    }, 50);
  };

  // Restart second terminal animation
  const restartSecondTerminal = (autoLoop = false) => {
    // Clear existing intervals and loop timer
    intervalIdsRef.current.forEach((id) => clearInterval(id));
    intervalIdsRef.current = [];
    if (secondTerminalLoopTimer.current) {
      clearTimeout(secondTerminalLoopTimer.current);
      secondTerminalLoopTimer.current = null;
    }

    setSecondTerminalInput("");
    setSecondTerminalSubmitted(false);
    setSecondTerminalResponse("");

    const userMessage = "Give my agent tools to research GitHub repositories";

    setTimeout(() => {
      let charIndex = 0;
      const typingInterval = setInterval(() => {
        if (charIndex <= userMessage.length) {
          setSecondTerminalInput(userMessage.substring(0, charIndex));
          charIndex++;
        } else {
          clearInterval(typingInterval);
          intervalIdsRef.current = intervalIdsRef.current.filter(
            (id) => id !== (typingInterval as unknown as number)
          );

          setTimeout(() => {
            setSecondTerminalSubmitted(true);
            setSecondTerminalInput("");

            setTimeout(() => {
              if (secondTerminalMessagesRef.current) {
                secondTerminalMessagesRef.current.scrollTop =
                  secondTerminalMessagesRef.current.scrollHeight;
              }
            }, 100);

            setTimeout(() => {
              const response =
                "Sure, I'll read the agent source code to understand what currently exists, then add tools for researching GitHub repositories.";
              setSecondTerminalResponse(response);

              setTimeout(() => {
                if (secondTerminalMessagesRef.current) {
                  secondTerminalMessagesRef.current.scrollTop =
                    secondTerminalMessagesRef.current.scrollHeight;
                }
              }, 100);

              // Schedule auto-restart if in loop mode
              if (autoLoop) {
                secondTerminalLoopTimer.current = setTimeout(() => {
                  restartSecondTerminal(true);
                }, 5000);
              }
            }, 500);
          }, 800);
        }
      }, 30) as unknown as number;
      intervalIdsRef.current.push(typingInterval);
    }, 300);
  };

  // Restart third terminal animation
  const restartThirdTerminal = () => {
    // Clear existing intervals
    intervalIdsRef.current.forEach((id) => clearInterval(id));
    intervalIdsRef.current = [];

    setThirdTerminalLines([]);
    setThirdTerminalPrompt("laptop slackbot % ");

    const commandToType = "blink deploy";
    const lines = [
      "",
      "[8/8] Uploaded files (8.17MB).",
      "[0/0] Updated environment variables! (.env.production)",
      "Deployed: https://blink.coder.com/devteam/deployments/1",
      "Deployment successful. All chats will use this deployment!",
      "",
      "Send webhooks from anywhere: https://d36547ec-2da5-414a-aaea-4c2d9c8a42cf.agent.blink.host/",
    ];

    setTimeout(() => {
      let charIndex = 0;
      const typingInterval = setInterval(() => {
        if (charIndex <= commandToType.length) {
          setThirdTerminalPrompt(
            "laptop slackbot % " + commandToType.substring(0, charIndex)
          );
          charIndex++;
        } else {
          clearInterval(typingInterval);
          intervalIdsRef.current = intervalIdsRef.current.filter(
            (id) => id !== (typingInterval as unknown as number)
          );

          setTimeout(() => {
            let currentLineIndex = 0;
            const lineInterval = setInterval(() => {
              if (currentLineIndex < lines.length) {
                const lineToAdd = lines[currentLineIndex];
                setThirdTerminalLines((prev) => [...prev, lineToAdd]);
                currentLineIndex++;
              } else {
                clearInterval(lineInterval);
                intervalIdsRef.current = intervalIdsRef.current.filter(
                  (id) => id !== (lineInterval as unknown as number)
                );
              }
            }, 200) as unknown as number;
            intervalIdsRef.current.push(lineInterval);
          }, 300);
        }
      }, 50) as unknown as number;
      intervalIdsRef.current.push(typingInterval);
    }, 50);
  };

  // Trigger line animation on scroll using IntersectionObserver (already handled in the main observer above)
  // Removed inefficient scroll listener

  return (
    <>
      <Script id="ld-org" type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "Blink",
          url: "https://blink.coder.com",
          logo: "https://blink.coder.com/icon-dark.svg",
          sameAs: [
            "https://github.com/coder/blink-private",
            "https://coder.com",
          ],
        })}
      </Script>
      <Script id="ld-website" type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "Blink",
          url: "https://blink.coder.com",
          potentialAction: {
            "@type": "SearchAction",
            target: "https://blink.coder.com/?q={search_term_string}",
            "query-input": "required name=search_term_string",
          },
        })}
      </Script>
      <Script id="ld-software" type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "Blink",
          applicationCategory: "DeveloperApplication",
          operatingSystem: "macOS, Linux, Windows",
          offers: {
            "@type": "Offer",
            price: "0",
            priceCurrency: "USD",
          },
          description:
            "Build and deploy Slack agents from your terminal. Open source, local-first agent framework.",
          url: "https://blink.coder.com",
          downloadUrl: "https://blink.coder.com",
          softwareVersion: "1.0",
          license: "https://opensource.org/licenses/MIT",
          programmingLanguage: "TypeScript",
        })}
      </Script>
      <Script id="ld-video" type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "VideoObject",
          name: "Blink Slack Integration Demo",
          description:
            "See how Blink agents integrate with Slack to automate your workflow",
          thumbnailUrl: "https://i.ytimg.com/vi/lR6GbKuhXRo/maxresdefault.jpg",
          uploadDate: "2025-01-12",
          contentUrl: "https://www.youtube.com/watch?v=lR6GbKuhXRo",
          embedUrl: "https://www.youtube.com/embed/lR6GbKuhXRo",
        })}
      </Script>
      {/* Google tag (gtag.js) */}
      <Script
        src="https://www.googletagmanager.com/gtag/js?id=G-5GWH0FWVDZ"
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);} 
          gtag('js', new Date());
          gtag('config', 'G-5GWH0FWVDZ');
        `}
      </Script>

      {/* Hero Section */}
      <div className="w-full min-h-screen flex items-center justify-center relative z-0 overflow-hidden">
        {/* Radial gradient background */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 1200px 800px at 50% 100%, rgb(58 34 14 / 80%) 0%, rgba(9, 11, 11, 0) 65%)",
          }}
        />
        <div className="hero-masthead-section w-full max-w-7xl mx-auto px-4 md:px-8 relative z-10 py-20 md:-mt-20 -translate-y-[35px]">
          <div className="text-center">
            {/* Early Access Pill */}
            <div className="flex justify-center mb-6">
              <button
                onClick={() => setIsVideoModalOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/20 text-sm text-gray-300 hover:border-white/30 hover:text-white transition-colors duration-200 cursor-pointer group"
              >
                <span>Early Access: Agent Development Engine</span>
                <div className="w-4 h-4 rounded-full bg-white/5 border border-white/10 flex items-center justify-center group-hover:bg-white/10 group-hover:border-white/20 transition-all duration-200">
                  <Play className="w-2 h-2 text-gray-300 fill-gray-300" />
                </div>
              </button>
            </div>

            <h1 className="text-4xl md:text-6xl text-white mb-4 md:mb-6 font-laygrotesk">
              Vibe your perfect agent.
              <br />
              Then chat with it in Slack.
            </h1>
            <p className="text-lg md:text-xl text-gray-300 max-w-2xl mb-8 mx-auto">
              Chat with Blink to turn your ideas into fully functional Slack
              chatbots, tooled, deployed, and ready to /invite to your channels
              — built on open source.
            </p>

            {/* Click to Copy Command */}
            <div
              className={`flex flex-col items-center w-full relative transition-all duration-500 ease-out ${
                animationStep >= 1
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-4"
              }`}
            >
              <div className="relative z-10">
                {/* Main Copy Button with Expandable Menu */}
                <div className="relative inline-block">
                  <button
                    onClick={handleCopy}
                    className="group flex items-center gap-3 px-8 py-3 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 hover:border-white/20 hover:px-9 transition-all duration-300 shadow-[0_20px_40px_-10px_rgba(0,0,0,0.3)]"
                  >
                    {/* Chevron Toggle */}
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsCommandMenuOpen(!isCommandMenuOpen);
                      }}
                      className="flex items-center justify-center w-5 h-5 -ml-2 rounded hover:bg-white/5 transition-colors cursor-pointer"
                    >
                      <ChevronDown
                        className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${
                          isCommandMenuOpen ? "rotate-180" : ""
                        }`}
                      />
                    </div>

                    <code className="font-mono text-[18] text-gray-100">
                      bun i -g blink
                    </code>
                    {copied ? (
                      <Check className="w-4 h-4 text-white-400" />
                    ) : (
                      <Copy className="w-4 h-4 text-gray-400 group-hover:text-gray-300 transition-colors" />
                    )}
                  </button>

                  {/* Expandable Command Menu */}
                  {isCommandMenuOpen && (
                    <>
                      {/* Backdrop */}
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setIsCommandMenuOpen(false)}
                      />
                      {/* Command List */}
                      <div className="absolute left-0 top-full mt-2 py-2 bg-white/5 backdrop-blur-sm border border-white/10 rounded-lg shadow-xl z-20 min-w-full">
                        {packageManagers.map((pm, index) => (
                          <button
                            key={pm.id}
                            type="button"
                            onClick={() => handlePMCopy(pm.command, index)}
                            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors group/item"
                          >
                            <Image
                              src={pm.logo}
                              alt={pm.name}
                              width={18}
                              height={18}
                              className="shrink-0"
                            />
                            <code className="font-mono text-sm text-gray-300 flex-1 text-left">
                              {pm.command}
                            </code>
                            {copiedPMIndex === index ? (
                              <Check className="w-4 h-4 text-green-400 shrink-0" />
                            ) : (
                              <Copy className="w-4 h-4 text-gray-500 opacity-0 group-hover/item:opacity-100 transition-opacity shrink-0" />
                            )}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Documentation Link */}
              <a
                href="https://docs.blink.so"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 text-white hover:text-gray-200 transition-colors duration-200 text-sm"
              >
                View Documentation
              </a>

              {/* Animated line extending down - layered behind button */}
              {lineAnimated && (
                <div className="absolute left-1/2 top-full -translate-x-1/2 flex flex-col items-center z-0">
                  <div
                    className="w-px bg-gradient-to-b from-white/10 via-white/10 to-white/5"
                    style={{
                      height: "0px",
                      animation: "line-draw-to-section 0.6s ease-out forwards",
                    }}
                  />
                </div>
              )}
            </div>

            {/* Code IDE Preview - Hidden for now, available in components/CodePreview.tsx */}
            {/* <CodePreview /> */}
          </div>
        </div>
      </div>

      {/* Section 1: Two-column layout with animated line */}
      <section
        id="use-cases"
        className={`w-full relative ${
          isDarkMode ? "bg-[#090B0B] text-white" : "bg-white text-neutral-900"
        }`}
      >
        {/* Shimmer divider line at top of section */}
        <div className="w-full flex justify-center absolute top-0 left-0 right-0 z-10">
          <div
            className="shimmer-line h-px w-full"
            style={{
              background:
                "linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.12) 30%, rgba(255, 255, 255, 0.2) 50%, rgba(255, 255, 255, 0.12) 70%, transparent 100%)",
              backgroundSize: "1000px 100%",
            }}
          />
        </div>
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-24 relative">
          {/* Dark/Light Mode Toggle */}
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className={`absolute top-8 right-8 p-2 rounded-lg transition-all duration-200 ${
              isDarkMode
                ? "bg-white/10 hover:bg-white/20 text-white"
                : "bg-gray-100 hover:bg-gray-200 text-gray-900"
            }`}
            aria-label="Toggle dark mode"
          >
            {isDarkMode ? (
              <Sun className="w-5 h-5" />
            ) : (
              <Moon className="w-5 h-5" />
            )}
          </button>

          {/* Vertical line continuing from above */}
          {lineAnimated && (
            <div
              className={`absolute left-1/2 top-0 -translate-x-1/2 w-px animate-[line-extend-section_1.2s_ease-out_0.4s_forwards] opacity-0 ${
                isDarkMode
                  ? "bg-gradient-to-b from-neutral-800 via-neutral-700 to-transparent"
                  : "bg-gradient-to-b from-gray-300 via-gray-300 to-transparent"
              }`}
              style={{ height: "calc(100% - 200px)" }}
            />
          )}

          {/* Section Headline */}
          <div
            className="text-center mb-20 mt-8 relative py-8"
            style={{
              background: isDarkMode
                ? "linear-gradient(to bottom, rgba(9,11,11,0) 0%, rgba(9,11,11,1) 15%, rgba(9,11,11,1) 85%, rgba(9,11,11,0) 100%)"
                : "linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,1) 15%, rgba(255,255,255,1) 85%, rgba(255,255,255,0) 100%)",
            }}
          >
            <h2
              className={`text-3xl md:text-5xl font-medium mb-4 ${
                isDarkMode ? "text-white" : "text-neutral-900"
              }`}
            >
              You ask. Blink builds.
            </h2>
            <p
              className={`text-lg md:text-xl max-w-3xl mx-auto ${
                isDarkMode ? "text-gray-400" : "text-gray-600"
              }`}
            >
              Blink creates, configures, and deploys your agents. All from your
              terminal.
            </p>
          </div>

          <div className="flex flex-col gap-24 pb-16">
            {/* Row 1: Create your agent */}
            <div
              ref={(el) => {
                sectionRefs.current[0] = el;
              }}
              data-section="0"
              className={`grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-8 lg:gap-16 items-center transition-all duration-700 ease-out ${visibleSections.has(0) ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}
            >
              {/* Code Block */}
              <div
                className="relative py-4"
                style={{
                  background: isDarkMode
                    ? "linear-gradient(to bottom, rgba(9,11,11,0) 0%, rgba(9,11,11,1) 15%, rgba(9,11,11,1) 85%, rgba(9,11,11,0) 100%)"
                    : "linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,1) 15%, rgba(255,255,255,1) 85%, rgba(255,255,255,0) 100%)",
                }}
              >
                <div
                  className={`rounded-lg border overflow-hidden shadow-sm ${
                    isDarkMode
                      ? "border-neutral-800 bg-neutral-900/50"
                      : "border-gray-200 bg-gray-50/50"
                  }`}
                >
                  <div
                    className={`flex items-center gap-2 px-4 py-3 border-b ${
                      isDarkMode
                        ? "border-neutral-800 bg-neutral-800/50"
                        : "border-gray-200 bg-gray-100"
                    }`}
                  >
                    <div className="flex gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-gray-300" />
                      <div className="w-2.5 h-2.5 rounded-full bg-gray-300" />
                      <div className="w-2.5 h-2.5 rounded-full bg-gray-300" />
                    </div>
                    <span
                      className={`text-xs ml-2 ${
                        isDarkMode ? "text-gray-400" : "text-gray-500"
                      }`}
                    >
                      Terminal — /agents/slackbot
                    </span>
                    <button
                      onClick={restartFirstTerminal}
                      className={`ml-auto transition-colors ${
                        isDarkMode
                          ? "text-gray-500 hover:text-gray-300"
                          : "text-gray-400 hover:text-gray-600"
                      }`}
                      aria-label="Restart animation"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div
                    className={`p-4 font-mono text-xs overflow-y-auto ${
                      isDarkMode ? "bg-neutral-900" : "bg-white"
                    }`}
                    style={{ minHeight: "180px", maxHeight: "180px" }}
                  >
                    <div
                      className={`mb-2 ${
                        isDarkMode ? "text-gray-100" : "text-gray-900"
                      }`}
                    >
                      {terminalPrompt.includes(" blink init") ? (
                        <>
                          laptop slackbot %{" "}
                          <span className="font-bold">blink init</span>
                        </>
                      ) : (
                        terminalPrompt
                      )}
                    </div>
                    {terminalLines.map((line, index) => (
                      <div
                        key={index}
                        className={
                          isDarkMode ? "text-gray-100" : "text-gray-900"
                        }
                      >
                        {line.includes("blink dev") ? (
                          <>
                            {"  "}
                            <span className="font-bold">blink dev</span>
                          </>
                        ) : (
                          line || "\u00A0"
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Circle in the middle */}
              <div className="hidden lg:flex justify-center items-center">
                <div
                  className={`w-3 h-3 rounded-full relative z-10 border ${
                    isDarkMode
                      ? "bg-[#090B0B] border-neutral-700"
                      : "bg-white border-gray-300"
                  }`}
                ></div>
              </div>

              {/* Text Block */}
              <div
                className="flex items-center relative py-4"
                style={{
                  background: isDarkMode
                    ? "linear-gradient(to bottom, rgba(9,11,11,0) 0%, rgba(9,11,11,1) 15%, rgba(9,11,11,1) 85%, rgba(9,11,11,0) 100%)"
                    : "linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,1) 15%, rgba(255,255,255,1) 85%, rgba(255,255,255,0) 100%)",
                }}
              >
                <div className="text-center lg:text-left">
                  <div className="flex items-center gap-3 mb-3 justify-center lg:justify-start">
                    <h3
                      className={`text-2xl font-mono font-medium ${
                        isDarkMode ? "text-white" : "text-neutral-900"
                      }`}
                    >
                      blink init
                    </h3>
                    <button
                      onClick={async () => {
                        await navigator.clipboard.writeText("blink init");
                        setCopiedCommand1(true);
                        setTimeout(() => setCopiedCommand1(false), 2000);
                      }}
                      className={`transition-colors ${
                        isDarkMode
                          ? "text-gray-500 hover:text-gray-300"
                          : "text-gray-400 hover:text-gray-600"
                      }`}
                      aria-label="Copy command"
                    >
                      {copiedCommand1 ? (
                        <Check className="w-4 h-4 text-green-600" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  <p
                    className={`text-base leading-relaxed mb-3 ${
                      isDarkMode ? "text-gray-400" : "text-gray-600"
                    }`}
                  >
                    Blink sets up everything your agent needs to deploy, from
                    project structure to configuration. In a few guided steps,
                    you'll create your agent's Slack app and manifest, ready to
                    build and launch.
                  </p>
                  <a
                    href="https://docs.blink.so/get-started/quickstart"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-1.5 text-base underline transition-colors duration-200 ${
                      isDarkMode
                        ? "text-white hover:text-gray-400"
                        : "text-black hover:text-gray-600"
                    }`}
                  >
                    View docs
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            </div>

            {/* Row 2: Describe its capabilities */}
            <div
              ref={(el) => {
                sectionRefs.current[3] = el;
              }}
              data-section="3"
              className={`grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-8 lg:gap-16 items-center transition-all duration-700 ease-out ${visibleSections.has(3) ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}
            >
              {/* Code Block */}
              <div
                className="relative py-4"
                style={{
                  background: isDarkMode
                    ? "linear-gradient(to bottom, rgba(9,11,11,0) 0%, rgba(9,11,11,1) 15%, rgba(9,11,11,1) 85%, rgba(9,11,11,0) 100%)"
                    : "linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,1) 15%, rgba(255,255,255,1) 85%, rgba(255,255,255,0) 100%)",
                }}
              >
                <div
                  className={`rounded-lg border overflow-hidden shadow-sm ${
                    isDarkMode
                      ? "border-neutral-800 bg-neutral-900/50"
                      : "border-gray-200 bg-gray-50/50"
                  }`}
                >
                  <div
                    className={`flex items-center gap-2 px-4 py-3 border-b ${
                      isDarkMode
                        ? "border-neutral-800 bg-neutral-800/50"
                        : "border-gray-200 bg-gray-100"
                    }`}
                  >
                    <div className="flex gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-gray-300" />
                      <div className="w-2.5 h-2.5 rounded-full bg-gray-300" />
                      <div className="w-2.5 h-2.5 rounded-full bg-gray-300" />
                    </div>
                    <span
                      className={`text-xs ml-2 ${
                        isDarkMode ? "text-gray-400" : "text-gray-500"
                      }`}
                    >
                      Terminal — /agents/slackbot
                    </span>
                    <button
                      onClick={() => restartSecondTerminal(false)}
                      className={`ml-auto transition-colors ${
                        isDarkMode
                          ? "text-gray-500 hover:text-gray-300"
                          : "text-gray-400 hover:text-gray-600"
                      }`}
                      aria-label="Restart animation"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div
                    className={`flex flex-col ${isDarkMode ? "bg-neutral-900" : "bg-white"}`}
                    style={{ height: "240px" }}
                  >
                    {/* Messages area - scrollable */}
                    <div
                      ref={secondTerminalMessagesRef}
                      className="flex-1 overflow-y-auto p-4 font-mono text-xs"
                    >
                      <div
                        className={
                          isDarkMode ? "text-gray-100" : "text-gray-900"
                        }
                      >
                        <div className="mb-4">
                          <span className="font-bold">blink■</span> agent
                          development
                        </div>
                        <div
                          className={`mb-4 ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}
                        >
                          You're in edit mode! Describe what you want your agent
                          to do and Blink will make it happen.
                        </div>

                        {/* Submitted messages */}
                        {secondTerminalSubmitted && (
                          <>
                            {/* User message */}
                            <div
                              className={`mb-3 rounded-lg px-3 py-2 ${
                                isDarkMode ? "bg-neutral-800" : "bg-gray-100"
                              }`}
                            >
                              <div
                                className={
                                  isDarkMode ? "text-gray-100" : "text-gray-900"
                                }
                              >
                                Give my agent tools to research GitHub
                                repositories
                              </div>
                            </div>

                            {/* Blink response */}
                            {secondTerminalResponse && (
                              <div
                                className={
                                  isDarkMode ? "text-gray-300" : "text-gray-700"
                                }
                              >
                                <div className="font-semibold mb-1">Blink:</div>
                                <div>{secondTerminalResponse}</div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Input field - fixed at bottom */}
                    <div
                      className={`border-t p-3 ${
                        isDarkMode ? "border-neutral-800" : "border-gray-200"
                      }`}
                    >
                      <div
                        className={`bg-gradient-to-r border px-3 py-2 min-h-[36px] ${
                          isDarkMode
                            ? "from-orange-900/30 to-orange-800/20 border-orange-600"
                            : "from-orange-100 to-orange-50 border-orange-400"
                        }`}
                      >
                        <div
                          className={`font-mono text-xs min-h-[16px] ${
                            isDarkMode ? "text-gray-100" : "text-gray-900"
                          }`}
                        >
                          {secondTerminalInput.length > 0 ? (
                            <>
                              {secondTerminalInput}
                              {secondTerminalInput.length < 56 && (
                                <span className="inline-block w-1.5 h-3 bg-orange-500 ml-0.5 animate-pulse"></span>
                              )}
                            </>
                          ) : secondTerminalSubmitted ? (
                            <span className="inline-block w-1.5 h-3 bg-orange-500 animate-pulse"></span>
                          ) : null}
                        </div>
                      </div>
                      {/* Footer text */}
                      <div
                        className={`flex justify-between mt-2 font-mono text-[10px] ${
                          isDarkMode ? "text-gray-500" : "text-gray-500"
                        }`}
                      >
                        <div className="flex gap-3">
                          <span>
                            mode:{" "}
                            <span className="font-bold text-orange-500">
                              edit
                            </span>
                          </span>
                          <span>
                            Ctrl+T: Switch to{" "}
                            <span className="font-bold text-blue-500">run</span>{" "}
                            mode
                          </span>
                        </div>
                        <span>Esc to interrupt</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Circle in the middle */}
              <div className="hidden lg:flex justify-center items-center">
                <div
                  className={`w-3 h-3 rounded-full relative z-10 border ${
                    isDarkMode
                      ? "bg-[#090B0B] border-neutral-700"
                      : "bg-white border-gray-300"
                  }`}
                ></div>
              </div>

              {/* Text Block */}
              <div
                className="flex items-center relative py-4"
                style={{
                  background: isDarkMode
                    ? "linear-gradient(to bottom, rgba(9,11,11,0) 0%, rgba(9,11,11,1) 15%, rgba(9,11,11,1) 85%, rgba(9,11,11,0) 100%)"
                    : "linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,1) 15%, rgba(255,255,255,1) 85%, rgba(255,255,255,0) 100%)",
                }}
              >
                <div className="text-center lg:text-left">
                  <div className="flex items-center gap-3 mb-3 justify-center lg:justify-start">
                    <h3
                      className={`text-2xl font-mono font-medium ${
                        isDarkMode ? "text-white" : "text-neutral-900"
                      }`}
                    >
                      blink dev
                    </h3>
                    <button
                      onClick={async () => {
                        await navigator.clipboard.writeText("blink dev");
                        setCopiedCommand2(true);
                        setTimeout(() => setCopiedCommand2(false), 2000);
                      }}
                      className={`transition-colors ${
                        isDarkMode
                          ? "text-gray-500 hover:text-gray-300"
                          : "text-gray-400 hover:text-gray-600"
                      }`}
                      aria-label="Copy command"
                    >
                      {copiedCommand2 ? (
                        <Check className="w-4 h-4 text-green-600" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  <p
                    className={`text-base leading-relaxed mb-3 ${
                      isDarkMode ? "text-gray-400" : "text-gray-600"
                    }`}
                  >
                    Chat with Blink in your terminal to shape your agent's tools
                    and behavior. Quickly toggle between edit and run modes to
                    refine, test, and bring your agent to life, all in one
                    terminal.
                  </p>
                  <a
                    href="https://docs.blink.so/get-started/building-with-blink"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-1.5 text-base underline transition-colors duration-200 ${
                      isDarkMode
                        ? "text-white hover:text-gray-400"
                        : "text-black hover:text-gray-600"
                    }`}
                  >
                    View docs
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            </div>

            {/* Row 3: Deploy for all to use */}
            <div
              ref={(el) => {
                sectionRefs.current[4] = el;
              }}
              data-section="4"
              className={`grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-8 lg:gap-16 items-center transition-all duration-700 ease-out ${visibleSections.has(4) ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}
            >
              {/* Code Block */}
              <div
                className="relative py-4"
                style={{
                  background: isDarkMode
                    ? "linear-gradient(to bottom, rgba(9,11,11,0) 0%, rgba(9,11,11,1) 15%, rgba(9,11,11,1) 85%, rgba(9,11,11,0) 100%)"
                    : "linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,1) 15%, rgba(255,255,255,1) 85%, rgba(255,255,255,0) 100%)",
                }}
              >
                <div
                  className={`rounded-lg border overflow-hidden shadow-sm ${
                    isDarkMode
                      ? "border-neutral-800 bg-neutral-900/50"
                      : "border-gray-200 bg-gray-50/50"
                  }`}
                >
                  <div
                    className={`flex items-center gap-2 px-4 py-3 border-b ${
                      isDarkMode
                        ? "border-neutral-800 bg-neutral-800/50"
                        : "border-gray-200 bg-gray-100"
                    }`}
                  >
                    <div className="flex gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-gray-300" />
                      <div className="w-2.5 h-2.5 rounded-full bg-gray-300" />
                      <div className="w-2.5 h-2.5 rounded-full bg-gray-300" />
                    </div>
                    <span
                      className={`text-xs ml-2 ${
                        isDarkMode ? "text-gray-400" : "text-gray-500"
                      }`}
                    >
                      Terminal — /agents/slackbot
                    </span>
                    <button
                      onClick={restartThirdTerminal}
                      className={`ml-auto transition-colors ${
                        isDarkMode
                          ? "text-gray-500 hover:text-gray-300"
                          : "text-gray-400 hover:text-gray-600"
                      }`}
                      aria-label="Restart animation"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div
                    className={`p-4 font-mono text-xs overflow-y-auto ${
                      isDarkMode ? "bg-neutral-900" : "bg-white"
                    }`}
                    style={{ minHeight: "180px", maxHeight: "180px" }}
                  >
                    <div
                      className={`mb-2 ${
                        isDarkMode ? "text-gray-100" : "text-gray-900"
                      }`}
                    >
                      {thirdTerminalPrompt.includes("blink deploy") ? (
                        <>
                          laptop slackbot %{" "}
                          <span className="font-bold">blink deploy</span>
                        </>
                      ) : (
                        thirdTerminalPrompt
                      )}
                    </div>
                    {thirdTerminalLines.map((line, index) => (
                      <div
                        key={index}
                        className={
                          isDarkMode ? "text-gray-100" : "text-gray-900"
                        }
                      >
                        {line.includes("Deployment successful") ? (
                          <>
                            <span className="font-bold text-green-600">
                              Deployment successful.
                            </span>{" "}
                            All chats will use this deployment!
                          </>
                        ) : (
                          line || "\u00A0"
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Circle in the middle */}
              <div className="hidden lg:flex justify-center items-center">
                <div
                  className={`w-3 h-3 rounded-full relative z-10 border ${
                    isDarkMode
                      ? "bg-[#090B0B] border-neutral-700"
                      : "bg-white border-gray-300"
                  }`}
                ></div>
              </div>

              {/* Text Block */}
              <div
                className="flex items-center relative py-4"
                style={{
                  background: isDarkMode
                    ? "linear-gradient(to bottom, rgba(9,11,11,0) 0%, rgba(9,11,11,1) 15%, rgba(9,11,11,1) 85%, rgba(9,11,11,0) 100%)"
                    : "linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,1) 15%, rgba(255,255,255,1) 85%, rgba(255,255,255,0) 100%)",
                }}
              >
                <div className="text-center lg:text-left">
                  <div className="flex items-center gap-3 mb-3 justify-center lg:justify-start">
                    <h3
                      className={`text-2xl font-mono font-medium ${
                        isDarkMode ? "text-white" : "text-neutral-900"
                      }`}
                    >
                      blink deploy
                    </h3>
                    <button
                      onClick={async () => {
                        await navigator.clipboard.writeText("blink deploy");
                        setCopiedCommand3(true);
                        setTimeout(() => setCopiedCommand3(false), 2000);
                      }}
                      className={`transition-colors ${
                        isDarkMode
                          ? "text-gray-500 hover:text-gray-300"
                          : "text-gray-400 hover:text-gray-600"
                      }`}
                      aria-label="Copy command"
                    >
                      {copiedCommand3 ? (
                        <Check className="w-4 h-4 text-green-600" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  <p
                    className={`text-base leading-relaxed mb-3 ${
                      isDarkMode ? "text-gray-400" : "text-gray-600"
                    }`}
                  >
                    Deploy to Blink Cloud to make your agent accessible from
                    anywhere, including Slack. During early access, deploying
                    agents is free.
                  </p>
                  <a
                    href="https://docs.blink.so/get-started/deploying-your-agent"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-1.5 text-base underline transition-colors duration-200 ${
                      isDarkMode
                        ? "text-white hover:text-gray-400"
                        : "text-black hover:text-gray-600"
                    }`}
                  >
                    View docs
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            </div>

            {/* Animated container with line split */}
            <div
              ref={(el) => {
                sectionRefs.current[6] = el;
              }}
              data-section="6"
              className="relative flex flex-col items-center mt-12"
            >
              {/* Full-width container with animated border - NO padding on container */}
              <div
                className={`relative w-full rounded-lg ${
                  isDarkMode ? "bg-[#090B0B]" : "bg-white"
                }`}
              >
                {/* Animated border segments */}
                {visibleSections.has(6) && (
                  <>
                    {/* Top-left border (from center) */}
                    <div
                      className={`absolute top-0 h-px ${
                        isDarkMode ? "bg-neutral-800" : "bg-gray-300"
                      }`}
                      style={{
                        left: "50%",
                        width: "0%",
                        animation: "border-split-top 0.6s ease-out forwards",
                      }}
                    />
                    {/* Top-right border (from center) */}
                    <div
                      className={`absolute top-0 h-px ${
                        isDarkMode ? "bg-neutral-800" : "bg-gray-300"
                      }`}
                      style={{
                        right: "50%",
                        width: "0%",
                        animation: "border-split-top 0.6s ease-out forwards",
                      }}
                    />
                    {/* Left border */}
                    <div
                      className={`absolute top-0 left-0 w-px ${
                        isDarkMode ? "bg-neutral-800" : "bg-gray-300"
                      }`}
                      style={{
                        height: "0%",
                        animation:
                          "border-split-sides 0.8s ease-out 0.6s forwards",
                      }}
                    />
                    {/* Right border */}
                    <div
                      className={`absolute top-0 right-0 w-px ${
                        isDarkMode ? "bg-neutral-800" : "bg-gray-300"
                      }`}
                      style={{
                        height: "0%",
                        animation:
                          "border-split-sides 0.8s ease-out 0.6s forwards",
                      }}
                    />
                    {/* Bottom-left border */}
                    <div
                      className={`absolute bottom-0 left-0 h-px ${
                        isDarkMode ? "bg-neutral-800" : "bg-gray-300"
                      }`}
                      style={{
                        width: "0%",
                        animation:
                          "border-split-bottom 0.6s ease-out 1.4s forwards",
                      }}
                    />
                    {/* Bottom-right border */}
                    <div
                      className={`absolute bottom-0 right-0 h-px ${
                        isDarkMode ? "bg-neutral-800" : "bg-gray-300"
                      }`}
                      style={{
                        width: "0%",
                        animation:
                          "border-split-bottom 0.6s ease-out 1.4s forwards",
                      }}
                    />
                  </>
                )}

                {/* Header Content - with padding - fades in with border */}
                <div
                  className={`px-8 md:px-16 pt-20 pb-24 text-center transition-opacity duration-500 ${
                    visibleSections.has(6) ? "opacity-100" : "opacity-0"
                  }`}
                >
                  <h2
                    className={`text-3xl md:text-5xl font-medium mb-6 ${
                      isDarkMode ? "text-white" : "text-neutral-900"
                    }`}
                  >
                    Add your agent to Slack
                  </h2>
                  <p
                    className={`text-lg md:text-xl max-w-2xl mx-auto ${
                      isDarkMode ? "text-gray-400" : "text-gray-600"
                    }`}
                  >
                    Your deployed agent is instantly available as a Slack
                    chatbot, ready to work with your team in any channel you add
                    it to.
                  </p>
                </div>

                {/* YouTube Video and Three-row table - animates in after border completes */}
                <div
                  className="w-full overflow-hidden"
                  style={{
                    maxHeight: visibleSections.has(6) ? "3000px" : "0px",
                    opacity: visibleSections.has(6) ? 1 : 0,
                    transition:
                      "max-height 1.2s cubic-bezier(0.4, 0, 0.2, 1) 2.0s, opacity 0.8s ease-out 2.2s",
                  }}
                >
                  {/* YouTube Video Embed - Hidden on mobile */}
                  <div className="hidden md:block w-full px-[1px]">
                    <div className="relative aspect-video overflow-hidden">
                      <iframe
                        src={`https://www.youtube.com/embed/lR6GbKuhXRo?autoplay=${visibleSections.has(6) ? "1" : "0"}&loop=1&playlist=lR6GbKuhXRo&mute=1&controls=1&modestbranding=1&rel=0&vq=hd1080`}
                        title="Blink Slack Integration Demo"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="absolute inset-0 w-full h-full"
                      />
                    </div>
                  </div>

                  {/* Three-row staggered table */}
                  {/* Row 1: Text before image on mobile, image left on desktop */}
                  <div
                    className={`grid grid-cols-1 md:grid-cols-2 w-full border-t ${isDarkMode ? "border-neutral-800" : "border-gray-300"}`}
                  >
                    <div
                      className={`flex items-center px-6 md:px-12 py-8 md:py-12 md:border-l order-1 md:order-2 ${isDarkMode ? "border-neutral-800" : "border-gray-300"}`}
                    >
                      <div>
                        <h3
                          className={`text-xl font-medium mb-3 ${isDarkMode ? "text-white" : "text-neutral-900"}`}
                        >
                          Democratize information access
                        </h3>
                        <p
                          className={`text-base ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}
                        >
                          Ship agents that connect directly to your business
                          systems, with or without MCP, so everyone can find the
                          information they need (without digging through
                          unfamiliar tools.)
                        </p>
                      </div>
                    </div>
                    <div className="relative h-64 md:h-80 overflow-hidden order-2 md:order-1">
                      <Image
                        src="/slack-1.png"
                        alt="Slack integration feature"
                        fill
                        sizes="(max-width: 768px) 100vw, 50vw"
                        className="object-cover object-left-top md:object-left"
                      />
                    </div>
                  </div>

                  {/* Row 2: Text before image on mobile, text left on desktop */}
                  <div
                    className={`grid grid-cols-1 md:grid-cols-2 w-full border-t ${isDarkMode ? "border-neutral-800" : "border-gray-300"}`}
                  >
                    <div
                      className={`flex items-center px-6 md:px-12 py-8 md:py-12 md:border-r order-1 ${isDarkMode ? "border-neutral-800" : "border-gray-300"}`}
                    >
                      <div>
                        <h3
                          className={`text-xl font-medium mb-3 ${isDarkMode ? "text-white" : "text-neutral-900"}`}
                        >
                          Stay informed, stay inspired
                        </h3>
                        <p
                          className={`text-base ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}
                        >
                          Slack agents can do more than automate work. Build
                          ones that keep your team connected with the latest
                          news, trends, or fun updates.
                        </p>
                      </div>
                    </div>
                    <div className="relative h-64 md:h-80 overflow-hidden order-2">
                      <Image
                        src="/slack-2.png"
                        alt="Slack integration feature"
                        fill
                        sizes="(max-width: 768px) 100vw, 50vw"
                        className="object-cover object-left-top md:object-left"
                      />
                    </div>
                  </div>

                  {/* Row 3: Text before image on mobile, image left on desktop */}
                  <div
                    className={`grid grid-cols-1 md:grid-cols-2 w-full border-t ${isDarkMode ? "border-neutral-800" : "border-gray-300"}`}
                  >
                    <div
                      className={`flex items-center px-6 md:px-12 py-8 md:py-12 md:border-l order-1 md:order-2 ${isDarkMode ? "border-neutral-800" : "border-gray-300"}`}
                    >
                      <div>
                        <h3
                          className={`text-xl font-medium mb-3 ${isDarkMode ? "text-white" : "text-neutral-900"}`}
                        >
                          Supplement your teams
                        </h3>
                        <p
                          className={`text-base ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}
                        >
                          Give agents tools that let them work alongside your
                          team, handling the backlog tasks and noisy requests
                          that slow progress so your people can focus on
                          higher-impact work.
                        </p>
                      </div>
                    </div>
                    <div className="relative h-64 md:h-80 overflow-hidden order-2 md:order-1">
                      <Image
                        src="/slack-3.png"
                        alt="Slack integration feature"
                        fill
                        sizes="(max-width: 768px) 100vw, 50vw"
                        className="object-cover object-left-top md:object-left"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 3*/}
      <section
        id="prs"
        className="w-full bg-[#090B0B] text-white relative overflow-hidden"
      >
        {/* Shimmer divider line at top of section */}
        <div className="w-full flex justify-center absolute top-0 left-0 right-0 z-10">
          <div
            className="shimmer-line h-px w-full"
            style={{
              background:
                "linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.12) 30%, rgba(255, 255, 255, 0.2) 50%, rgba(255, 255, 255, 0.12) 70%, transparent 100%)",
              backgroundSize: "1000px 100%",
            }}
          />
        </div>
        {/* Radial gradient background - subdued version of masthead */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 1200px 800px at 50% 0%, rgb(58 34 14 / 40%) 0%, rgba(9, 11, 11, 0) 65%)",
          }}
        />
        <div className="max-w-7xl mx-auto px-4 md:px-8 pt-24 pb-32 relative">
          {/* Section Header */}
          <div className="text-center mb-16 relative py-8">
            <h2 className="text-3xl md:text-5xl font-medium text-white mb-4">
              From local to live, Blink powers it all.
            </h2>
            <p className="text-lg md:text-xl text-gray-300 max-w-3xl mx-auto">
              Open-source and coupled with the Vercel AI SDK, Blink is an agent
              development engine that delivers agents from your terminal to the
              world.
            </p>
          </div>

          {/* Six Features Grid with borders */}
          <div className="grid grid-cols-1 md:grid-cols-3 mb-16 relative">
            {/* Animated border overlay - hidden on mobile */}
            <div
              ref={(el) => {
                sectionRefs.current[5] = el;
              }}
              data-section="5"
              className={`absolute inset-0 md:border border-white/10 pointer-events-none ${visibleSections.has(5) ? "border-animate-visible" : "border-animate-container"}`}
            ></div>

            {/* Inner borders container with animation - hidden on mobile */}
            <div
              className={`absolute inset-0 hidden md:grid grid-cols-1 md:grid-cols-3 pointer-events-none ${visibleSections.has(5) ? "border-animate-visible" : "border-animate-container"}`}
            >
              <div className="border-b md:border-r border-white/10"></div>
              <div className="border-b md:border-r border-white/10"></div>
              <div className="border-b border-white/10"></div>
              <div className="border-b md:border-b-0 md:border-r border-white/10"></div>
              <div className="border-b md:border-b-0 md:border-r border-white/10"></div>
              <div></div>
            </div>
            {/* Feature 1 */}
            <div className="p-8">
              <h3 className="text-xl font-medium text-white mb-3 flex items-center gap-3">
                <Container className="w-5 h-5 text-gray-400" />
                Simple HTTP Server
              </h3>
              <p className="text-gray-300 leading-relaxed">
                Every Blink agent is simply a Node HTTP server. Deploy anywhere
                Node runs—your laptop, VPS, or the cloud.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="p-8">
              <h3 className="text-xl font-medium text-white mb-3 flex items-center gap-3">
                <Key className="w-5 h-5 text-gray-400" />
                Bring Your Own Keys
              </h3>
              <p className="text-gray-300 leading-relaxed">
                Use your own API keys for OpenAI, Anthropic, or any provider. No
                gateway required. Built on the familiar AI SDK for maximum
                flexibility.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="p-8">
              <h3 className="text-xl font-medium text-white mb-3 flex items-center gap-3">
                <Zap className="w-5 h-5 text-gray-400" />
                Agent-Ready SDKs
              </h3>
              <p className="text-gray-300 leading-relaxed">
                Pre-built tools for Slack, GitHub, and search. Extend with
                custom tools and even manual approval workflows.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="p-8">
              <h3 className="text-xl font-medium text-white mb-3 flex items-center gap-3">
                <GitBranch className="w-5 h-5 text-gray-400" />
                Local-First Development
              </h3>
              <p className="text-gray-300 leading-relaxed">
                Hot-reload your agent with blink dev. Chats and storage persist
                locally in JSON files. Test everything offline before deploying
                anywhere.
              </p>
            </div>

            {/* Feature 5 */}
            <div className="p-8">
              <h3 className="text-xl font-medium text-white mb-3 flex items-center gap-3">
                <Cloud className="w-5 h-5 text-gray-400" />
                Deploy Anywhere (or Nowhere)
              </h3>
              <p className="text-gray-300 leading-relaxed">
                Bundle as an npm package to share, run locally forever, or
                optionally deploy to blink.so. Cloud is never required—Blink is
                local-first by design.
              </p>
            </div>

            {/* Feature 6 */}
            <div className="p-8">
              <h3 className="text-xl font-medium text-white mb-3 flex items-center gap-3">
                <CheckSquare className="w-5 h-5 text-gray-400" />
                Open Source, MIT Licensed
              </h3>
              <p className="text-gray-300 leading-relaxed">
                Open source under MIT. Audit the code, fork it, modify it. We
                believe that agent development tooling shouldn't be black boxed.
              </p>
            </div>
          </div>

          {/* View Documentation Button */}
          <div className="flex justify-center">
            <a
              href="https://docs.blink.so"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-white text-black rounded-full font-medium hover:bg-gray-100 transition-colors duration-200"
            >
              View Documentation
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section
        className={`w-full relative ${
          isDarkMode ? "bg-[#090B0B] text-white" : "bg-white text-neutral-900"
        }`}
      >
        {/* Shimmer divider line at top of section */}
        <div className="w-full flex justify-center absolute top-0 left-0 right-0 z-10">
          <div
            className="shimmer-line h-px w-full"
            style={{
              background:
                "linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.12) 30%, rgba(255, 255, 255, 0.2) 50%, rgba(255, 255, 255, 0.12) 70%, transparent 100%)",
              backgroundSize: "1000px 100%",
            }}
          />
        </div>
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-24 md:py-32 relative">
          {/* Centered vertical line */}
          <div className="absolute inset-0 flex justify-center">
            <div
              className={`w-px h-full ${
                isDarkMode ? "bg-neutral-800" : "bg-gray-200"
              }`}
            ></div>
          </div>
          {/* Elegant FAQ Accordion */}
          <div className="relative z-10 flex justify-center">
            <div
              className={`rounded-lg shadow-sm max-w-2xl w-full border ${
                isDarkMode
                  ? "bg-[#090B0B] border-neutral-800"
                  : "bg-white border-gray-200"
              }`}
            >
              {[
                {
                  question: "What is Blink?",
                  answer:
                    "Blink is an open-source development engine for building Slack agents from your terminal. It turns your natural language instructions into fully functional agents with tools, handles deployment to Slack, and runs locally-first so you can tinker before going live.",
                },
                {
                  question: "How do I get started with Blink?",
                  answer:
                    "Run 'blink init' in your terminal to create a new agent. Then use 'blink dev' to describe what you want your agent to do—Blink will build the tools and functionality. When ready, run 'blink deploy' to make it available in Slack. The entire workflow happens in your terminal.",
                },
                {
                  question: "Do I need to host Blink somewhere?",
                  answer:
                    "No! Blink agents run locally on your machine during development. For production, you can optionally deploy to Blink Cloud (free during Early Access). Blink is local-first by design so you can experiment without deploying to a cloud.",
                },
                {
                  question: "How does Blink compare to other agent frameworks?",
                  answer:
                    "Blink is open source (MIT license) and local-first. You bring your own API keys for OpenAI, Anthropic, or any LLM provider—no gateways or markup. Every Blink agent is just a Node.js HTTP server, so there's no vendor lock-in. You can audit the code, fork it, and deploy anywhere.",
                },
                {
                  question: "When will Blink be generally available?",
                  answer:
                    "Blink is currently in Early Access with limited availability. We're prioritizing users who can provide strong feedback to help improve the platform. You can join the waitlist at blink.so/signup to be notified when access expands.",
                },
              ].map((faq, index) => (
                <div
                  key={index}
                  className={`${
                    index === 0
                      ? ""
                      : isDarkMode
                        ? "border-t border-neutral-800"
                        : "border-t border-gray-200"
                  }`}
                >
                  <button
                    className={`w-full px-6 py-5 text-left flex items-center justify-between transition-colors duration-200 ${
                      isDarkMode ? "hover:bg-white/5" : "hover:bg-gray-50"
                    }`}
                    onClick={() =>
                      setOpenFAQ2(openFAQ2 === index ? null : index)
                    }
                  >
                    <span
                      className={`text-base font-medium pr-4 ${
                        isDarkMode ? "text-white" : "text-gray-900"
                      }`}
                    >
                      {faq.question}
                    </span>
                    <ChevronDown
                      className={`w-4 h-4 transition-transform duration-200 shrink-0 ${
                        openFAQ2 === index ? "rotate-180" : "rotate-0"
                      } ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}
                    />
                  </button>
                  <div
                    className={`overflow-hidden transition-all duration-300 ease-in-out ${
                      openFAQ2 === index ? "max-h-96 pb-5" : "max-h-0"
                    }`}
                  >
                    {" "}
                    <div
                      className={`px-6 leading-relaxed text-base ${
                        isDarkMode ? "text-gray-400" : "text-gray-600"
                      }`}
                    >
                      {faq.question ===
                      "When will Blink be generally available?" ? (
                        <>
                          Blink is currently in Early Access with limited
                          availability. We're prioritizing users who can provide
                          strong feedback to help improve the platform. You can
                          join the waitlist at{" "}
                          <a
                            href="https://blink.coder.com/signup"
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`underline ${
                              isDarkMode
                                ? "text-white hover:text-gray-300"
                                : "text-gray-900 hover:text-black"
                            }`}
                          >
                            blink.so/signup
                          </a>{" "}
                          to be notified when access expands.
                        </>
                      ) : (
                        faq.answer
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
      {/* New Dark Section with Continuing Vertical Line */}
      <section className="w-full bg-[#090B0B] text-white relative overflow-hidden">
        {/* Shimmer divider line at top of section */}
        <div className="w-full flex justify-center absolute top-0 left-0 right-0 z-10">
          <div
            className="shimmer-line h-px w-full"
            style={{
              background:
                "linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.12) 30%, rgba(255, 255, 255, 0.2) 50%, rgba(255, 255, 255, 0.12) 70%, transparent 100%)",
              backgroundSize: "1000px 100%",
            }}
          />
        </div>
        {/* Radial gradient background - subdued version of masthead */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 1200px 800px at 50% 0%, rgb(52 32 17 / 20%) 0%, rgba(9, 11, 11, 0) 65%)",
          }}
        />
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-24 md:py-32 relative">
          {/* Continuing vertical line with fade - matching Section 4 color */}
          <div className="absolute inset-0 flex justify-center">
            <div className="w-px h-1/3 bg-gradient-to-b from-neutral-800 to-transparent"></div>
          </div>
          {/* Content below the line */}
          <div className="relative z-10 text-center mt-16">
            <h2 className="text-3xl md:text-4xl font-medium text-white mb-8">
              Try Blink for yourself
            </h2>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <button
                onClick={handleBottomCopy}
                className="group flex items-center gap-3 px-8 py-3 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 hover:border-white/20 hover:px-9 transition-all duration-300 shadow-[0_20px_40px_-10px_rgba(0,0,0,0.3)]"
              >
                <code className="font-mono text-[18px] text-gray-100">
                  bun i -g blink
                </code>
                {copiedBottom ? (
                  <Check className="w-4 h-4 text-white-400" />
                ) : (
                  <Copy className="w-4 h-4 text-gray-400 group-hover:text-gray-300 transition-colors" />
                )}
              </button>
              <a
                href="https://docs.blink.so"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-300 hover:text-white transition-colors duration-300 text-base underline underline-offset-4 decoration-gray-500 hover:decoration-white inline-flex items-center justify-center gap-1 w-full sm:w-auto"
              >
                Documentation
                <ExternalLink className="w-3 h-3 ml-1" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Video Modal - using portal to render at body level */}
      {isMounted &&
        isVideoModalOpen &&
        createPortal(
          <div
            className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            style={{ zIndex: 10000 }}
            onClick={() => setIsVideoModalOpen(false)}
          >
            <div
              className="relative w-full max-w-7xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button - positioned above video */}
              <button
                onClick={() => setIsVideoModalOpen(false)}
                className="absolute -top-14 right-0 z-10 w-12 h-12 flex items-center justify-center rounded-full bg-white/90 hover:bg-white text-black transition-colors shadow-lg"
                aria-label="Close video"
              >
                <X className="w-6 h-6" />
              </button>

              {/* Video container */}
              <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden shadow-2xl">
                {/* YouTube iframe */}
                <iframe
                  src="https://www.youtube.com/embed/livXHAbMAtY?autoplay=1"
                  title="Chat in Slack in 60 seconds"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="absolute inset-0 w-full h-full"
                />
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
