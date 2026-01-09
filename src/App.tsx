import { useMemo, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';

import { useNinpoCore } from './hooks/useNinpoCore';
import { UserRole } from './types';

import CustomerView from './views/CustomerView';
import ManagementView from './views/ManagementView';
import DriverView from './views/DriverView';
import LoginView from './views/LoginView';
import PaymentSuccess from './views/PaymentSuccess';
import PaymentCancel from './views/PaymentCancel';

import Header from './components/Header';
import CartDrawer from './components/CartDrawer';
import LegalFooter from './components/LegalFooter';
import BackendStatusBanner from './components/BackendStatusBanner';
import ToastStack from './components/ToastStack';

import { ShoppingBag } from 'lucide-react';

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

function App() {
  const core = useNinpoCore();
  const navigate = useNavigate();

  const [address, setAddress] = useState('');
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);

  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isProcessingOrder, setIsProcessingOrder] = useState(false);

  // Total quantity across all cart lines (badge)
  const cartCount = useMemo(
    () => core.cart.reduce((sum, i) => sum + (i.quantity || 0), 0),
    [core.cart]
  );

  const removeCartItem = (productId: string) => {
    core.setCart(prev => prev.filter(i => i.productId !== productId));
  };

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
    setIsCartOpen(true);
  };

  const reorderItems = (items: { productId: string; quantity: number }[]) => {
    core.setCart(Array.isArray(items) ? items : []);
    setIsCartOpen(true);
  };

  const handleExternalPayment = async (gateway: 'STRIPE' | 'GPAY') => {
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
      const estimatedReturnCredit = Math.min(returnUpcs.length * depositValue, dailyCap);

      const res = await fetch(`${BACKEND_URL}/api/payments/create-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          items: core.cart,
          userId: core.currentUser.id,
          gateway,
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
      setIsProcessingOrder(false);
    } finally {
      setIsProcessingOrder(false);
    }
  };

  return (
    <div className="min-h-screen bg-ninpo-black text-white flex flex-col relative overflow-x-hidden font-sans">
      <BackendStatusBanner isOnline={core.isBackendOnline} onReconnect={core.syncWithBackend} />
      <ToastStack toasts={core.toasts} />

      {/* TOP HEADER (logo left, Sign In right) */}
      <Header
        currentUserRole={core.currentUser?.role}
        isLoggedIn={!!core.currentUser}
        onLogin={() => navigate('/login')}
        onLogout={() => core.logout?.()}
      />

      {/* CART DRAWER (correct prop names for your CartDrawer.tsx) */}
      <CartDrawer
        isOpen={isCartOpen}
        cart={core.cart}
        products={core.products}
        address={address}
        acceptedPolicies={acceptedPolicies}
        isProcessing={isProcessingOrder}
        onClose={() => setIsCartOpen(false)}
        onAddressChange={setAddress}
        onPolicyChange={setAcceptedPolicies}
        onRemoveItem={removeCartItem}
        onPayCredits={() => {}}
        onPayExternal={handleExternalPayment}
      />

      {/* Main content */}
      <main className="flex-1 px-6 py-10 max-w-[1600px] w-full mx-auto">
        <Routes>
          {/* STORE FRONT */}
          <Route
            path="/"
            element={
              <CustomerView
                products={core.products}
                orders={core.orders.filter(o => o.customerId === core.currentUser?.id)}
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

          {/* LOGIN ONLY WHEN CLICKED */}
          <Route
            path="/login"
            element={
              <LoginView
                onSuccess={() => {
                  core.restoreSession();
                  navigate('/', { replace: true });
                }}
                onCancel={() => navigate('/', { replace: true })}
              />
            }
          />

          {/* OWNER PROTECTED */}
          <Route
            path="/management"
            element={
              core.currentUser?.role === UserRole.OWNER ? (
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
            path="/driver"
            element={
              core.currentUser?.role === UserRole.OWNER ? (
                <DriverView orders={core.orders} updateOrder={core.updateOrder} />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />

          <Route path="/success" element={<PaymentSuccess clearCart={core.clearCart} />} />
          <Route path="/cancel" element={<PaymentCancel />} />

          {/* Unknown routes return to store */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* Floating Cart Button */}
      {cartCount > 0 && (
        <button
          onClick={() => setIsCartOpen(true)}
          className="fixed bottom-8 right-8 z-[9000] bg-ninpo-lime text-ninpo-black px-6 py-4 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-neon flex items-center gap-3"
        >
          <ShoppingBag className="w-4 h-4" />
          Cart ({cartCount})
        </button>
      )}

      <LegalFooter />
    </div>
  );
}

export default App;
