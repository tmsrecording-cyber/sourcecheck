// Single source of truth: re-export everything from the canonical shared types.
// All backend code importing @/types/shared gets the same types as the extension,
// so any addition to shared/types.ts (like ExtractionActionState variants) is
// automatically visible here without manual sync.
export * from '../../../shared/types';
