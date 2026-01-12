
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
                  Overview
                </h3>
                <p>
                  NinpoSnacks is a mobile-first snack delivery service in Detroit that pairs
                  on-demand delivery with a container return program. Customers order snacks,
                  hand off eligible empties at delivery, and receive credits or (for eligible tiers)
                  cash based on Michigan&apos;s 10¢ deposit system.
                </p>
                <p>
                  The result is a single trip that delivers snacks and picks up returns, creating
                  a repeat loop of buy → return → save.
                </p>
              </section>

              <section className="space-y-4">
                <h3 className="text-white text-sm font-black uppercase tracking-widest">
                  Ordering & Delivery Flow
                </h3>
                <ol className="list-decimal list-inside space-y-2">
                  <li>Customers place an order and indicate if they have returnables.</li>
                  <li>Payment is processed online; tips can be added at checkout.</li>
                  <li>Drivers deliver snacks and collect return-eligible containers.</li>
                  <li>
                    Drivers scan UPCs, verify condition, capture photo/GPS proof, and prevent
                    duplicate counts.
                  </li>
                  <li>
                    Credits are posted after verification; eligible customers may receive cash
                    at drop-off (subject to limits).
                  </li>
                </ol>
              </section>

              <section className="space-y-4">
                <h3 className="text-white text-sm font-black uppercase tracking-widest">
                  Return Credits & Fees
                </h3>
                <ul className="list-disc list-inside space-y-2">
                  <li>Eligible containers earn $0.10 each under Michigan deposit rules.</li>
                  <li>Service fee: $0.02 per container; glass adds an extra $0.02.</li>
                  <li>Net credit: $0.08 (plastic/aluminum) or $0.06 (glass).</li>
                  <li>Credits never expire and are shown transparently on receipts.</li>
                  <li>
                    Cash payouts are available for Gold+ tiers only, capped at $25/day
                    (250 containers).
                  </li>
                </ul>
              </section>

              <section className="space-y-4">
                <h3 className="text-white text-sm font-black uppercase tracking-widest">
                  Customer Tier System
                </h3>
                <ul className="list-disc list-inside space-y-2">
                  <li>
                    <span className="text-white">Common:</span> credits apply to products only; no
                    delivery discount.
                  </li>
                  <li>
                    <span className="text-white">Bronze:</span> 10% delivery fee discount; credits
                    apply to products only.
                  </li>
                  <li>
                    <span className="text-white">Silver:</span> 20% delivery fee discount; credits
                    can cover products and delivery fees.
                  </li>
                  <li>
                    <span className="text-white">Gold:</span> 30% delivery fee discount; credits
                    apply to all charges; cash payouts available with ID verification.
                  </li>
                  <li>
                    <span className="text-white">Secret Platinum:</span> invitation-only VIP tier
                    with Gold benefits plus exclusive perks.
                  </li>
                </ul>
              </section>

              <section className="space-y-4">
                <h3 className="text-white text-sm font-black uppercase tracking-widest">
                  Return Limits & Fraud Prevention
                </h3>
                <ul className="list-disc list-inside space-y-2">
                  <li>Daily cap: 250 containers per customer (per Michigan law).</li>
                  <li>No splitting returns across multiple addresses to bypass the limit.</li>
                  <li>Tier verification (phone/ID) reduces fake or duplicate accounts.</li>
                  <li>Monitoring flags unusual return activity for review.</li>
                </ul>
              </section>

              <section className="space-y-4">
                <h3 className="text-white text-sm font-black uppercase tracking-widest">
                  Delivery Verification & Service
                </h3>
                <ul className="list-disc list-inside space-y-2">
                  <li>Drivers scan barcodes, confirm condition, and log counts at drop-off.</li>
                  <li>Photo proof and GPS verification support transparency and dispute review.</li>
                  <li>Non-eligible or damaged containers are declined on the spot.</li>
                  <li>Post-delivery tipping is available via driver QR code.</li>
                </ul>
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
