import { useState, useRef, useCallback, useEffect } from 'react';
import type { PendingSidepanelNotice, SidepanelNotice } from '../utils/notices';

const NOTICE_AUTO_DISMISS_MS = 3600;
const MAX_NOTICES = 3;

export const useNoticeQueue = () => {
  const [notices, setNotices] = useState<SidepanelNotice[]>([]);
  const noticeTimersRef = useRef<Map<string, number>>(new Map());

  useEffect(() => () => {
    noticeTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    noticeTimersRef.current.clear();
  }, []);

  const dismissNotice = useCallback((id: string) => {
    const timerId = noticeTimersRef.current.get(id);
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      noticeTimersRef.current.delete(id);
    }
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  const enqueueNotice = useCallback((notice: PendingSidepanelNotice) => {
    setNotices((current) => {
      const next: SidepanelNotice = { ...notice, id: notice.dedupeKey };
      const withoutDuplicate = current.filter((entry) => entry.id !== notice.dedupeKey);
      return [next, ...withoutDuplicate].slice(0, MAX_NOTICES);
    });

    const existingTimerId = noticeTimersRef.current.get(notice.dedupeKey);
    if (existingTimerId !== undefined) {
      window.clearTimeout(existingTimerId);
    }

    const timerId = window.setTimeout(() => {
      dismissNotice(notice.dedupeKey);
    }, NOTICE_AUTO_DISMISS_MS);

    noticeTimersRef.current.set(notice.dedupeKey, timerId);
  }, [dismissNotice]);

  return { notices, enqueueNotice, dismissNotice };
};
