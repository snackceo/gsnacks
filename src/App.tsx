import React, { useMemo, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useNinpoCore } from './hooks/useNinpoCore';

import CartDrawer from './components/CartDrawer';
import LoginView from './views/LoginView';
import DriverView from './views/DriverView';
import ManagementView from './views/ManagementView';
import PaymentSuccess from './views/PaymentSuccess';
import PaymentCancel from './views/PaymentCancel';
import CustomerView from './views/CustomerView';

// Runtime-safe backend URL fallback:
// - If VITE_BACKEND_URL is set at build time, we use it.
// - If not set and we're on ninposnacks.com, use your Render API domain.
// - Otherwise (local dev), use localhost.
const runtimeBackendUrl = () => {
  const envUrl = (import.meta as any).env?.VITE_BACKEND_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim()) return envUrl.trim();

  if (typeof window !== 'undefined') {
    const host = window.location.hostname.toLowerCase();
    if (host === 'ninposnacks.com' || host.endsWith('.ninposnacks.com')) {
      return 'https://api.ninposnacks.com';
    }
  }

  return 'http://localhost:5000';
};

const BACKEND_URL = runtimeBackendUrl();

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

  const addToCart = (productId: string) => {
    core.setCart(prev => {
      const existing = prev.find(i => i.productId === productId);
      if (existing) {
        return prev.map(i =>
          i.productId === productId ? { ...i, quantity: (i.quantity || 0) + 1 } : i
        );
      }
      return [...prev, { productId, quantity: 1 }];
    });

    // Open cart to match typical store UX
    setCartOpen(true);
  };

  const reorderItems = (items: { productId: string; quantity: number }[]) => {
    core.setCart(Array.isArray(items) ? items : []);
    setCartOpen(true);
  };

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
          address: address,
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
        {/* STORE FRONT (PUBLIC) */}
        <Route
          path="/"
          element={
            <CustomerView
              products={core.products}
              orders={core.orders}
              currentUser={core.currentUser}
              openLogin={() => navigate('/login')}
              onRequestRefund={() => {}}
              addToCart={addToCart}
              updateUserProfile={() => {}}
              reorderItems={reorderItems}
              onRedeemPoints={() => {}}
            />
          }
        />

        {/* LOGIN (NOT FORCED) */}
        <Route
          path="/login"
          element={
            <LoginView
              onSuccess={() => {
                // After login cookie is set, restore session and go back to store
                // This avoids forcing management.
                core.restoreSession();
                navigate('/', { replace: true });
              }}
              onCancel={() => navigate('/', { replace: true })}
            />
          }
        />

        {/* PROTECTED */}
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

        {/* Catch-all goes to store */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
};

export default App;
