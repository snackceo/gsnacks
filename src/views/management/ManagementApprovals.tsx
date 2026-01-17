import React from 'react';
import { ApprovalRequest } from '../../types';
import { ShieldCheck } from 'lucide-react';

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

export default ManagementApprovals;
