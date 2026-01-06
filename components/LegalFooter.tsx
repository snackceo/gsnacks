
import React, { useState } from 'react';
import { Shield, Scale, Info, X } from 'lucide-react';

const LegalFooter: React.FC = () => {
  const [modalType, setModalType] = useState<'tos' | 'privacy' | 'deposit' | null>(null);

  const Modal = ({ title, content, onClose }: { title: string, content: React.ReactNode, onClose: () => void }) => (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={onClose} />
      <div className="relative bg-white w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-[3rem] p-12 shadow-2xl animate-in zoom-in">
        <div className="flex justify-between items-center mb-10 border-b pb-8">
          <h2 className="text-3xl font-black uppercase tracking-tighter text-slate-900">{title}</h2>
          <button onClick={onClose} className="p-3 bg-slate-100 rounded-2xl hover:bg-slate-200 transition-all"><X className="w-6 h-6" /></button>
        </div>
        <div className="prose prose-slate max-w-none text-sm font-bold text-slate-600 leading-relaxed uppercase tracking-tight">
          {content}
        </div>
        <div className="mt-12 pt-8 border-t">
          <button onClick={onClose} className="w-full py-5 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-lime-500 hover:text-slate-900 transition-all">I Understand & Agree</button>
        </div>
      </div>
    </div>
  );

  return (
    <footer className="bg-white border-t border-slate-100 py-16">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-16">
          <div className="space-y-6">
            <h4 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.3em]">Compliance Disclosure</h4>
            <p className="text-[10px] font-bold text-slate-400 leading-relaxed uppercase tracking-tight">
              Ninpo Logistics operates in strict accordance with the Michigan Beverage Container Deposit Law of 1976. All beverage containers are subject to a $0.10 deposit.
            </p>
          </div>
          <div className="space-y-6">
            <h4 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.3em]">Service Area</h4>
            <p className="text-[10px] font-bold text-slate-400 leading-relaxed uppercase tracking-tight">
              On-demand logistics active in Detroit Sector 7. Operations hours: 06:00 - 23:59 EST.
            </p>
          </div>
          <div className="space-y-4">
            <h4 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.3em]">Legal Framework</h4>
            <div className="flex flex-col gap-3">
              <button onClick={() => setModalType('tos')} className="text-[10px] font-black text-slate-400 hover:text-lime-600 uppercase tracking-widest text-left transition-colors">Logistics Agreement</button>
              <button onClick={() => setModalType('privacy')} className="text-[10px] font-black text-slate-400 hover:text-lime-600 uppercase tracking-widest text-left transition-colors">Data Privacy Charter</button>
              <button onClick={() => setModalType('deposit')} className="text-[10px] font-black text-slate-400 hover:text-lime-600 uppercase tracking-widest text-left transition-colors">MI Deposit Policy</button>
            </div>
          </div>
          <div className="flex flex-col justify-between items-start md:items-end">
             <div className="flex items-center gap-3 px-6 py-3 bg-slate-900 rounded-2xl">
                <Shield className="w-4 h-4 text-lime-500" />
                <span className="text-[9px] font-black text-white uppercase tracking-[0.2em]">Verified Logistics Node</span>
             </div>
             <p className="text-[10px] font-black text-slate-300 uppercase mt-8 md:mt-0 tracking-[0.4em]">© 2025 Ninpo Logistics Group</p>
          </div>
        </div>
      </div>

      {modalType === 'deposit' && (
        <Modal 
          title="Michigan Deposit Compliance" 
          onClose={() => setModalType(null)}
          content={
            <div className="space-y-6">
              <p>Under Act 142 of 1976, Ninpo Snacks collects and processes beverage container deposits for all eligible items sold on this platform.</p>
              <ul className="list-disc pl-5 space-y-4">
                <li>Deposit Value: A mandatory $0.10 surcharge is applied to all carbonated soft drinks, beer, and carbonated mineral water.</li>
                <li>Daily Return Limit: Per state regulations, we do not accept more than $25.00 worth of returns from a single individual in a 24-hour period.</li>
                <li>Refund Method: All deposit refunds are credited to your Ninpo Digital Wallet immediately upon AI verification of the container.</li>
              </ul>
            </div>
          }
        />
      )}

      {modalType === 'tos' && (
        <Modal 
          title="Logistics Agreement" 
          onClose={() => setModalType(null)}
          content={
            <div className="space-y-6">
              <p>This Logistics Service Agreement ("Agreement") governs your use of the Ninpo Snacks on-demand delivery platform.</p>
              <p>1. Delivery: Ninpo Snacks utilizes a hybrid fleet of independent agents. Delivery times are estimates and subject to regional traffic and logistical constraints.</p>
              <p>2. Liability: Ninpo Snacks is not liable for indirect, incidental, or consequential damages arising from the delivery of snacks or the return of bottles.</p>
              <p>3. Glass Handling: Glass containers are subject to a 5% handling surcharge to account for specialized protective packaging and logistical hazard management.</p>
            </div>
          }
        />
      )}

      {modalType === 'privacy' && (
        <Modal 
          title="Data Privacy Charter" 
          onClose={() => setModalType(null)}
          content={
            <div className="space-y-6">
              <p>Ninpo Logistics Group prioritizes your operational privacy.</p>
              <p>Camera Usage: We request camera access solely for the "Bottle Scan" functionality. Images are processed locally and by our secure AI service to verify container eligibility. We do not store biometric data of the user.</p>
              <p>Geolocation: Real-time tracking of orders utilizes GPS coordinates to optimize fleet routing. Location data is anonymized 30 days after order completion.</p>
            </div>
          }
        />
      )}
    </footer>
  );
};

export default LegalFooter;
