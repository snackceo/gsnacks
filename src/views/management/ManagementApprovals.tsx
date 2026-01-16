import React from 'react';
import { ApprovalRequest } from '../../types';

interface ManagementApprovalsProps {
  approvals: ApprovalRequest[];
  approvalFilter: ApprovalRequest['status'];
  setApprovalFilter: (status: ApprovalRequest['status']) => void;
  filteredApprovals: ApprovalRequest[];
  handleApprove: (approval: ApprovalRequest) => void;
  handleReject: (id: string) => void;
  selectedApproval: ApprovalRequest | null;
  setSelectedApproval: (approval: ApprovalRequest | null) => void;
  previewPhoto: string | null;
  setPreviewPhoto: (photo: string | null) => void;
}

const ManagementApprovals: React.FC<ManagementApprovalsProps> = ({
  approvals,
  approvalFilter,
  setApprovalFilter,
  filteredApprovals,
  handleApprove,
  handleReject,
  selectedApproval,
  setSelectedApproval,
  previewPhoto,
  setPreviewPhoto
}) => {
  return (
    <div className="space-y-6">
      {/* ...existing approvals JSX from ManagementView.tsx... */}
    </div>
  );
};

export default ManagementApprovals;
