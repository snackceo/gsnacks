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

  const PublicHome = () => {
    return (
      <div className="min-h-screen w-full flex items-center justify-center px-6">
        <div className="w-full max-w-xl text-center space-y-6">
          <div className="text-3xl font-black uppercase tracking-widest text-white">
            Ninpo Snacks
          </div>
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            Select where you want to go
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-6">
            <button
              onClick={() => navigate('/login')}
              className="py-5 rounded-2xl bg-ninpo-lime text-ninpo-black text-[10px] font-black uppercase tracking-widest shadow-neon"
            >
              Login
            </button>

            <button
              onClick={() => {
                if (core.currentUser?.role === 'OWNER') navigate('/management');
                else navigate('/login');
              }}
              className="py-5 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest border border-white/10 hover:bg-white/15 transition"
            >
              Management
            </button>
          </div>

          {core.currentUser && (
            <div className="pt-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
              Logged in as: {core.currentUser.username}
            </div>
          )}
        </div>
      </div>
    );
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
        {/* Public home: no forced redirect to /management */}
        <Route path="/" element={<PublicHome />} />

        {/* Login: now correctly wired with required handlers */}
        <Route
          path="/login"
          element={
            <LoginView
              onSuccess={() => {
                // After login cookie is set, route to management.
                // Hard reload ensures any core auth/bootstrap logic re-runs cleanly.
                navigate('/management', { replace: true });
                window.location.reload();
              }}
              onCancel={() => navigate('/', { replace: true })}
            />
          }
        />

        <Route
          path="/driver"
          element={
            core.currentUser?.role === 'OWNER' ? (
              <DriverView orders={core.orders} updateOrder={core.updateOrder} />
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

        <Route path="/success" element={<PaymentSuccess clearCart={core.clearCart} />} />
        <Route path="/cancel" element={<PaymentCancel />} />

        {/* Catch-all: go home (NOT management) so you don't get forced to login */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
};

export default App;
