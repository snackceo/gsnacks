import React, { useMemo, useState } from 'react';
import {
  Shield,
  Info,
  X,
  ScrollText,
  Fingerprint,
  Gavel,
  Users,
  LifeBuoy,
  ReceiptText
} from 'lucide-react';

/**
 * LegalFooter
 * - Displays: Terms, Privacy, Returns, Refunds, Bottle Return Program, Support, About
 * - IMPORTANT: UI-only. Enforcement must happen server-side.
 *
 * Replace SUPPORT_* placeholders before launch.
 * Consider hosting full legal pages and linking to them here.
 */
const LegalFooter: React.FC = () => {
  const [modalType, setModalType] = useState<
    | 'tos'
    | 'privacy'
    | 'returns'
    | 'refunds'
    | 'deposit'
    | 'support'
    | 'model'
    | 'about'
    | null
  >(null);

  const SUPPORT_EMAIL = 'support@ninposnacks.com';
  const SUPPORT_PHONE = '(000) 000-0000';
  const SUPPORT_HOURS = 'Daily 10am–10pm (Detroit time)';

  const policyVersion = '2026-01-15';
  const lastUpdated = useMemo(() => policyVersion, []);

  const Modal = ({
    title,
    content,
    icon: Icon,
    onClose
  }: {
    title: string;
    content: React.ReactNode;
    icon: any;
    onClose: () => void;
  }) => (
    <div className="fixed inset-0 z-[210] flex items-center justify-center p-6">
      <div
        className="absolute inset-0 bg-ninpo-black/95 backdrop-blur-xl"
        onClick={onClose}
      />
      <div
        className="relative bg-ninpo-midnight w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-[3rem] p-10 border border-white/10 shadow-2xl animate-in zoom-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-10 border-b border-white/5 pb-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-ninpo-lime/10 rounded-xl flex items-center justify-center border border-ninpo-lime/20">
              <Icon className="w-6 h-6 text-ninpo-lime" />
            </div>
            <div>
              <h2 className="text-2xl font-black uppercase tracking-tighter text-white">
                {title}
              </h2>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-600 mt-2">
                Version {lastUpdated}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-3 bg-white/5 rounded-2xl hover:bg-white/10 transition-all text-slate-400"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="text-slate-400 text-xs font-bold leading-relaxed uppercase tracking-tight space-y-4">
          {content}
        </div>

        <div className="mt-12 pt-8 border-t border-white/5">
          <button
            onClick={onClose}
            className="w-full py-5 bg-ninpo-lime text-ninpo-black rounded-2xl text-[10px] font-black uppercase tracking-widest hover:scale-[1.02] transition-all shadow-xl"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <footer className="bg-ninpo-black/50 border-t border-white/5 py-16">
      <div className="max-w-[1600px] mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-12 mb-16">
          <div className="space-y-6">
            <h4 className="text-[11px] font-black text-ninpo-lime uppercase tracking-widest">
              Compliance
            </h4>
            <p className="text-[10px] font-bold text-slate-500 leading-relaxed uppercase tracking-tight">
              Ninpo Snacks operates in accordance with applicable beverage container deposit rules
              and local health guidance. See policies for details.
            </p>
          </div>

          <div className="space-y-6 lg:col-span-2">
            <h4 className="text-[11px] font-black text-white uppercase tracking-widest">
              Legal
            </h4>
            <div className="flex flex-wrap gap-6">
              <button
                onClick={() => setModalType('model')}
                className="flex items-center gap-2 text-[10px] font-black text-slate-400 hover:text-ninpo-lime uppercase tracking-widest transition-colors"
              >
                <Info className="w-4 h-4" /> Business Model
              </button>

              <button
                onClick={() => setModalType('tos')}
                className="flex items-center gap-2 text-[10px] font-black text-slate-400 hover:text-ninpo-lime uppercase tracking-widest transition-colors"
              >
                <ScrollText className="w-4 h-4" /> Terms of Service
              </button>

              <button
                onClick={() => setModalType('privacy')}
                className="flex items-center gap-2 text-[10px] font-black text-slate-400 hover:text-ninpo-lime uppercase tracking-widest transition-colors"
              >
                <Fingerprint className="w-4 h-4" /> Privacy Policy
              </button>

              <button
                onClick={() => setModalType('returns')}
                className="flex items-center gap-2 text-[10px] font-black text-slate-400 hover:text-ninpo-lime uppercase tracking-widest transition-colors"
              >
                <ReceiptText className="w-4 h-4" /> Return Policy
              </button>

              <button
                onClick={() => setModalType('refunds')}
                className="flex items-center gap-2 text-[10px] font-black text-slate-400 hover:text-ninpo-lime uppercase tracking-widest transition-colors"
              >
                <Gavel className="w-4 h-4" /> Refund Policy
              </button>

              <button
                onClick={() => setModalType('deposit')}
                className="flex items-center gap-2 text-[10px] font-black text-slate-400 hover:text-ninpo-lime uppercase tracking-widest transition-colors"
              >
                <Gavel className="w-4 h-4" /> Bottle Return Program
              </button>

              <button
                onClick={() => setModalType('support')}
                className="flex items-center gap-2 text-[10px] font-black text-slate-400 hover:text-ninpo-lime uppercase tracking-widest transition-colors"
              >
                <LifeBuoy className="w-4 h-4" /> Support
              </button>

              <button
                onClick={() => setModalType('about')}
                className="flex items-center gap-2 text-[10px] font-black text-slate-400 hover:text-ninpo-lime uppercase tracking-widest transition-colors"
              >
                <Users className="w-4 h-4" /> About Us
              </button>
            </div>

            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">
              Summaries are for convenience. Before launch, host full legal pages and link them
              here.
            </p>
          </div>

          <div className="space-y-6">
            <h4 className="text-[11px] font-black text-white uppercase tracking-widest">
              Support
            </h4>
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                Email: <span className="text-slate-300">{SUPPORT_EMAIL}</span>
              </p>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                Phone: <span className="text-slate-300">{SUPPORT_PHONE}</span>
              </p>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                Hours: <span className="text-slate-300">{SUPPORT_HOURS}</span>
              </p>
            </div>
          </div>

          <div className="flex flex-col justify-between items-start md:items-end">
            <div className="flex items-center gap-3 px-6 py-3 bg-ninpo-midnight rounded-2xl border border-white/5 shadow-xl">
              <Shield className="w-4 h-4 text-ninpo-lime" />
              <span className="text-[9px] font-black text-white uppercase tracking-widest">
                Verified Delivery
              </span>
            </div>
            <p className="text-[10px] font-black text-slate-700 uppercase mt-8 md:mt-0 tracking-widest">
              DETROIT AREA HUB
            </p>
          </div>
        </div>
      </div>

      {modalType === 'returns' && (
        <Modal
          title="Return Policy"
          icon={ReceiptText}
          onClose={() => setModalType(null)}
          content={
            <>
              <p>
                Snack products are generally non-returnable once delivered due to food safety. If
                an item is incorrect, missing, or damaged, report it the same day for review.
              </p>
              <p>
                If the driver cannot safely complete delivery (invalid address, no safe drop-off,
                customer unavailable), the order can be canceled and handled under the Refund
                Policy.
              </p>
              <p>
                Bottle/container returns are handled under the Bottle Return Program and are
                verified at delivery.
              </p>
            </>
          }
        />
      )}

      {modalType === 'refunds' && (
        <Modal
          title="Refund Policy"
          icon={Gavel}
          onClose={() => setModalType(null)}
          content={
            <>
              <p>
                Refunds are issued when Ninpo Snacks fails to deliver the ordered items, or when
                an item is confirmed missing/incorrect/damaged. Refunds may be provided as store
                credit or to the original payment method depending on the case.
              </p>
              <p>
                Route and distance fees are service fees. If delivery is completed successfully,
                these fees are not refundable. If the order is canceled before dispatch, fees may
                be waived.
              </p>
              <p>
                Disputes are reviewed using order logs, driver verification, and timestamped
                delivery confirmation where available.
              </p>
            </>
          }
        />
      )}

      {modalType === 'deposit' && (
        <Modal
          title="Bottle Return Program"
          icon={Gavel}
          onClose={() => setModalType(null)}
          content={
            <>
              <p>
                Returnables must be empty, clean, intact, and clearly marked as eligible. Drivers
                verify eligibility at drop-off using UPC scan + visual condition check. Non-eligible
                or damaged containers can be declined at the door.
              </p>
              <p>
                Verified containers earn $0.10 each where applicable. Credit settlement preserves
                the full deposit value. Cash settlement (Gold+ only) can apply cash handling fees
                and material surcharges depending on program settings.
              </p>
              <p>
                Return value posts after verification. A receipt may show counts, eligibility,
                adjustments, and totals. AI tools can assist classification but do not make final
                decisions.
              </p>
            </>
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
              <p>
                By using Ninpo Snacks, you agree to provide accurate delivery details and follow
                driver instructions for safe delivery.
              </p>
              <p>
                We reserve the right to refuse service in cases of fraud, abuse, unsafe delivery
                conditions, or repeated policy violations.
              </p>
              <p>
                Bottle returns are optional and are verified at delivery. Return value is posted
                after verification and is subject to eligibility rules.
              </p>
              <p>
                This summary does not replace the full Terms. Before launch, host complete Terms
                on a dedicated page and link it here.
              </p>
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
              <p>
                We use operational data (orders, scans, delivery verification) to operate the
                service and prevent fraud. We do not sell personal data.
              </p>
              <p>
                Verification artifacts (photos, scan logs) are retained only as long as needed for
                operational review and dispute handling.
              </p>
              <p>
                Before launch, publish a full Privacy Policy describing retention windows, user
                rights, and contact methods.
              </p>
            </>
          }
        />
      )}

      {modalType === 'support' && (
        <Modal
          title="Support"
          icon={LifeBuoy}
          onClose={() => setModalType(null)}
          content={
            <>
              <p>For help with orders, returns, or account issues, contact support:</p>
              <p>
                Email: <span className="text-white">{SUPPORT_EMAIL}</span>
              </p>
              <p>
                Phone: <span className="text-white">{SUPPORT_PHONE}</span>
              </p>
              <p>
                Hours: <span className="text-white">{SUPPORT_HOURS}</span>
              </p>
              <p>
                Include your order ID if available. If you’re reporting a missing/incorrect item,
                report it the same day.
              </p>
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
                  Ninpo Snacks is a delivery-first snack business paired with an optional container
                  return program. Customers order snacks, hand off eligible empties at delivery,
                  and receive credits (or, for eligible tiers, cash) based on verified UPCs.
                </p>
              </section>

              <section className="space-y-4">
                <h3 className="text-white text-sm font-black uppercase tracking-widest">
                  Verification
                </h3>
                <ul className="list-disc list-inside space-y-2">
                  <li>Eligibility is determined by UPC registry + labeling + condition check.</li>
                  <li>Duplicate scans are prevented; adjustments are logged.</li>
                  <li>AI output is advisory; drivers and ops make final decisions.</li>
                </ul>
              </section>

              <section className="space-y-4">
                <h3 className="text-white text-sm font-black uppercase tracking-widest">
                  Payments
                </h3>
                <ul className="list-disc list-inside space-y-2">
                  <li>Stripe authorizes at checkout and captures after verification.</li>
                  <li>Credits can reduce totals subject to membership rules.</li>
                </ul>
              </section>
            </div>
          }
        />
      )}

      {modalType === 'about' && (
        <Modal
          title="About Us"
          icon={Users}
          onClose={() => setModalType(null)}
          content={
            <div className="space-y-4">
              <p>
                Ninpo Snacks is a Detroit-area service focused on fast delivery and a cleaner
                return loop. One trip delivers snacks and collects eligible empties.
              </p>
              <p>
                Our mission is to provide a reliable service that reduces waste while improving
                convenience.
              </p>
            </div>
          }
        />
      )}
    </footer>
  );
};

export default LegalFooter;
