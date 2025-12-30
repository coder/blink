import { useCallback, useEffect, useRef } from "react";
import useSWR from "swr";

type ScrollFlag = ScrollBehavior | false;

export function useChatMessagesScroll() {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const { data: isAtTop = false, mutate: setIsAtTop } = useSWR(
    `chat-messages:is-at-top`,
    null,
    { fallbackData: false }
  );

  const { data: isAtBottom = false, mutate: setIsAtBottom } = useSWR(
    `chat-messages:is-at-bottom`,
    null,
    { fallbackData: false }
  );

  const { data: scrollBehavior = false, mutate: setScrollBehavior } =
    useSWR<ScrollFlag>(`chat-messages:should-scroll`, null, {
      fallbackData: false,
    });

  useEffect(() => {
    if (scrollBehavior) {
      endRef.current?.scrollIntoView({ behavior: scrollBehavior });
      setScrollBehavior(false);
    }
  }, [setScrollBehavior, scrollBehavior]);

  const scrollToBottom = useCallback(
    (scrollBehavior: ScrollBehavior = "smooth") => {
      setScrollBehavior(scrollBehavior);
    },
    [setScrollBehavior]
  );

  // Track visual top (user scrolled away from latest)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      // In flex-col-reverse, the visually latest messages are near scrollTop = 0
      // Visual top is when the end sentinel would be out of view at the bottom.
      const { scrollTop, scrollHeight, clientHeight } = container;
      const isAtVisualTop = scrollTop + clientHeight >= scrollHeight - 5; // near bottom of scroll area
      setIsAtTop(isAtVisualTop);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => container.removeEventListener("scroll", handleScroll as any);
  }, [containerRef, setIsAtTop]);

  // Robust bottom detection via IntersectionObserver on the end sentinel
  useEffect(() => {
    const container = containerRef.current;
    const end = endRef.current;
    if (!container || !end) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setIsAtBottom(entry.isIntersecting);
      },
      {
        root: container,
        rootMargin: "0px 0px 0px 0px",
        threshold: 0.01,
      }
    );

    observer.observe(end);
    return () => observer.disconnect();
  }, [containerRef, endRef, setIsAtBottom]);

  return {
    containerRef,
    endRef,
    isAtTop,
    isAtBottom,
    scrollToBottom,
  };
}
