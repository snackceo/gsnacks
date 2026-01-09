import React, { useMemo, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useNinpoCore } from './hooks/useNinpoCore';

import CartDrawer from './components/CartDrawer';
import LoginView from './views/LoginView';
import DriverView from './views/DriverView';
import ManagementView from './views/ManagementView';
import PaymentSuccess from './views/PaymentSuccess';
import PaymentCancel from './views/PaymentCancel';

const BACKEND_URL =
  (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:5000';

const App: React.FC = () => {
  const core = useNinpoCore();
  const navigate = useNavigate();

  const [cartOpen, setCartOpen] = useState(false);
  const [address, setAddress] = useState('');
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);
  const [isProcessingOrder, setIsProcessingOrder] = useState(false);

  const cartQty = useMemo(
    () => core.cart.reduce((sum, i) => sum + (i.quantity || 0), 0),
    [core.cart]
  );

  const handleExternalPayment = async (type: 'STRIPE' | 'GPAY') => {
    if (!core.currentUser || isProcessingOrder) return;

    setIsProcessingOrder(true);

    try {
      // Pull scanned return UPCs from localStorage (CartDrawer writes these)
      const LS_KEY_UPCS = 'ninpo_return_upcs_v1';
      let returnUpcs: string[] = [];
      try {
        const raw = localStorage.getItem(LS_KEY_UPCS);
        const parsed = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) {
          returnUpcs = parsed.map(String).map(s => s.trim()).filter(Boolean);
        }
      } catch {
        // ignore
      }

      const depositValue = Number(core.settings?.michiganDepositValue ?? 0.1);
      const dailyCap = Number(core.settings?.dailyReturnLimit ?? 25);
      const estimatedReturnCredit = Math.min(
        returnUpcs.length * depositValue,
        dailyCap
      );

      const res = await fetch(`${BACKEND_URL}/api/payments/create-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          items: core.cart,
          userId: core.currentUser.id,
          gateway: type,
          address,
          returnUpcs,
          estimatedReturnCredit
        })
      });

      if (!res.ok) throw new Error('Payment failed');

      const { sessionUrl } = await res.json();
      core.addToast('REDIRECTING TO SECURE VAULT', 'success');
      window.location.href = sessionUrl;
    } catch (err: any) {
      core.addToast(err?.message ?? 'Payment error', 'warning');
    } finally {
      setIsProcessingOrder(false);
    }
  };

  return (
    <div className="min-h-screen bg-ninpo-black text-white">
      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        cart={core.cart}
        setCart={core.setCart}
        products={core.products}
        user={core.currentUser}
        address={address}
        setAddress={setAddress}
        acceptedPolicies={acceptedPolicies}
        setAcceptedPolicies={setAcceptedPolicies}
        onPayStripe={() => handleExternalPayment('STRIPE')}
        onPayGPay={() => handleExternalPayment('GPAY')}
        isProcessingOrder={isProcessingOrder}
      />

      {cartQty > 0 && (
        <button
          className="fixed bottom-8 right-8 bg-ninpo-lime text-black px-6 py-4 rounded-2xl font-black uppercase tracking-widest text-xs shadow-neon"
          onClick={() => setCartOpen(true)}
        >
          Cart ({cartQty})
        </button>
      )}

      <Routes>
        <Route path="/login" element={<LoginView />} />

        <Route
          path="/driver"
          element={
            core.currentUser?.role === 'OWNER' ? (
              <DriverView
                orders={core.orders}
                updateOrder={core.updateOrder}
              />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />

        <Route
          path="/management"
          element={
            core.currentUser?.role === 'OWNER' ? (
              <ManagementView
                user={core.currentUser}
                products={core.products}
                setProducts={core.setProducts}
                orders={core.orders}
                users={core.users}
                settings={core.settings}
                setSettings={core.setSettings}
                approvals={core.approvals}
                setApprovals={core.setApprovals}
                auditLogs={core.auditLogs}
                updateOrder={core.updateOrder}
                adjustCredits={core.adjustCredits}
              />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />

        <Route
          path="/success"
          element={<PaymentSuccess clearCart={core.clearCart} />}
        />
        <Route path="/cancel" element={<PaymentCancel />} />

        <Route path="/" element={<Navigate to="/management" replace />} />
        <Route path="*" element={<Navigate to="/management" replace />} />
      </Routes>
    </div>
  );
};

export default App;
