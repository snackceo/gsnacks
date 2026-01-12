
import React, { useState } from 'react';
import { Shield, Info, X, ScrollText, Fingerprint, Gavel } from 'lucide-react';

const LegalFooter: React.FC = () => {
  const [modalType, setModalType] = useState<
    'tos' | 'privacy' | 'deposit' | 'model' | null
  >(null);

  const Modal = ({ title, content, icon: Icon, onClose }: { title: string, content: React.ReactNode, icon: any, onClose: () => void }) => (
    <div className="fixed inset-0 z-[210] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-ninpo-black/95 backdrop-blur-xl" onClick={onClose} />
      <div 
        className="relative bg-ninpo-midnight w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-[3rem] p-10 border border-white/10 shadow-2xl animate-in zoom-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-10 border-b border-white/5 pb-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-ninpo-lime/10 rounded-xl flex items-center justify-center border border-ninpo-lime/20">
              <Icon className="w-6 h-6 text-ninpo-lime" />
            </div>
            <h2 className="text-2xl font-black uppercase tracking-tighter text-white">{title}</h2>
          </div>
          <button onClick={onClose} className="p-3 bg-white/5 rounded-2xl hover:bg-white/10 transition-all text-slate-400"><X className="w-6 h-6" /></button>
        </div>
        <div className="text-slate-400 text-xs font-bold leading-relaxed uppercase tracking-tight space-y-4">
          {content}
        </div>
        <div className="mt-12 pt-8 border-t border-white/5">
          <button onClick={onClose} className="w-full py-5 bg-ninpo-lime text-ninpo-black rounded-2xl text-[10px] font-black uppercase tracking-widest hover:scale-[1.02] transition-all shadow-xl">Close</button>
        </div>
      </div>
    </div>
  );

  return (
    <footer className="bg-ninpo-black/50 border-t border-white/5 py-16">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-16">
          <div className="space-y-6">
            <h4 className="text-[11px] font-black text-ninpo-lime uppercase tracking-widest">Compliance</h4>
            <p className="text-[10px] font-bold text-slate-500 leading-relaxed uppercase tracking-tight">
              Ninpo Snacks operates in accordance with the Michigan Beverage Container Deposit Law and all local health codes.
            </p>
          </div>
          <div className="space-y-4 lg:col-span-2">
            <h4 className="text-[11px] font-black text-white uppercase tracking-widest">Legal</h4>
            <div className="flex flex-wrap gap-6">
              <button
                onClick={() => setModalType('model')}
                className="flex items-center gap-2 text-[10px] font-black text-slate-400 hover:text-ninpo-lime uppercase tracking-widest transition-colors"
              >
                <Info className="w-4 h-4" /> Business Model
              </button>
              <button onClick={() => setModalType('tos')} className="flex items-center gap-2 text-[10px] font-black text-slate-400 hover:text-ninpo-lime uppercase tracking-widest transition-colors">
                <ScrollText className="w-4 h-4" /> Terms of Service
              </button>
              <button onClick={() => setModalType('privacy')} className="flex items-center gap-2 text-[10px] font-black text-slate-400 hover:text-ninpo-lime uppercase tracking-widest transition-colors">
                <Fingerprint className="w-4 h-4" /> Privacy Policy
              </button>
              <button onClick={() => setModalType('deposit')} className="flex items-center gap-2 text-[10px] font-black text-slate-400 hover:text-ninpo-lime uppercase tracking-widest transition-colors">
                <Gavel className="w-4 h-4" /> Refund Policy
              </button>
            </div>
          </div>
          <div className="flex flex-col justify-between items-start md:items-end">
             <div className="flex items-center gap-3 px-6 py-3 bg-ninpo-midnight rounded-2xl border border-white/5 shadow-xl">
                <Shield className="w-4 h-4 text-ninpo-lime" />
                <span className="text-[9px] font-black text-white uppercase tracking-widest">Verified Delivery</span>
             </div>
             <p className="text-[10px] font-black text-slate-700 uppercase mt-8 md:mt-0 tracking-widest">DETROIT AREA HUB</p>
          </div>
        </div>
      </div>

      {modalType === 'deposit' && (
        <Modal 
          title="Refund Policy" 
          icon={Gavel}
          onClose={() => setModalType(null)}
          content={
            <>
              <p>
                Bottle returns must be empty, clean, and labeled for Michigan’s 10¢ deposit.
              </p>
              <p>Return value is verified at delivery.</p>
              <p>AI tools may assist verification but do not make final decisions.</p>
            </>
          }
        />
      )}
      {modalType === 'model' && (
        <Modal
          title="Business & Operations Model"
          icon={Info}
          onClose={() => setModalType(null)}
          content={
            <div className="space-y-8">
              <section className="space-y-4">
                <h3 className="text-white text-sm font-black uppercase tracking-widest">
                  What NinpoSnacks Is
                </h3>
                <p>
                  NinpoSnacks is a mobile-first local snack delivery business that blends
                  on-demand snack sales, local driver delivery, and bottle/can return
                  collection. Verified returns create value that can reduce today&apos;s
                  cost, become credits, or be paid in cash.
                </p>
                <p>
                  It operates like a human-assisted reverse vending system integrated directly
                  into the shopping and delivery experience.
                </p>
              </section>

              <section className="space-y-4">
                <h3 className="text-white text-sm font-black uppercase tracking-widest">
                  What Customers Are Actually Buying
                </h3>
                <ul className="list-disc list-inside space-y-2">
                  <li>Convenience through delivery.</li>
                  <li>Flexibility with cash or credits for returns.</li>
                  <li>Lower net cost over time through return incentives.</li>
                  <li>A repeat loop: buy → return → save → buy again.</li>
                </ul>
              </section>

              <section className="space-y-4">
                <h3 className="text-white text-sm font-black uppercase tracking-widest">
                  Core Business Loop
                </h3>
                <ol className="list-decimal list-inside space-y-2">
                  <li>Customer orders and sees delivery fee and estimated return value.</li>
                  <li>Payment is authorized (not finalized) for later adjustments.</li>
                  <li>Driver delivers snacks and collects eligible empty containers.</li>
                  <li>Verified containers create value (e.g., 10¢ each).</li>
                  <li>Customer chooses payout: apply to purchase, store as credits, or cash.</li>
                  <li>Incentives reduce or waive service fees when credits are used.</li>
                  <li>Final amount is captured and order is closed.</li>
                </ol>
              </section>

              <section className="space-y-4">
                <h3 className="text-white text-sm font-black uppercase tracking-widest">
                  Roles
                </h3>
                <ul className="list-disc list-inside space-y-2">
                  <li>
                    <span className="text-white">Customers:</span> order snacks, return containers,
                    and choose payout method.
                  </li>
                  <li>
                    <span className="text-white">Drivers:</span> verify returns, capture proof,
                    and complete delivery workflows.
                  </li>
                  <li>
                    <span className="text-white">Owner/Admin:</span> manage inventory, pricing,
                    disputes, and policy enforcement.
                  </li>
                </ul>
              </section>

              <section className="space-y-4">
                <h3 className="text-white text-sm font-black uppercase tracking-widest">
                  Return System Rules
                </h3>
                <ul className="list-disc list-inside space-y-2">
                  <li>Eligible containers must have Michigan 10¢ deposit labeling.</li>
                  <li>Containers must be empty, clean, and verified by drivers.</li>
                  <li>Duplicate counting is blocked with scan throttling and audit logs.</li>
                </ul>
              </section>

              <section className="space-y-4">
                <h3 className="text-white text-sm font-black uppercase tracking-widest">
                  Cash, Credits, or Purchase Offsets
                </h3>
                <p>
                  Cash payouts are allowed but verified and logged. Credits and purchase offsets
                  are incentivized to reduce cash handling, limit fraud, and encourage repeat
                  purchases.
                </p>
              </section>

              <section className="space-y-4">
                <h3 className="text-white text-sm font-black uppercase tracking-widest">
                  Payments & Incentives
                </h3>
                <ul className="list-disc list-inside space-y-2">
                  <li>Authorize first, capture after delivery and verification.</li>
                  <li>Service fees may be reduced or waived when credits are used.</li>
                </ul>
              </section>

              <section className="space-y-4">
                <h3 className="text-white text-sm font-black uppercase tracking-widest">
                  AI Support (Not Authority)
                </h3>
                <p>
                  AI can analyze images and flag issues, but it does not decide eligibility or
                  trigger payments. Drivers and admins make final calls.
                </p>
              </section>

              <section className="space-y-4">
                <h3 className="text-white text-sm font-black uppercase tracking-widest">
                  Security & Auditability
                </h3>
                <p>
                  Every critical action is logged: orders, returns, credits, cash payouts, and
                  admin overrides. This supports disputes, compliance, and fraud review.
                </p>
              </section>

              <section className="space-y-4">
                <h3 className="text-white text-sm font-black uppercase tracking-widest">
                  The Mental Model
                </h3>
                <p>
                  NinpoSnacks is a snack delivery business that turns bottle returns into
                  purchasing power.
                </p>
              </section>
            </div>
          }
        />
      )}
      {modalType === 'tos' && (
        <Modal 
          title="Terms of Service" 
          icon={ScrollText}
          onClose={() => setModalType(null)} 
          content={
            <>
              <p>By using Ninpo Snacks, you agree to provide an accurate delivery address and follow our terms.</p>
              <p>Our drivers may refuse bottle returns that do not meet cleanliness standards.</p>
            </>
          } 
        />
      )}
      {modalType === 'privacy' && (
        <Modal 
          title="Privacy Policy" 
          icon={Fingerprint}
          onClose={() => setModalType(null)} 
          content={
            <>
              <p>Operational data, including bottle scans, is used only for verification and is deleted shortly after.</p>
              <p>Your order history is encrypted and we do not sell your personal data to third parties.</p>
            </>
          } 
        />
      )}
    </footer>
  );
};

export default LegalFooter;
