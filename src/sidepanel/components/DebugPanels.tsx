import { WorkerRuntimeState, AnalysisStatus } from '../../../shared/types';

const formatDebugTimestamp = (value: number | null) =>
  value === null ? 'null' : `${Math.max(0, Math.floor(value))}`;

const formatDebugDeadline = (value: number | null) =>
  value === null ? 'null' : new Date(value).toLocaleTimeString();

export const DebugStatusPanel = ({
  runtimeState,
  analysisStatus,
}: {
  runtimeState: WorkerRuntimeState;
  analysisStatus: AnalysisStatus;
}) => (
  <div className="debug-panel">
    <div className="debug-panel-title">Debug Status</div>
    <div className="debug-grid">
      <span>videoId</span><span>{runtimeState.currentVideo?.videoId ?? 'null'}</span>
      <span>title</span><span>{runtimeState.currentVideo?.title ?? 'null'}</span>
      <span>lifecycle</span><span>{runtimeState.lifecycle}</span>
      <span>analysisStatus</span><span>{analysisStatus}</span>
      <span>debugStage</span><span>{runtimeState.debugStage}</span>
      <span>debug.source</span><span>{runtimeState.transcriptDebug?.source ?? 'null'}</span>
      <span>debug.reason</span><span>{runtimeState.transcriptDebug?.reason ?? 'null'}</span>
      <span>debug.attemptCount</span><span>{runtimeState.transcriptDebug?.attemptCount ?? 0}</span>
      <span>transcript chunks</span><span>{runtimeState.transcriptChunkCount}</span>
      <span>pending batch</span><span>{runtimeState.pendingTranscriptBufferSummary.present ? 'yes' : 'no'}</span>
      <span>batch received/total</span><span>{runtimeState.pendingTranscriptBufferSummary.receivedCount} / {runtimeState.pendingTranscriptBufferSummary.totalCount}</span>
      <span>deadline</span><span>{formatDebugDeadline(runtimeState.transcriptLoadDeadlineAt)}</span>
      <span>playback currentTime</span><span>{formatDebugTimestamp(runtimeState.playbackState?.currentTime ?? null)}</span>
      <span>lastScannedTimestamp</span><span>{formatDebugTimestamp(runtimeState.lastScannedTimestamp)}</span>
      <span>chunksScanned</span><span>{runtimeState.chunksScanned}</span>
      <span>msg starts</span><span>{runtimeState.transcriptMessageStats.startsSeen}</span>
      <span>msg appends</span><span>{runtimeState.transcriptMessageStats.appendsSeen}</span>
      <span>msg loaded</span><span>{runtimeState.transcriptMessageStats.loadedSeen}</span>
      <span>msg failed</span><span>{runtimeState.transcriptMessageStats.failedSeen}</span>
    </div>
  </div>
);

export const VerificationMetricsPanel = ({ runtimeState }: { runtimeState: WorkerRuntimeState }) => {
  const metrics = runtimeState.debugMetrics;
  const resolutionEntries = Object.entries(metrics.resolutionPathCounts)
    .sort((left, right) => right[1] - left[1]);

  return (
    <div className="debug-panel">
      <div className="debug-panel-title">Verification Metrics</div>
      <div className="debug-grid">
        <span>batches sent</span><span>{metrics.batchesSent}</span>
        <span>items enqueued</span><span>{metrics.itemsEnqueued}</span>
        <span>verify started</span><span>{metrics.verifyStarted}</span>
        <span>verify succeeded</span><span>{metrics.verifySucceeded}</span>
        <span>downgraded UV</span><span>{metrics.verifyDowngradedUnverifiable}</span>
        <span>conflicts surfaced</span><span>{metrics.verifyConflictSurfaced}</span>
        <span>cards appended</span><span>{metrics.cardsAppended}</span>
        <span>cluster suppressions</span><span>{metrics.clusterSuppressions}</span>
        <span>final visible cards</span><span>{metrics.finalVisibleCards}</span>
      </div>
      {resolutionEntries.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <div className="debug-panel-title">Resolution Paths</div>
          {resolutionEntries.map(([path, count]) => (
            <div key={path} className="debug-line">
              <span className="debug-line-accent">{path}</span>
              <span className="debug-line-state">{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const EventTimeline = ({ runtimeState }: { runtimeState: WorkerRuntimeState }) => {
  const events = runtimeState.eventLog.slice(-20);
  if (events.length === 0) return null;

  return (
    <div className="debug-panel">
      <div className="debug-panel-title">Event Timeline</div>
      <div className="space-y-1.5">
        {events.map((event: any, i: number) => (
          <div key={i} className="debug-line">
            <span className="debug-line-time">{new Date(event.at).toLocaleTimeString()}</span>
            <span className="debug-line-accent">{event.type}</span>
            <span className="debug-line-state">{event.lifecycle}</span>
            {event.summary && <span className="debug-line-copy">{event.summary}</span>}
          </div>
        ))}
      </div>
    </div>
  );
};

export const TranscriptFetchLogPanel = ({ runtimeState }: { runtimeState: WorkerRuntimeState }) => {
  const entries = runtimeState.transcriptFetchLog.slice(-15);
  if (entries.length === 0) return null;

  return (
    <div className="debug-panel">
      <div className="debug-panel-title">Transcript Fetch Log</div>
      <div className="space-y-1.5">
        {entries.map((entry: any, i: number) => (
          <div key={`${entry.at}-${i}`} className="debug-log-entry">
            <div className="flex flex-wrap gap-x-2 gap-y-1">
              <span className="debug-line-time">{new Date(entry.at).toLocaleTimeString()}</span>
              <span className="debug-line-accent">{entry.source}</span>
              <span className="debug-line-state">{entry.step}</span>
            </div>
            <div className="debug-line-copy mt-1">
              {entry.message}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
