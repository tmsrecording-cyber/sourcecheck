import { useRef, useLayoutEffect } from 'react';

/**
 * Returns a ref that always holds the latest value of `value`.
 * Use this to read current state/props inside event listeners and async
 * callbacks without stale-closure bugs.
 */
export const useLiveRef = <T,>(value: T) => {
  const ref = useRef(value);

  useLayoutEffect(() => {
    ref.current = value;
  }, [value]);

  return ref;
};
