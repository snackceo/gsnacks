import React from 'react';
import { ApprovalRequest, AuditLog, AuditLogType } from '../../types';
import ManagementApprovals from './ManagementApprovals';
import ManagementAuditLogs from './ManagementAuditLogs';

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
