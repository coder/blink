"use client";

import {
  Bot,
  Check,
  CheckSquare,
  ChevronDown,
  Cloud,
  Code,
  Container,
  Copy,
  ExternalLink,
  Eye,
  GitBranch,
  Key,
  MessageSquare,
  Play,
  RotateCw,
  Terminal,
  Users,
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
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const [copiedPMIndex, setCopiedPMIndex] = useState<number | null>(null);
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const intervalIdsRef = useRef<number[]>([]);
  const [slideOutIcon, setSlideOutIcon] = useState(false);
  const [animateInIcon, setAnimateInIcon] = useState(false);

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

  // Animate icon in from top on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimateInIcon(true);
    }, 100); // Small delay to ensure initial state is rendered
    return () => clearTimeout(timer);
  }, []);

  // Slide out icon after 4 seconds over headline (4400ms total: 100ms delay + 500ms slide-in + 3800ms stay)
  useEffect(() => {
    const timer = setTimeout(() => {
      setSlideOutIcon(true);
    }, 4400);
    return () => clearTimeout(timer);
  }, []);

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
            "Self-hosted platform for deploying custom AI agents. Ships with Scout, a powerful coding agent for deep code research. Integrates with Slack, GitHub, and your infrastructure.",
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
              "radial-gradient(ellipse 1200px 800px at 50% 100%, rgba(14, 28, 58, 0.8) 0%, rgba(9, 11, 11, 0) 65%)",
          }}
        />
        <div className="hero-masthead-section w-full max-w-7xl mx-auto px-4 md:px-8 relative z-10 py-20 md:-mt-20 -translate-y-[85px]">
          <div className="text-center">
            {/* Blink hop icon */}
            <div
              className={`flex justify-center mb-6 h-[100px] w-full ${
                slideOutIcon
                  ? "animate-[hop-off-bottom_1s_linear_forwards]"
                  : animateInIcon
                    ? "translate-y-0 opacity-100 transition-all duration-500 ease-in-out"
                    : "-translate-y-[100vh] opacity-0"
              }`}
            >
              <style jsx>{`
                @keyframes hop-off-bottom {
                  0% {
                    transform: translateY(0);
                    opacity: 1;
                  }
                  20% {
                    transform: translateY(-40px);
                    opacity: 1;
                  }
                  30% {
                    transform: translateY(-40px);
                    opacity: 1;
                  }
                  45% {
                    transform: translateY(-20px);
                    opacity: 1;
                  }
                  60% {
                    transform: translateY(20px);
                    opacity: 1;
                  }
                  75% {
                    transform: translateY(100px);
                    opacity: 0.8;
                  }
                  100% {
                    transform: translateY(100vh);
                    opacity: 0;
                  }
                }
              `}</style>
              <Image
                src="/blink-hop-cropped.png"
                alt="Blink"
                width={100}
                height={100}
                className="brightness-0 invert object-contain"
                priority
              />
            </div>
            <h1 className="text-4xl md:text-6xl text-white mb-4 md:mb-6 font-laygrotesk max-w-[800px] mx-auto">
              Your team's deep code research partner, in Slack
            </h1>
            <p className="text-lg md:text-xl text-gray-300 max-w-2xl mb-8 mx-auto">
              Blink is a self-hosted platform for deploying custom agents, and
              ships with a powerful coding agent that includes GitHub and Slack
              tools out of the box.
            </p>

            {/* View Docs CTA */}
            <div
              className={`flex flex-col items-center w-full relative transition-all duration-500 ease-out ${
                animationStep >= 1
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-4"
              }`}
            >
              <div className="relative z-10 flex flex-col items-center gap-3">
                <a
                  href="https://blink.coder.com/docs"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-3 px-8 py-3 bg-white/5 border border-white/10 rounded-full hover:bg-white/10 hover:border-white/20 hover:px-9 transition-all duration-300 shadow-[0_20px_40px_-10px_rgba(0,0,0,0.3)]"
                >
                  <span className="text-[18px] text-gray-100 font-medium">
                    View Documentation
                  </span>
                  <ExternalLink className="w-4 h-4 text-gray-400 group-hover:text-gray-300 transition-colors" />
                </a>
                <a
                  href="#use-cases"
                  className="text-gray-400 hover:text-gray-200 transition-colors duration-200 text-sm underline underline-offset-4"
                >
                  See it in action
                </a>
              </div>

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
        className="w-full relative bg-white text-neutral-900"
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
        <div className="max-w-7xl mx-auto px-4 md:px-8 pt-24 pb-0 relative">
          {/* Vertical line continuing from above */}
          {lineAnimated && (
            <div
              className="absolute left-1/2 top-0 -translate-x-1/2 w-px animate-[line-extend-section_1.2s_ease-out_0.4s_forwards] opacity-0 bg-gradient-to-b from-gray-300 via-gray-300 to-transparent"
              style={{ height: "calc(100% - 200px)" }}
            />
          )}

          {/* Section Headline */}
          <div
            className="text-center mb-8 mt-8 relative py-8"
            style={{
              background:
                "linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,1) 15%, rgba(255,255,255,1) 85%, rgba(255,255,255,0) 100%)",
            }}
          >
            <h2 className="text-3xl md:text-5xl font-medium mb-4 text-neutral-900">
              Built for real work, not just chat
            </h2>
            <p className="text-lg md:text-xl max-w-3xl mx-auto text-gray-600">
              Blink agents deliver a Slack experience that other agents can only
              hallucinate about.
            </p>
          </div>

          <div className="mb-[172px] w-full max-w-7xl mx-auto">
            <div className="relative aspect-video overflow-hidden rounded-lg">
              <iframe
                src="https://www.youtube.com/embed/lR6GbKuhXRo?loop=1&playlist=lR6GbKuhXRo&mute=1&controls=1&modestbranding=1&rel=0&vq=hd1080&hd=1"
                title="Blink Slack Integration Demo"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 w-full h-full"
              />
            </div>
          </div>

          {/* Slack Screenshots */}
          <div className="w-full max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-3 relative">
            <div className="relative overflow-hidden rounded-lg shadow-lg drop-shadow-[0_0_15px_rgba(0,0,0,0.25)] translate-y-[5px]">
              <Image
                src="/slack-screenshots/slack-1.jpg"
                alt="Slack conversation example 1"
                width={800}
                height={600}
                className="w-full h-auto object-cover"
              />
            </div>
            <div className="hidden md:block relative overflow-hidden rounded-lg shadow-xl scale-105 drop-shadow-[0_0_25px_rgba(0,0,0,0.4)]">
              <Image
                src="/slack-screenshots/slack-2.jpg"
                alt="Slack conversation example 2"
                width={800}
                height={600}
                className="w-full h-auto object-cover"
              />
            </div>
            <div className="hidden md:block relative overflow-hidden rounded-lg shadow-lg drop-shadow-[0_0_15px_rgba(0,0,0,0.25)] translate-y-[5px]">
              <Image
                src="/slack-screenshots/slack-3.jpg"
                alt="Slack conversation example 3"
                width={800}
                height={600}
                className="w-full h-auto object-cover"
              />
            </div>

            {/* Blink hop icon */}
            <div className="hidden md:block absolute -right-24 bottom-0 translate-y-[10px]">
              <Image
                src="/blink-hop-cropped.png"
                alt="Blink"
                width={40}
                height={40}
                className="object-contain"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Section 3*/}
      <section
        id="prs"
        className="w-full bg-[#090B0B] text-white relative overflow-hidden z-10"
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
              "radial-gradient(ellipse 1200px 800px at 50% 0%, rgba(14, 28, 58, 0.4) 0%, rgba(9, 11, 11, 0) 65%)",
          }}
        />
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-24 relative">
          {/* Section Header */}
          <div className="text-center mb-16 mt-8 relative py-8">
            <h2 className="text-3xl md:text-5xl font-medium text-white mb-4">
              A ready-to-ship agent, out of the box
            </h2>
            <p className="text-lg md:text-xl text-gray-300 max-w-3xl mx-auto">
              Blink ships with a powerful coding agent out of the box, with the
              flexibility to customize it or build your own and deploy agents
              safely on your infrastructure.
            </p>
          </div>

          {/* Web UI Screenshot */}
          <div className="w-full max-w-7xl mx-auto mb-24 relative">
            {/* Glowing effect */}
            <div
              className="absolute inset-0 blur-3xl opacity-90"
              style={{
                background:
                  "radial-gradient(ellipse 800px 400px at 50% 50%, rgba(14, 28, 58, 1) 0%, transparent 70%)",
              }}
            />
            <div
              className="relative overflow-hidden shadow-xl drop-shadow-[0_0_20px_rgba(14,28,58,0.4)] border border-white/10"
              style={{ borderRadius: "14px" }}
            >
              <Image
                src="/slack-screenshots/web-ui-screenshot.jpg"
                alt="Blink Web UI"
                width={1920}
                height={1080}
                className="w-full h-auto object-cover"
              />
            </div>
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
                <Bot className="w-5 h-5 text-gray-400" />
                Pre-built Scout Agent
              </h3>
              <p className="text-gray-300 leading-relaxed">
                A fully-functional coding agent that you can customize for your
                own use. Handles deep code research and complex tasks out of the
                box.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="p-8">
              <h3 className="text-xl font-medium text-white mb-3 flex items-center gap-3">
                <MessageSquare className="w-5 h-5 text-gray-400" />
                Web UI
              </h3>
              <p className="text-gray-300 leading-relaxed">
                Chat with your agents directly in the browser. A clean,
                intuitive interface for interacting with all your deployed
                agents.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="p-8">
              <h3 className="text-xl font-medium text-white mb-3 flex items-center gap-3">
                <Code className="w-5 h-5 text-gray-400" />
                Blink SDK
              </h3>
              <p className="text-gray-300 leading-relaxed">
                A set of libraries for building agents compatible with the Blink
                platform. Build custom agents in TypeScript with ease.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="p-8">
              <h3 className="text-xl font-medium text-white mb-3 flex items-center gap-3">
                <Terminal className="w-5 h-5 text-gray-400" />
                Blink CLI
              </h3>
              <p className="text-gray-300 leading-relaxed">
                A command-line tool for developing agents locally. Hot-reload,
                test, and iterate on your agents before deployment.
              </p>
            </div>

            {/* Feature 5 */}
            <div className="p-8">
              <h3 className="text-xl font-medium text-white mb-3 flex items-center gap-3">
                <Eye className="w-5 h-5 text-gray-400" />
                Observability
              </h3>
              <p className="text-gray-300 leading-relaxed">
                Use the web UI to view logs and traces. Debug and monitor your
                agents with full visibility into their operations.
              </p>
            </div>

            {/* Feature 6 */}
            <div className="p-8">
              <h3 className="text-xl font-medium text-white mb-3 flex items-center gap-3">
                <Container className="w-5 h-5 text-gray-400" />
                Docker-based Deployment
              </h3>
              <p className="text-gray-300 leading-relaxed">
                Agents are deployed as Docker containers. Consistent, reliable
                deployment with all the benefits of containerization.
              </p>
            </div>
          </div>

          {/* View Documentation Button */}
          <div className="flex justify-center mb-8">
            <a
              href="https://blink.coder.com/docs"
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
      <section className="w-full relative bg-white text-neutral-900">
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
            <div className="w-px h-full bg-gray-200"></div>
          </div>
          {/* Elegant FAQ Accordion */}
          <div className="relative z-10 flex justify-center">
            <div
              className={`rounded-lg shadow-sm max-w-2xl w-full border ${"bg-white border-gray-200"}`}
            >
              {[
                {
                  question: "What is Blink?",
                  answer:
                    "Blink is a self-hosted platform for deploying custom AI agents. It ships with a built-in coding agent (Scout) tooled for deep code research and complex tasks. You can work alongside Blink agents in GitHub, the web UI, or in threaded Slack conversations.",
                },
                {
                  question: "How do I get started with Blink?",
                  answer: (
                    <>
                      Install the Blink server with{" "}
                      <code className="px-1.5 py-0.5 bg-gray-100 rounded text-sm font-mono text-gray-900">
                        npm install -g blink-server
                      </code>{" "}
                      then run{" "}
                      <code className="px-1.5 py-0.5 bg-gray-100 rounded text-sm font-mono text-gray-900">
                        blink-server
                      </code>
                      . Open the web UI in your browser to create your first
                      agent. You'll need Node.js 22+ (or Bun) and Docker
                      installed on your server.
                    </>
                  ),
                },
                {
                  question: "What's a Blink agent?",
                  answer:
                    "Blink agents are HTTP servers that respond to events. The Blink Server deploys them as Docker containers, routes messages from Slack/GitHub/web UI, and manages conversation state—your agent just defines how to respond. You build them in TypeScript using the Blink SDK.",
                },
                {
                  question: "Can I customize the Scout agent or build my own?",
                  answer:
                    "Yes! The Scout agent is fully customizable with new tools and prompts. You can also build completely new agents in TypeScript using the Blink SDK, which provides pre-built tools for Slack, GitHub, search, and more.",
                },
                {
                  question: "What license is Blink under?",
                  answer:
                    "The server code is licensed under AGPLv3, while the agent SDKs are licensed under MIT. This means you can build and deploy custom agents freely while the platform itself remains open source.",
                },
              ].map((faq, index) => (
                <div
                  key={index}
                  className={`${index === 0 ? "" : "border-t border-gray-200"}`}
                >
                  <button
                    className="w-full px-6 py-5 text-left flex items-center justify-between transition-colors duration-200 hover:bg-gray-50"
                    onClick={() =>
                      setOpenFAQ2(openFAQ2 === index ? null : index)
                    }
                  >
                    <span className="text-base font-medium pr-4 text-gray-900">
                      {faq.question}
                    </span>
                    <ChevronDown
                      className={`w-4 h-4 transition-transform duration-200 shrink-0 ${
                        openFAQ2 === index ? "rotate-180" : "rotate-0"
                      } ${"text-gray-500"}`}
                    />
                  </button>
                  <div
                    className={`overflow-hidden transition-all duration-300 ease-in-out ${
                      openFAQ2 === index ? "max-h-96 pb-5" : "max-h-0"
                    }`}
                  >
                    {" "}
                    <div
                      className={`px-6 leading-relaxed text-base ${"text-gray-600"}`}
                    >
                      {faq.answer}
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
              "radial-gradient(ellipse 1200px 800px at 50% 0%, rgba(14, 28, 58, 0.2) 0%, rgba(9, 11, 11, 0) 65%)",
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
            <div className="flex flex-col gap-4 justify-center items-center">
              <button
                onClick={handleBottomCopy}
                className="group flex items-center gap-3 px-8 py-3 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 hover:border-white/20 hover:px-9 transition-all duration-300 shadow-[0_20px_40px_-10px_rgba(0,0,0,0.3)]"
              >
                <code className="font-mono text-[18px] text-gray-100">
                  npm install -g blink-server
                </code>
                {copiedBottom ? (
                  <Check className="w-4 h-4 text-white-400" />
                ) : (
                  <Copy className="w-4 h-4 text-gray-400 group-hover:text-gray-300 transition-colors" />
                )}
              </button>
              <a
                href="https://blink.coder.com/docs"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-300 hover:text-white transition-colors duration-300 text-base underline underline-offset-4 decoration-gray-500 hover:decoration-white inline-flex items-center justify-center gap-1"
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
