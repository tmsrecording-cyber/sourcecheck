import type { AnalysisStatus } from '../../../shared/types';

interface ResolveDisplayAnalysisStatusInput {
  previousStatus: AnalysisStatus;
  nextStatus: AnalysisStatus;
  sourceCardCount: number;
  pendingClaimCount: number;
  transcriptChunkCount: number;
}

export const resolveDisplayAnalysisStatus = ({
  previousStatus,
  nextStatus,
  sourceCardCount,
  pendingClaimCount,
  transcriptChunkCount,
}: ResolveDisplayAnalysisStatusInput): AnalysisStatus => {
  const shouldHoldUnavailableState =
    previousStatus === 'no-transcript' &&
    nextStatus === 'loading' &&
    sourceCardCount === 0 &&
    pendingClaimCount === 0 &&
    transcriptChunkCount === 0;

  return shouldHoldUnavailableState ? previousStatus : nextStatus;
};
