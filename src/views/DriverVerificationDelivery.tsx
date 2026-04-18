import React from 'react';
import { Order, ScannerMode } from '../types';
import { AlertTriangle, HelpCircle, Loader } from 'lucide-react';

interface DriverVerificationDeliveryProps {
    activeOrder: Order;
    driverNotice: { tone: 'success' | 'error' | 'info'; message: string; } | null;
    setDriverNotice: (notice: { tone: 'success' | 'error' | 'info'; message: string; } | null) => void;
    workflowMode: 'verification' | 'delivery';
    setScannerMode: (mode: ScannerMode) => void;
    setScannerOpen: (open: boolean) => void;
    scannerError: string | null;
    isCapturing: boolean;
    captureError: string | null;
    issueStatus: 'idle' | 'loading' | 'error';
    issueExplanation: string | null;
    explainCaptureIssue: () => void;
    onCapturePayment: () => void;
}

const DriverVerificationDelivery: React.FC<DriverVerificationDeliveryProps> = ({
    activeOrder,
    driverNotice,
    setDriverNotice,
    workflowMode,
    setScannerMode,
    setScannerOpen,
    scannerError,
    isCapturing,
    captureError,
    issueStatus,
    issueExplanation,
    explainCaptureIssue,
    onCapturePayment,
}) => {
    return (
        <div className="space-y-6">
            <h3 className="text-white font-black uppercase text-xs tracking-widest">
                Container Verification
            </h3>

            <div className="bg-ninpo-card border border-white/5 rounded-[2.5rem] p-8 space-y-6">
                <p className="text-white font-black">Order ID: {activeOrder.id}</p>

                {/* Payment Capture Section */}
                <div className="space-y-4">
                    <button
                        onClick={onCapturePayment}
                        disabled={isCapturing}
                        className="w-full py-4 bg-ninpo-lime text-ninpo-black rounded-xl text-sm font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-white transition-all disabled:opacity-50"
                    >
                        {isCapturing ? (
                            <>
                                <Loader className="animate-spin w-5 h-5" />
                                Capturing...
                            </>
                        ) : (
                            'Capture Payment'
                        )}
                    </button>

                    {captureError && (
                        <div className="rounded-2xl bg-ninpo-red/10 border border-ninpo-red/30 px-4 py-3 text-sm text-ninpo-red space-y-3">
                            <div className="flex items-center gap-3">
                                <AlertTriangle className="w-5 h-5" />
                                <div>
                                    <p className="font-bold">Payment Capture Failed</p>
                                    <p className="text-xs">{captureError}</p>
                                </div>
                            </div>

                            <button
                                onClick={explainCaptureIssue}
                                disabled={issueStatus === 'loading'}
                                className="w-full py-2 bg-blue-500/20 text-white rounded-lg text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-blue-500/30 transition-all disabled:opacity-50"
                            >
                                {issueStatus === 'loading' ? (
                                    <>
                                        <Loader className="animate-spin w-4 h-4" />
                                        Getting Help...
                                    </>
                                ) : (
                                    <>
                                        <HelpCircle className="w-4 h-4" />
                                        Ask AI for Help
                                    </>
                                )}
                            </button>
                        </div>
                    )}

                    {issueStatus === 'loading' && (
                        <div className="flex items-center justify-center gap-2 text-slate-400 text-sm">
                            <Loader className="animate-spin w-5 h-5" />
                            <span>Analyzing issue...</span>
                        </div>
                    )}

                    {issueStatus === 'error' && (
                         <div className="rounded-xl bg-ninpo-red/10 p-4">
                            <p className="text-ninpo-red text-sm font-bold">
                                Error explaining issue.
                            </p>
                            <p className="text-slate-300 text-xs mt-1">
                                {issueExplanation || 'An unknown error occurred while trying to get help.'}
                            </p>
                        </div>
                    )}

                    {issueStatus === 'idle' && issueExplanation && (
                        <div className="rounded-xl bg-blue-500/10 p-4">
                            <p className="text-blue-400 text-sm font-bold">
                                AI Assistant Suggestion
                            </p>
                            <p className="text-slate-300 text-xs mt-1 whitespace-pre-wrap">
                                {issueExplanation}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DriverVerificationDelivery;
