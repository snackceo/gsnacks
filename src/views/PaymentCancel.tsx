function PaymentCancel() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-ninpo-black text-white">
      <div className="text-center space-y-4">
        <h1 className="text-3xl font-black uppercase text-ninpo-red">
          Payment Cancelled
        </h1>
        <p className="text-xs uppercase tracking-widest opacity-70">
          No credits were deducted.
        </p>
        <a
          href="/"
          className="inline-block mt-6 px-6 py-3 bg-white/10 text-white rounded-xl font-black text-xs uppercase"
        >
          Return to Market
        </a>
      </div>
    </div>
  );
}

export default PaymentCancel;
