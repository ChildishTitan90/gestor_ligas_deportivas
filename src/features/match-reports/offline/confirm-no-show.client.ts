import { ReportClientError, reportUuid } from '../report-client';
import { proposedNoShowScore } from '../no-show';
import { updateLocalReport, type LocalReport } from './store.client';
import type { ReportDemoData } from '../types';

/** Guarda la intención antes de enviarla. El mismo identificador sobrevive a
 * recargas y al acuse perdido; nunca se crea una segunda intención por pestaña. */
export async function confirmPreparedNoShow(actorId: string, matchId: string, notify: (value: LocalReport) => void) {
  if (!navigator.onLine) throw new ReportClientError('NO_SHOW_CONNECTION_REQUIRED', 409);
  return navigator.locks.request(`report-sync:${actorId}:${matchId}`, { ifAvailable: true }, async lock => {
    if (!lock) throw new ReportClientError('PARTICIPATION_RETRY_REQUIRED', 409);
    let local = await updateLocalReport(actorId, matchId, record => {
      if (record.noShowConfirmation) return record;
      if (record.pending.length || record.revision > record.acknowledgedRevision || record.data.match.status.code !== 'NO_SHOW' || record.data.report.status !== 'DRAFT' || !record.data.report.noShow || record.data.report.noShow.absent === 'BOTH') throw new ReportClientError('NO_SHOW_STATE_INVALID', 409);
      return { ...record, noShowConfirmation: { operationId: reportUuid(), matchId, reportId: record.data.report.id, expectedMatchVersion: record.data.match.version, expectedReportVersion: record.data.report.version } };
    });
    notify(local);
    const intent = local.noShowConfirmation!;
    if (intent.receipt) return local;
    const { receipt: _receipt, ...body } = intent;
    void _receipt;
    const response = await fetch(`/api/match-reports/${matchId}/confirm-no-show`, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Expected-Actor-Id': actorId }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    const receipt = await response.json();
    if (!response.ok) throw new ReportClientError(receipt.code ?? 'OPERATION_UNAVAILABLE', response.status);
    if (receipt.matchId !== matchId || receipt.reportId !== intent.reportId || receipt.matchVersion !== intent.expectedMatchVersion + 1 || receipt.reportVersion !== intent.expectedReportVersion + 1 || typeof receipt.replayed !== 'boolean') throw Error('INVALID_RECEIPT');
    const referenceResponse = await fetch(`/api/match-reports/${matchId}`, { cache: 'no-store', headers: { 'X-Expected-Actor-Id': actorId }, signal: AbortSignal.timeout(20000) });
    if (!referenceResponse.ok) throw new ReportClientError('REFERENCE_UNAVAILABLE', referenceResponse.status);
    const reference = await referenceResponse.json() as ReportDemoData;
    const expectedScore = local.data.report.noShow && proposedNoShowScore(local.data.report.noShow);
    if (reference.match.id !== matchId || reference.report.id !== intent.reportId || reference.match.version !== receipt.matchVersion || reference.report.version !== receipt.reportVersion || reference.match.status.code !== 'FINISHED' || reference.report.status !== 'CONFIRMED' || !reference.report.confirmedAt || !expectedScore || reference.report.score.home !== expectedScore.home || reference.report.score.away !== expectedScore.away) throw Error('INVALID_RECEIPT');
    local = await updateLocalReport(actorId, matchId, current => {
      if (current.noShowConfirmation?.operationId !== intent.operationId || current.data.match.version !== intent.expectedMatchVersion || current.data.report.version !== intent.expectedReportVersion || current.pending.length) throw Error('LOCAL_REVISION_CONFLICT');
      return { ...current, noShowConfirmation: { ...intent, receipt }, serverMatchStatus: 'FINISHED', data: { ...current.data,
        match: { ...current.data.match, version: receipt.matchVersion, status: reference.match.status },
        report: { ...current.data.report, version: receipt.reportVersion, status: 'CONFIRMED', confirmedAt: reference.report.confirmedAt, score: reference.report.score },
      } };
    });
    notify(local);
    return local;
  });
}
