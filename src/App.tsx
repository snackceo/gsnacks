import { useState } from 'react';
import { useNinpoCore } from './hooks/useNinpoCore';

import CustomerView from './views/CustomerView';
import ManagementView from './views/ManagementView';
import DriverView from './views/DriverView';
import LoginView from './views/LoginView';

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

  const [address, setAddress] = useState('');
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);
  const [viewMode, setViewMode] =
    useState<'market' | 'management' | 'driver'>('market');

  const [isLoginViewOpen, setIsLoginViewOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isProcessingOrder, setIsProcessingOrder] = useState(false);

  const handleExternalPayment = async (type: 'STRIPE' | 'GPAY') => {
    if (!core.currentUser || isProcessingOrder) return;

    setIsProcessingOrder(true);

    try {
      const res = await fetch(
        `${BACKEND_URL}/api/payments/create-session`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: core.cart,
            userId: core.currentUser.id,
            gateway: type
          })
        }
      );

      if (!res.ok) throw new Error('Payment failed');

      const { sessionUrl } = await res.json();
      core.addToast('REDIRECTING TO SECURE VAULT', 'success');
      window.location.href = sessionUrl;
    } catch (err: any) {
      core.addToast(err?.message ?? 'Payment error', 'warning');
      setIsProcessingOrder(false);
    }
  };

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
        onLogoClick={() => setViewMode('market')}
        onSelectMarket={() => setViewMode('market')}
        onSelectManagement={() => setViewMode('management')}
        onSelectDriver={() => setViewMode('driver')}
        onLogin={() => setIsLoginViewOpen(true)}
        onLogout={() => core.setCurrentUser(null)}
      />

      <main className="flex-1 px-6 py-10 max-w-[1600px] w-full mx-auto">
        {viewMode === 'market' && (
          <CustomerView
            products={core.products}
            orders={core.orders.filter(
              o => o.customerId === core.currentUser?.id
            )}
            currentUser={core.currentUser}
            openLogin={() => setIsLoginViewOpen(true)}
            onRequestRefund={() => {}}
            addToCart={id => {
              if (!core.currentUser) {
                setIsLoginViewOpen(true);
                return;
              }
              core.setCart(prev => {
                const existing = prev.find(i => i.productId === id);
                return existing
                  ? prev.map(i =>
                      i.productId === id
                        ? { ...i, quantity: i.quantity + 1 }
                        : i
                    )
                  : [...prev, { productId: id, quantity: 1 }];
              });
              core.addToast('ADDED TO CARGO');
            }}
            updateUserProfile={() => {}}
            reorderItems={() => {}}
            onRedeemPoints={() => {}}
          />
        )}

        {viewMode === 'management' && core.currentUser && (
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
            updateUserProfile={() => {}}
          />
        )}

        {viewMode === 'driver' && (
          <DriverView
            orders={core.orders}
            updateOrder={core.updateOrder}
          />
        )}
      </main>

      <button
        onClick={() => setIsCartOpen(true)}
        className="fixed bottom-10 right-10 z-[9000] w-16 h-16 bg-ninpo-lime text-ninpo-black rounded-[1.5rem] shadow-neon flex items-center justify-center"
      >
        <ShoppingBag className="w-7 h-7" />
        {core.cart.length > 0 && (
          <div className="absolute -top-2 -right-2 w-7 h-7 bg-ninpo-red text-white text-[10px] font-black rounded-full flex items-center justify-center">
            {core.cart.length}
          </div>
        )}
      </button>

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
        onRemoveItem={id =>
          core.setCart(prev => prev.filter(i => i.productId !== id))
        }
        onPayCredits={() => {}}
        onPayExternal={handleExternalPayment}
      />

      {isLoginViewOpen && (
        <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/90">
          <LoginView
            users={core.users}
            onLogin={u => {
              core.setCurrentUser(u);
              setIsLoginViewOpen(false);
            }}
            onRegister={u => {
              core.setUsers(p => [...p, u]);
              core.setCurrentUser(u);
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
