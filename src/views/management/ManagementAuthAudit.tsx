import React from 'react';
import { BrainCircuit, Loader2, ShieldCheck } from 'lucide-react';

import { ApprovalRequest, AuditLog, AuditLogType } from '../../types';

interface ManagementAuthAuditProps {
  // Approvals (Auth Hub)
  approvalFilter: ApprovalRequest['status'];
  setApprovalFilter: (status: ApprovalRequest['status']) => void;
  filteredApprovals: ApprovalRequest[];
  handleApprove: (approval: ApprovalRequest) => void;
  handleReject: (id: string) => void;
  setSelectedApproval: (approval: ApprovalRequest | null) => void;
  setPreviewPhoto: (photo: string | null) => void;
  fmtTime: (iso?: string) => string;

  // Audit Logs
  filteredAuditLogs: AuditLog[];
  auditTypeFilter: 'ALL' | AuditLogType;
  setAuditTypeFilter: (type: 'ALL' | AuditLogType) => void;
  auditActorFilter: string;
  setAuditActorFilter: (actor: string) => void;
  auditRangeFilter: '24h' | '7d' | '30d';
  setAuditRangeFilter: (range: '24h' | '7d' | '30d') => void;
  auditTypeOptions: (string | AuditLogType)[];
  isAuditLogsLoading: boolean;
  auditLogsError: string | null;
  handleDownloadAuditCsv: () => void;
  runAuditSummary: () => void;
  auditSummary: string | null;
  isAuditSummaryLoading: boolean;
}

interface ManagementApprovalsProps {
  approvalFilter: ApprovalRequest['status'];
  setApprovalFilter: (status: ApprovalRequest['status']) => void;
  filteredApprovals: ApprovalRequest[];
  handleApprove: (approval: ApprovalRequest) => void;
  handleReject: (id: string) => void;
  setSelectedApproval: (approval: ApprovalRequest | null) => void;
  setPreviewPhoto: (photo: string | null) => void;
  fmtTime: (iso?: string) => string;
}

const ManagementApprovals: React.FC<ManagementApprovalsProps> = ({
  approvalFilter,
  setApprovalFilter,
  filteredApprovals,
  handleApprove,
  handleReject,
  setSelectedApproval,
  setPreviewPhoto,
  fmtTime
}) => {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-black uppercase text-white tracking-widest">
        Auth Hub Reviews
      </h2>

      <div className="space-y-4">
        <div className="flex flex-wrap gap-3">
          {(['PENDING', 'APPROVED', 'REJECTED'] as ApprovalRequest['status'][]).map(
            status => (
              <button
                key={status}
                onClick={() => setApprovalFilter(status)}
                className={`px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                  approvalFilter === status
                    ? 'bg-white text-ninpo-black border-white'
                    : 'bg-white/5 text-white border-white/10 hover:bg-white/10'
                }`}
              >
                {status.toLowerCase()}
              </button>
            )
          )}
        </div>

        {filteredApprovals.length === 0 ? (
          <div className="p-20 bg-ninpo-card rounded-[3rem] border border-dashed border-white/10 flex flex-col items-center justify-center text-center">
            <ShieldCheck className="w-12 h-12 text-slate-800 mb-4" />
            <p className="text-[10px] uppercase font-black text-slate-700 tracking-[0.4em]">
              Queue Cleared
            </p>
          </div>
        ) : (
          filteredApprovals.map(a => (
            <div
              key={a.id}
              className="bg-ninpo-card p-6 rounded-[2.5rem] border border-white/5 space-y-4 transition-all hover:border-white/10 cursor-pointer"
              onClick={() => setSelectedApproval(a)}
            >
              <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                <div className="flex items-center gap-6">
                  {a.photoProof && (
                    <div
                      className="relative group cursor-pointer"
                      onClick={event => {
                        event.stopPropagation();
                        setPreviewPhoto(a.photoProof!);
                      }}
                    >
                      <img
                        src={a.photoProof}
                        alt="Proof"
                        className="w-24 h-24 rounded-2xl object-cover border border-white/10"
                      />
                    </div>
                  )}

                  <div>
                    <p className="text-white font-black uppercase tracking-widest text-[11px]">
                      {a.type}
                    </p>
                    <p className="text-[10px] text-slate-500 font-bold uppercase mt-1 tracking-widest">
                      USER: {a.userId} • AMOUNT: ${a.amount.toFixed(2)}
                    </p>
                    <p className="text-[10px] text-slate-500 font-bold uppercase mt-1 tracking-widest">
                      ORDER: {a.orderId || 'N/A'} • REQUESTED: {fmtTime(a.createdAt)}
                    </p>
                    <p className="text-[10px] text-slate-500 font-bold uppercase mt-1 tracking-widest">
                      REASON: {a.reason || '—'}
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={event => {
                      event.stopPropagation();
                      handleApprove(a);
                    }}
                    className="px-6 py-3 rounded-2xl bg-ninpo-lime text-ninpo-black text-[10px] font-black uppercase tracking-widest"
                  >
                    Approve
                  </button>
                  <button
                    onClick={event => {
                      event.stopPropagation();
                      handleReject(a.id);
                    }}
                    className="px-6 py-3 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

interface ManagementAuditLogsProps {
  filteredAuditLogs: AuditLog[];
  auditTypeFilter: 'ALL' | AuditLogType;
  setAuditTypeFilter: (type: 'ALL' | AuditLogType) => void;
  auditActorFilter: string;
  setAuditActorFilter: (actor: string) => void;
  auditRangeFilter: '24h' | '7d' | '30d';
  setAuditRangeFilter: (range: '24h' | '7d' | '30d') => void;
  auditTypeOptions: (string | AuditLogType)[];
  isAuditLogsLoading: boolean;
  auditLogsError: string | null;
  handleDownloadAuditCsv: () => void;
  runAuditSummary: () => void;
  auditSummary: string | null;
  isAuditSummaryLoading: boolean;
  fmtTime: (iso?: string) => string;
}

const ManagementAuditLogs: React.FC<ManagementAuditLogsProps> = ({
  filteredAuditLogs,
  auditTypeFilter,
  setAuditTypeFilter,
  auditActorFilter,
  setAuditActorFilter,
  auditRangeFilter,
  setAuditRangeFilter,
  auditTypeOptions,
  isAuditLogsLoading,
  auditLogsError,
  handleDownloadAuditCsv,
  runAuditSummary,
  auditSummary,
  isAuditSummaryLoading,
  fmtTime
}) => {
  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-xl font-black uppercase text-white tracking-widest">
            Audit Logs
          </h2>
          <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-2">
            type • actorId • details • createdAt
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={runAuditSummary}
            disabled={filteredAuditLogs.length === 0 || isAuditSummaryLoading}
            className="px-7 py-4 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest text-white hover:bg-white/10 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-3"
          >
            {isAuditSummaryLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <BrainCircuit className="w-5 h-5" />
            )}
            Get AI Summary
          </button>
          <button
            onClick={handleDownloadAuditCsv}
            disabled={filteredAuditLogs.length === 0}
            className="px-7 py-4 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest text-white hover:bg-white/10 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Download CSV
          </button>
        </div>
      </div>

      {(isAuditSummaryLoading || auditSummary) && (
        <div className="bg-ninpo-card p-6 rounded-[2.5rem] border border-white/5 space-y-4">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            AI Summary
          </h3>
          {isAuditSummaryLoading ? (
            <div className="flex items-center gap-3 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Generating summary...</span>
            </div>
          ) : (
            <div className="text-sm text-slate-200 whitespace-pre-wrap font-mono">
              {auditSummary}
            </div>
          )}
        </div>
      )}

      <div className="bg-ninpo-card p-6 rounded-[2.5rem] border border-white/5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              Type
            </label>
            <select
              className="w-full bg-black/40 border border-white/10 rounded-2xl px-4 py-3 text-[11px] text-white"
              value={auditTypeFilter}
              onChange={e => setAuditTypeFilter(e.target.value as 'ALL' | AuditLogType)}
            >
              {auditTypeOptions.map(option => (
                <option key={option} value={option}>
                  {option.toLowerCase()}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              Actor
            </label>
            <input
              id="auditActorFilter"
              name="auditActorFilter"
              className="w-full bg-black/40 border border-white/10 rounded-2xl px-4 py-3 text-[11px] text-white"
              placeholder="Filter by actorId"
              value={auditActorFilter}
              onChange={e => setAuditActorFilter(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              Time Range
            </label>
            <div className="flex flex-wrap gap-2">
              {(['24h', '7d', '30d'] as const).map(range => (
                <button
                  key={range}
                  onClick={() => setAuditRangeFilter(range)}
                  className={`px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                    auditRangeFilter === range
                      ? 'bg-white text-ninpo-black border-white'
                      : 'bg-white/5 text-white border-white/10 hover:bg-white/10'
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-ninpo-card rounded-[2.5rem] border border-white/5 overflow-hidden">
        <div className="grid grid-cols-4 gap-4 px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-600 border-b border-white/5">
          <span>Type</span>
          <span>Actor</span>
          <span>Details</span>
          <span>Created</span>
        </div>

        {isAuditLogsLoading ? (
          <div className="p-16 text-center text-[10px] uppercase tracking-widest text-slate-600">
            Loading audit logs...
          </div>
        ) : auditLogsError ? (
          <div className="p-6 text-center text-[10px] uppercase tracking-widest text-ninpo-red">
            {auditLogsError}
          </div>
        ) : filteredAuditLogs.length === 0 ? (
          <div className="p-16 text-center text-[10px] uppercase tracking-widest text-slate-600">
            No audit logs match your filters.
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {filteredAuditLogs.map(log => (
              <div
                key={log.id}
                className="grid grid-cols-1 md:grid-cols-4 gap-3 px-6 py-4 text-[11px] text-slate-300"
              >
                <span className="font-bold text-white/80">{log.type}</span>
                <span className="text-white/70">{log.actorId}</span>
                <span className="text-slate-400">{log.details}</span>
                <span className="text-slate-500">
                  {typeof fmtTime === 'function'
                    ? fmtTime(log.createdAt)
                    : String(log.createdAt ?? '')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const ManagementAuthAudit: React.FC<ManagementAuthAuditProps> = ({
  approvalFilter,
  setApprovalFilter,
  filteredApprovals,
  handleApprove,
  handleReject,
  setSelectedApproval,
  setPreviewPhoto,
  fmtTime,
  filteredAuditLogs,
  auditTypeFilter,
  setAuditTypeFilter,
  auditActorFilter,
  setAuditActorFilter,
  auditRangeFilter,
  setAuditRangeFilter,
  auditTypeOptions,
  isAuditLogsLoading,
  auditLogsError,
  handleDownloadAuditCsv,
  runAuditSummary,
  auditSummary,
  isAuditSummaryLoading
}) => {
  return (
    <div className="space-y-6">
      <ManagementApprovals
        approvalFilter={approvalFilter}
        setApprovalFilter={setApprovalFilter}
        filteredApprovals={filteredApprovals}
        handleApprove={handleApprove}
        handleReject={handleReject}
        setSelectedApproval={setSelectedApproval}
        setPreviewPhoto={setPreviewPhoto}
        fmtTime={fmtTime}
      />

      <ManagementAuditLogs
        auditTypeFilter={auditTypeFilter}
        setAuditTypeFilter={setAuditTypeFilter}
        auditActorFilter={auditActorFilter}
        setAuditActorFilter={setAuditActorFilter}
        auditRangeFilter={auditRangeFilter}
        setAuditRangeFilter={setAuditRangeFilter}
        auditTypeOptions={auditTypeOptions}
        isAuditLogsLoading={isAuditLogsLoading}
        auditLogsError={auditLogsError}
        filteredAuditLogs={filteredAuditLogs}
        handleDownloadAuditCsv={handleDownloadAuditCsv}
        runAuditSummary={runAuditSummary}
        auditSummary={auditSummary}
        isAuditSummaryLoading={isAuditSummaryLoading}
      />
    </div>
  );
};

export default ManagementAuthAudit;
