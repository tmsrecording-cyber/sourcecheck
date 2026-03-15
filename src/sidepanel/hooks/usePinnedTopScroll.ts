import { useCallback, useLayoutEffect, useRef, useState } from 'react';

interface PinnedTopScrollOptions {
  pinThreshold?: number;
}

export const usePinnedTopScroll = <T extends HTMLElement>(
  syncKey: string,
  { pinThreshold = 24 }: PinnedTopScrollOptions = {},
) => {
  const scrollRef = useRef<T | null>(null);
  const isPinnedRef = useRef(true);
  const [isPinned, setIsPinned] = useState(true);
  const metricsRef = useRef({
    scrollHeight: 0,
    scrollTop: 0,
  });

  const handleScroll = useCallback(() => {
    const element = scrollRef.current;

    if (!element) return;

    const nextIsPinned = element.scrollTop <= pinThreshold;

    isPinnedRef.current = nextIsPinned;
    setIsPinned((current) => (current === nextIsPinned ? current : nextIsPinned));
    metricsRef.current.scrollTop = element.scrollTop;
    metricsRef.current.scrollHeight = element.scrollHeight;
  }, [pinThreshold]);

  const pinToTop = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const element = scrollRef.current;

    if (!element) return;

    element.scrollTo({
      top: 0,
      behavior,
    });
    isPinnedRef.current = true;
    setIsPinned(true);
    metricsRef.current = {
      scrollHeight: element.scrollHeight,
      scrollTop: 0,
    };
  }, []);

  useLayoutEffect(() => {
    const element = scrollRef.current;

    if (!element) return;

    const previousMetrics = metricsRef.current;
    const nextHeight = element.scrollHeight;

    if (isPinnedRef.current || previousMetrics.scrollHeight === 0) {
      element.scrollTop = 0;
    } else {
      const heightDelta = nextHeight - previousMetrics.scrollHeight;

      if (heightDelta !== 0) {
        element.scrollTop = previousMetrics.scrollTop + heightDelta;
      }
    }

    metricsRef.current = {
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    };
  }, [syncKey, pinThreshold]);

  return {
    isPinned,
    scrollRef,
    handleScroll,
    pinToTop,
  };
};
