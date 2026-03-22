import { useRef, useEffect, useCallback, startTransition } from 'react';
import { ASK_INPUT_ID } from '../components/AskBox';
import { useLiveRef } from './useLiveRef';
import { shouldHandleAskShortcut } from '../utils/askShortcut';

interface AskFocusShortcutOptions {
  activeTab: 'live' | 'history';
  setActiveTab: (tab: 'live' | 'history') => void;
  canFocusAsk: boolean;
  showSettings: boolean;
}

export const useAskFocusShortcut = ({
  activeTab,
  setActiveTab,
  canFocusAsk,
  showSettings,
}: AskFocusShortcutOptions) => {
  const pendingAskFocusRef = useRef(false);
  const activeTabRef = useLiveRef(activeTab);
  const canFocusAskRef = useLiveRef(canFocusAsk);
  const showSettingsRef = useLiveRef(showSettings);

  const focusAskInput = useCallback(() => {
    if (typeof document === 'undefined') return false;
    const input = document.getElementById(ASK_INPUT_ID);
    if (!(input instanceof HTMLInputElement) || input.disabled) return false;
    input.focus();
    const caretPosition = input.value.length;
    input.setSelectionRange?.(caretPosition, caretPosition);
    return document.activeElement === input;
  }, []);

  // Apply pending focus once the tab/context conditions become satisfied
  useEffect(() => {
    if (!pendingAskFocusRef.current || showSettings || activeTab !== 'live' || !canFocusAsk) {
      return;
    }

    const timerId = window.setTimeout(() => {
      if (focusAskInput()) {
        pendingAskFocusRef.current = false;
      }
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [activeTab, canFocusAsk, focusAskInput, showSettings]);

  // Global keyboard shortcut to focus the ask input
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (
        !shouldHandleAskShortcut({
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          defaultPrevented: event.defaultPrevented,
          target: event.target,
          hasContext: canFocusAskRef.current,
          showSettings: showSettingsRef.current,
        })
      ) {
        return;
      }

      event.preventDefault();
      pendingAskFocusRef.current = true;

      if (activeTabRef.current !== 'live') {
        startTransition(() => {
          setActiveTab('live');
        });
        return;
      }

      if (focusAskInput()) {
        pendingAskFocusRef.current = false;
      }
    };

    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, [focusAskInput, setActiveTab]);
};
