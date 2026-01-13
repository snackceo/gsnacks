import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';

import { useNinpoCore } from './hooks/useNinpoCore';
import { ReturnUpcCount, UserRole, UserTier } from './types';

import CustomerView from './views/CustomerView';
import ManagementView from './views/ManagementView';
import DriverView from './views/DriverView';
import LoginView from './views/LoginView';
import PaymentSuccess from './views/PaymentSuccess';
import PaymentCancel from './views/PaymentCancel';
import ResetPasswordView from './views/ResetPasswordView';

import Header from './components/Header';
import CartDrawer from './components/CartDrawer';
import LegalFooter from './components/LegalFooter';
import BackendStatusBanner from './components/BackendStatusBanner';
import ToastStack from './components/ToastStack';

import { ShoppingBag } from 'lucide-react';

const BACKEND_URL =
  (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:5000';

function App() {
  const core = useNinpoCore();
  const location = useLocation();

  const [address, setAddress] = useState('');
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);
  const [isLoginViewOpen, setIsLoginViewOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isProcessingOrder, setIsProcessingOrder] = useState(false);

  const baseDeliveryFee = Number(core.settings.deliveryFee || 0);
  const isPlatinumMember = core.currentUser?.membershipTier === UserTier.PLATINUM;
  const effectiveDeliveryFee =
    isPlatinumMember && core.settings.platinumFreeDelivery ? 0 : baseDeliveryFee;

  const handleExternalPayment = async (
    type: 'STRIPE' | 'GPAY',
    returnUpcs: ReturnUpcCount[],
    returnPayoutMethod: 'CREDIT' | 'CASH'
  ) => {
    if (isProcessingOrder) return;

    if (!core.currentUser && !core.settings.allowGuestCheckout) {
      setIsLoginViewOpen(true);
      return;
    }

    setIsProcessingOrder(true);

    try {
      const res = await fetch(`${BACKEND_URL}/api/payments/create-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          items: core.cart,
          userId: core.currentUser?.id,
          gateway: type,
          address: address, // NEW: stored on order for owner dashboard
          deliveryFee: effectiveDeliveryFee,
          returnUpcCounts: returnUpcs,
          returnPayoutMethod
        })
      });

      if (!res.ok) throw new Error('Payment failed');

      const { sessionUrl } = await res.json();
      core.addToast('REDIRECTING TO SECURE VAULT', 'success');
      window.location.href = sessionUrl;
    } catch (err: any) {
      core.addToast(err?.message ?? 'Payment error', 'warning');
      setIsProcessingOrder(false);
    }
  };

  const handleCreditsPayment = async (
    returnUpcs: ReturnUpcCount[],
    returnPayoutMethod: 'CREDIT' | 'CASH'
  ) => {
    if (isProcessingOrder) return false;

    if (!core.currentUser) {
      core.addToast('LOGIN REQUIRED FOR CREDITS', 'warning');
      setIsLoginViewOpen(true);
      return false;
    }

    setIsProcessingOrder(true);

    try {
      const res = await fetch(`${BACKEND_URL}/api/payments/credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          items: core.cart,
          address,
          deliveryFee: effectiveDeliveryFee,
          returnUpcCounts: returnUpcs,
          returnPayoutMethod
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Credits checkout failed');

      if (data?.creditBalance !== undefined) {
        core.setCurrentUser(prev =>
          prev ? { ...prev, creditBalance: Number(data.creditBalance || 0) } : prev
        );
      }

      if (data?.sessionUrl) {
        core.addToast('REDIRECTING TO SECURE VAULT', 'success');
        window.location.href = data.sessionUrl;
        return true;
      }

      core.addToast('CREDITS APPLIED', 'success');
      core.clearCart();
      setIsCartOpen(false);
      if (core.fetchOrders) await core.fetchOrders();
      return true;
    } catch (err: any) {
      core.addToast(err?.message ?? 'Credits payment error', 'warning');
      return false;
    } finally {
      setIsProcessingOrder(false);
    }
  };

  // total quantity across all cart lines (used for badge)
  const cartCount = core.cart.reduce((sum, i) => sum + (i.quantity || 0), 0);
  const hideCustomerUi =
    location.pathname.startsWith('/management') ||
    location.pathname.startsWith('/driver');

  useEffect(() => {
    if (location.pathname.startsWith('/reset-password')) {
      setIsLoginViewOpen(false);
    }
  }, [location.pathname]);

  if (core.isBootstrapping) {
    return (
      <div className="min-h-screen bg-ninpo-black text-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-16 w-16 rounded-full border-4 border-white/20 border-t-white animate-spin" />
          <p className="text-xs uppercase tracking-[0.4em] text-white/60">
            Loading storefront
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ninpo-black text-white flex flex-col relative overflow-x-hidden font-sans">
      <BackendStatusBanner
        isOnline={core.isBackendOnline}
        onReconnect={core.syncWithBackend}
      />

      <ToastStack toasts={core.toasts} />

      <Header
        currentUserRole={core.currentUser?.role}
        isLoggedIn={!!core.currentUser}
        onLogin={() => setIsLoginViewOpen(true)}
        onLogout={() => core.logout?.()}
      />

      <main className="flex-1 px-6 py-10 max-w-[1600px] w-full mx-auto">
        <Routes>
          {/* CUSTOMER / MARKET */}
          <Route
            path="/"
            element={
              <CustomerView
                products={core.products}
                orders={core.orders.filter(
                  o => o.customerId === core.currentUser?.id
                )}
                currentUser={core.currentUser}
                openLogin={() => setIsLoginViewOpen(true)}
                onRequestRefund={() => {}}
                addToCart={(productId) => {
                  if (!core.currentUser) {
                    if (!core.settings.allowGuestCheckout) {
                      setIsLoginViewOpen(true);
                      return;
                    }
                  }

                  const product = core.products.find(p => p.id === productId);
                  const stock = (product as any)?.stock ?? 0;
                  const inCart =
                    core.cart.find(i => i.productId === productId)?.quantity ??
                    0;

                  // Enforce stock locally (prevents adding beyond available stock)
                  if (stock <= 0) {
                    core.addToast('OUT OF STOCK', 'warning');
                    return;
                  }

                  if (inCart >= stock) {
                    core.addToast(`MAX STOCK REACHED (${stock})`, 'warning');
                    return;
                  }

                  core.setCart(prev => {
                    const existing = prev.find(i => i.productId === productId);
                    return existing
                      ? prev.map(i =>
                          i.productId === productId
                            ? { ...i, quantity: i.quantity + 1 }
                            : i
                        )
                      : [...prev, { productId, quantity: 1 }];
                  });

                  core.addToast('ADDED TO CARGO', 'success');
                }}
                updateUserProfile={() => {}}
                reorderItems={() => {}}
                onRedeemPoints={core.redeemPoints}
              />
            }
          />

          {/* PAYMENT RESULTS */}
          <Route
            path="/success"
            element={<PaymentSuccess clearCart={core.clearCart} />}
          />
          <Route path="/cancel" element={<PaymentCancel />} />
          <Route path="/reset-password" element={<ResetPasswordView />} />

          {/* OWNER MANAGEMENT */}
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
                  userStats={core.userStats}
                  settings={core.settings}
                  setSettings={core.setSettings}
                  approvals={core.approvals}
                  auditLogs={core.auditLogs}
                  updateOrder={core.updateOrder}
                  adjustCredits={core.adjustCredits}
                  updateUserProfile={core.updateUserProfile}
                  fetchUsers={core.fetchUsers}
                  fetchUserStats={core.fetchUserStats}
                  fetchApprovals={core.fetchApprovals}
                  fetchAuditLogs={core.fetchAuditLogs}
                />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />

          {/* DRIVER — OWNER ONLY FOR NOW */}
          <Route
            path="/driver"
            element={
              core.currentUser?.role === UserRole.OWNER ||
              core.currentUser?.role === UserRole.DRIVER ? (
                <DriverView
                  currentUser={core.currentUser}
                  orders={core.orders}
                  updateOrder={core.updateOrder}
                />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
        </Routes>
      </main>

      {/* CART BUTTON */}
      {!hideCustomerUi && (
        <>
          <button
            onClick={() => setIsCartOpen(true)}
            className="fixed bottom-10 right-10 z-[9000] w-16 h-16 bg-ninpo-lime text-ninpo-black rounded-[1.5rem] shadow-neon flex items-center justify-center"
            aria-label="Open cart"
          >
            <span className="relative flex items-center justify-center w-full h-full">
              <ShoppingBag className="w-7 h-7" />

              {cartCount > 0 && (
                <span className="absolute -top-2 -right-2 min-w-[24px] h-6 px-2 rounded-full bg-red-600 text-white text-[10px] font-black flex items-center justify-center border-2 border-ninpo-black">
                  {cartCount}
                </span>
              )}
            </span>
          </button>
        </>
      )}

      {/* CART DRAWER */}
      <CartDrawer
        isOpen={isCartOpen}
        cart={core.cart}
        products={core.products}
        address={address}
        acceptedPolicies={acceptedPolicies}
        isProcessing={isProcessingOrder}
        deliveryFee={effectiveDeliveryFee}
        membershipTier={core.currentUser?.membershipTier}
        michiganDepositValue={core.settings.michiganDepositValue}
        returnHandlingFeePerContainer={core.settings.returnHandlingFeePerContainer}
        glassHandlingFeePerContainer={core.settings.glassHandlingFeePerContainer}
        pickupOnlyMultiplier={core.settings.pickupOnlyMultiplier}
        dailyReturnLimit={core.settings.dailyReturnLimit}
        onClose={() => setIsCartOpen(false)}
        onAddressChange={setAddress}
        onPolicyChange={setAcceptedPolicies}
        onRemoveItem={id =>
          core.setCart(prev => prev.filter(i => i.productId !== id))
        }
        onPayCredits={handleCreditsPayment}
        onPayExternal={handleExternalPayment}
      />

      {/* LOGIN MODAL */}
      {isLoginViewOpen && (
        <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/90">
          <LoginView
            onSuccess={async () => {
              // After backend sets cookie, restore current user from /api/auth/me
              if (core.restoreSession) await core.restoreSession();
              if (core.fetchOrders) await core.fetchOrders();
              setIsLoginViewOpen(false);
            }}
            onCancel={() => setIsLoginViewOpen(false)}
          />
        </div>
      )}

      <LegalFooter />
    </div>
  );
}

export default App;
