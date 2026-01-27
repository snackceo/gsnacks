import React, { useMemo, useState, useEffect } from 'react';
import { FileText, ChevronDown, MapPin, Phone, AlertCircle, Loader2 } from 'lucide-react';
import { BACKEND_URL } from '../../constants';
import { useNinpoCore } from '../../hooks/useNinpoCore';

interface StoreCandidate {
  name: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  phone?: string;
  storeType?: string;
  confidence?: number;
  storeId?: string;
}

interface ItemMatch {
  rawLine: string;
  nameCandidate: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  actionSuggestion: 'LINK_UPC_TO_PRODUCT' | 'CREATE_UPC' | 'CREATE_PRODUCT' | 'IGNORE';
  warnings?: string[];
  match?: {
    productId?: string;
    confidence?: number;
    reason?: string;
  };
}

interface ReceiptParseJob {
  _id: string;
  captureId: string;
  status: 'QUEUED' | 'PARSED' | 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  storeCandidate?: StoreCandidate;
  items?: ItemMatch[];
  warnings?: string[];
}

interface ManagementReceiptsProps {
  fmtTime: (iso?: string) => string;
}

type CommitMode = 'safe' | 'all' | 'selected' | 'locked';

const ManagementReceipts: React.FC<ManagementReceiptsProps> = ({ fmtTime }) => {
  const { addToast } = useNinpoCore();
  const [receipts, setReceipts] = useState<ReceiptParseJob[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ReceiptParseJob['status']>('NEEDS_REVIEW');
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptParseJob | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [storeCandidateDraft, setStoreCandidateDraft] = useState<StoreCandidate | null>(null);

  // Approval controls
  const [commitMode, setCommitMode] = useState<CommitMode>('safe');
  const [lockDurationDays, setLockDurationDays] = useState<number>(7);
  const [forceUpcOverride, setForceUpcOverride] = useState<boolean>(false);

  // Manual override used ONLY when backend demands finalStoreId
  const [finalStoreIdOverride, setFinalStoreIdOverride] = useState<string>('');

  const formatAddress = (addr?: StoreCandidate['address']): string => {
    if (!addr) return 'Unknown address';
    const parts = [addr.street, addr.city, addr.state, addr.zip].filter(Boolean);
    return parts.join(', ') || 'Unknown address';
  };

  const parseBackendError = async (resp: Response): Promise<string> => {
    // Backend frequently returns { error: "..." }
    const data = await resp.json().catch(() => null);
    const msg =
      (data && (data.error || data.message)) ||
      (await resp.text().catch(() => '')) ||
      `Request failed: ${resp.status}`;
    return typeof msg === 'string' && msg.trim() ? msg : `Request failed: ${resp.status}`;
  };

  // Fetch receipts by status (role-neutral endpoint)
  const fetchReceipts = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`${BACKEND_URL}/api/receipts?status=${statusFilter}`, {
        method: 'GET',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) {
        throw new Error(await parseBackendError(response));
      }
      const data = await response.json().catch(() => ({}));
      setReceipts(data.jobs || []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch receipts';
      setError(msg);
      addToast(msg, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReceipts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useEffect(() => {
    // reset per receipt selection
    setFinalStoreIdOverride('');
    setCommitMode('safe');
    setLockDurationDays(7);
    setForceUpcOverride(false);
  }, [selectedReceipt?._id]);

  const effectiveFinalStoreId = useMemo(() => {
    const fromDraft = storeCandidateDraft?.storeId;
    const fromJob = selectedReceipt?.storeCandidate?.storeId;
    const manual = finalStoreIdOverride.trim();
    return manual || fromDraft || fromJob || '';
  }, [finalStoreIdOverride, selectedReceipt?.storeCandidate?.storeId, storeCandidateDraft?.storeId]);

  const handleApprove = async () => {
    if (!selectedReceipt) return;

    // server requires idempotencyKey length >= 8 :contentReference[oaicite:6]{index=6}
    const idempotencyKey = `rcpt-approve-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    setIsProcessing(true);
    try {
      const payload: any = {
        mode: commitMode,
        idempotencyKey,
        forceUpcOverride: forceUpcOverride || undefined
      };

      // Only include lock duration when mode=locked
      if (commitMode === 'locked') {
        payload.lockDurationDays = lockDurationDays;
      }

      // This is the key fix: if store matching is ambiguous, backend requires finalStoreId :contentReference[oaicite:7]{index=7}
      if (effectiveFinalStoreId) {
        payload.finalStoreId = effectiveFinalStoreId;
      }

      // Optional, used by backend storeCandidate builder if provided
      // (safe to send; backend prefers body.storeCandidate if present) :contentReference[oaicite:8]{index=8}
      payload.storeCandidate = storeCandidateDraft || selectedReceipt.storeCandidate || undefined;

      const response = await fetch(`${BACKEND_URL}/api/receipts/${selectedReceipt._id}/approve`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const msg = await parseBackendError(response);

        // Special-case: tell user exactly what to do when backend demands finalStoreId
        if (msg.toLowerCase().includes('ambiguous storecandidate')) {
          addToast('Store match is ambiguous. Paste/select the correct Store ID, then approve again.', 'warning');
        }

        throw new Error(msg);
      }

      const data = await response.json().catch(() => ({}));
      if (data?.errors?.length) {
        // Backend can return partial errors array (e.g., UPC conflicts, price locks)
        addToast(`Approved with ${data.errors.length} warning(s). Open Pricing Intelligence for details.`, 'warning');
      } else {
        addToast('Receipt approved successfully', 'success');
      }

      setSelectedReceipt(null);
      setStoreCandidateDraft(null);
      await fetchReceipts();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to approve receipt';
      addToast(msg, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!selectedReceipt) return;

    setIsProcessing(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/receipts/${selectedReceipt._id}/reject`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: 'Rejected by management'
        })
      });

      if (!response.ok) {
        throw new Error(await parseBackendError(response));
      }

      addToast('Receipt rejected', 'success');
      setSelectedReceipt(null);
      setStoreCandidateDraft(null);
      await fetchReceipts();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to reject receipt';
      addToast(msg, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading && receipts.length === 0) {
    return (
      <div className="flex items-center justify-center p-20">
        <Loader2 className="w-6 h-6 animate-spin text-ninpo-lime" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-black uppercase text-white tracking-widest">Receipt Reviews</h2>

      {/* Status filters */}
      <div className="flex flex-wrap gap-3">
        {(['NEEDS_REVIEW', 'PARSED', 'APPROVED', 'REJECTED'] as ReceiptParseJob['status'][]).map(status => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-all ${
              statusFilter === status
                ? 'bg-ninpo-lime text-ninpo-black border-ninpo-lime'
                : 'bg-white/5 text-white border-white/10 hover:bg-white/10'
            }`}
          >
            {status.toLowerCase()}
          </button>
        ))}
      </div>

      {error && (
        <div className="p-4 bg-red-900/30 border border-red-500/30 rounded-2xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-200">{error}</p>
        </div>
      )}

      {/* Receipt list */}
      {receipts.length === 0 ? (
        <div className="p-20 bg-ninpo-card rounded-[3rem] border border-dashed border-white/10 flex flex-col items-center justify-center text-center">
          <FileText className="w-12 h-12 text-slate-800 mb-4" />
          <p className="text-[10px] uppercase font-black text-slate-700 tracking-[0.4em]">No receipts found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {receipts.map(receipt => (
            <button
              key={receipt._id}
              onClick={() => {
                setSelectedReceipt(receipt);
                setStoreCandidateDraft(receipt.storeCandidate || null);
              }}
              className={`w-full text-left p-5 rounded-[2.5rem] border transition-all ${
                selectedReceipt?._id === receipt._id
                  ? 'bg-ninpo-lime/20 border-ninpo-lime text-white'
                  : 'bg-ninpo-card border-white/5 text-white hover:border-white/10'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="font-bold text-sm">{receipt.storeCandidate?.name || 'Unknown Store'}</p>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {receipt.items?.length || 0} items • {fmtTime(receipt.createdAt)}
                  </p>
                  {receipt.warnings && receipt.warnings.length > 0 && (
                    <p className="text-[10px] text-yellow-400 mt-1">⚠️ {receipt.warnings.length} issue(s)</p>
                  )}
                </div>
                <ChevronDown className={`w-5 h-5 transition-transform ${selectedReceipt?._id === receipt._id ? 'rotate-180' : ''}`} />
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Detail panel */}
      {selectedReceipt && (
        <div className="p-6 bg-ninpo-card border border-white/10 rounded-[2.5rem] space-y-6">
          <div>
            <h3 className="text-lg font-black uppercase text-white tracking-widest mb-4">Receipt Details</h3>

            {/* Store candidate */}
            {storeCandidateDraft && (
              <div className="mb-6 p-4 bg-black/40 rounded-2xl border border-white/5 space-y-3">
                <div className="flex items-start justify-between">
                  <p className="font-bold text-white">{storeCandidateDraft.name}</p>
                  <span className="text-[10px] bg-ninpo-lime text-ninpo-black px-3 py-1 rounded-full font-bold">
                    Store Candidate ({Math.round((storeCandidateDraft.confidence || 0) * 100)}%)
                  </span>
                </div>

                {storeCandidateDraft.address && (
                  <div className="flex items-start gap-2 text-sm text-slate-300">
                    <MapPin className="w-4 h-4 shrink-0 mt-0.5" />
                    <p>{formatAddress(storeCandidateDraft.address)}</p>
                  </div>
                )}

                {storeCandidateDraft.phone && (
                  <div className="flex items-start gap-2 text-sm text-slate-300">
                    <Phone className="w-4 h-4 shrink-0 mt-0.5" />
                    <p>{storeCandidateDraft.phone}</p>
                  </div>
                )}

                {/* This is the critical “don’t break” enhancement:
                    if backend requires finalStoreId, you can paste it here and re-approve. */}
                <div className="pt-2 border-t border-white/10">
                  <p className="text-[10px] uppercase font-black tracking-widest text-slate-400 mb-2">
                    Final Store ID (only needed if approval says “ambiguous store”)
                  </p>
                  <input
                    value={finalStoreIdOverride}
                    onChange={e => setFinalStoreIdOverride(e.target.value)}
                    placeholder="paste storeId here (Mongo ObjectId)"
                    className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white text-sm outline-none focus:border-white/20"
                  />
                  {effectiveFinalStoreId ? (
                    <p className="text-[10px] text-slate-500 mt-2">
                      Using finalStoreId: <span className="text-slate-300">{effectiveFinalStoreId}</span>
                    </p>
                  ) : null}
                </div>
              </div>
            )}

            {/* Approval controls */}
            <div className="p-4 bg-black/30 rounded-2xl border border-white/5 space-y-3">
              <p className="text-[10px] uppercase font-black tracking-widest text-slate-400">Approval Mode</p>

              <div className="flex flex-wrap gap-2">
                {(['safe', 'all', 'selected', 'locked'] as CommitMode[]).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setCommitMode(mode)}
                    className={`px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                      commitMode === mode
                        ? 'bg-ninpo-lime text-ninpo-black border-ninpo-lime'
                        : 'bg-white/5 text-white border-white/10 hover:bg-white/10'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>

              {commitMode === 'locked' && (
                <div className="flex items-center gap-3">
                  <p className="text-xs text-slate-300">Lock days</p>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={lockDurationDays}
                    onChange={e => setLockDurationDays(Number(e.target.value || 7))}
                    className="w-24 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm"
                  />
                </div>
              )}

              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={forceUpcOverride}
                  onChange={e => setForceUpcOverride(e.target.checked)}
                />
                Force UPC override (only if you intentionally want to overwrite UPC→product conflicts)
              </label>
            </div>

            {/* Line items */}
            <div className="space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Line Items ({selectedReceipt.items?.length || 0})
              </p>

              {selectedReceipt.items?.map((item, idx) => (
                <div key={idx} className="p-4 bg-black/40 rounded-2xl border border-white/5 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <p className="font-bold text-white text-sm">{item.rawLine}</p>
                      {item.nameCandidate && item.nameCandidate !== item.rawLine && (
                        <p className="text-[10px] text-slate-400 mt-1">Normalized: {item.nameCandidate}</p>
                      )}
                    </div>
                    {item.match?.confidence && (
                      <span className="text-[10px] bg-green-900/40 text-green-300 px-2 py-1 rounded font-bold">
                        {Math.round(item.match.confidence * 100)}%
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-[10px]">
                    <div>
                      <p className="text-slate-500">Qty</p>
                      <p className="font-bold text-white">{item.quantity}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Unit Price</p>
                      <p className="font-bold text-white">${item.unitPrice.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Total</p>
                      <p className="font-bold text-white">${item.lineTotal.toFixed(2)}</p>
                    </div>
                  </div>

                  {item.warnings && item.warnings.length > 0 && (
                    <div className="text-[10px] text-yellow-300 mt-2">
                      {item.warnings.map((w, i) => (
                        <p key={i}>⚠️ {w}</p>
                      ))}
                    </div>
                  )}
                  {item.match?.reason && (
                    <p className="text-[10px] text-slate-400 mt-2">Match: {item.match.reason}</p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-white/10">
            <button
              onClick={handleApprove}
              disabled={isProcessing}
              className="flex-1 px-6 py-3 bg-ninpo-lime text-ninpo-black font-bold rounded-2xl text-sm hover:bg-ninpo-lime/80 disabled:opacity-50 transition-all"
            >
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> : null}
              Approve
            </button>

            <button
              onClick={handleReject}
              disabled={isProcessing}
              className="flex-1 px-6 py-3 bg-red-600 text-white font-bold rounded-2xl text-sm hover:bg-red-700 disabled:opacity-50 transition-all"
            >
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> : null}
              Reject
            </button>

            <button
              onClick={() => setSelectedReceipt(null)}
              className="px-6 py-3 bg-white/5 text-white font-bold rounded-2xl text-sm hover:bg-white/10 transition-all"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManagementReceipts;
