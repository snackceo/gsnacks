import React, { useState, useEffect } from 'react';
import { XCircle, Plus, Search, ScanLine, Loader2 } from 'lucide-react';

interface UnmappedUpcModalProps {
  upc: string;
  onCreateProduct: (productData: {
    name: string;
    price: number;
    deposit: number;
    stock: number;
    sizeOz: number;
    category: string;
  }) => void;
  onAttachToExisting: (productId: string) => void;
  onClose: () => void;
  onAnalyze: () => void;
  products: Array<{ id: string; name: string; sku?: string }>;
  productDraft: any;
  isAnalyzing: boolean;
}

const UnmappedUpcModal: React.FC<UnmappedUpcModalProps> = ({
  upc,
  onCreateProduct,
  onAttachToExisting,
  onClose,
  onAnalyze,
  products,
  productDraft,
  isAnalyzing,
}) => {
  const [activeTab, setActiveTab] = useState<'create' | 'attach'>('create');
  const [createForm, setCreateForm] = useState({
    name: '',
    price: 0,
    deposit: 0,
    stock: 1,
    sizeOz: 0,
    category: 'DRINK',
  });
  const [attachSearch, setAttachSearch] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  useEffect(() => {
    if (productDraft) {
      setCreateForm(prev => ({
        ...prev,
        name: productDraft.name || prev.name,
        price: productDraft.price || prev.price,
        deposit: productDraft.deposit || prev.deposit,
        stock: productDraft.stock || prev.stock,
        sizeOz: productDraft.sizeOz || prev.sizeOz,
        category: productDraft.category || prev.category,
      }));
    }
  }, [productDraft]);

  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(attachSearch.toLowerCase()) ||
    (p.sku && p.sku.toLowerCase().includes(attachSearch.toLowerCase()))
  );

  const handleCreate = () => {
    onCreateProduct(createForm);
  };

  const handleAttach = () => {
    if (selectedProductId) {
      onAttachToExisting(selectedProductId);
    }
  };

  return (
    <div className="fixed inset-0 z-[14000] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-ninpo-black border border-white/10 rounded-[2.5rem] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <p className="text-white font-black uppercase tracking-widest text-lg">
              Unmapped UPC: {upc}
            </p>
            <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest mt-1">
              This UPC is not linked to any product. Choose how to handle it.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-3 rounded-2xl bg-white/5 border border-white/10 text-white hover:bg-white/10 transition"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>

        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('create')}
            className={`flex-1 px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest ${
              activeTab === 'create' ? 'bg-ninpo-lime text-ninpo-black' : 'bg-white/5 text-white'
            }`}
          >
            Create New Product
          </button>
          <button
            onClick={() => setActiveTab('attach')}
            className={`flex-1 px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest ${
              activeTab === 'attach' ? 'bg-ninpo-lime text-ninpo-black' : 'bg-white/5 text-white'
            }`}
          >
            Attach to Existing
          </button>
        </div>

        {activeTab === 'create' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                <span>Product Name</span>
                <input
                  className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="e.g. Coca-Cola 12oz"
                  value={createForm.name}
                  onChange={e => setCreateForm({ ...createForm, name: e.target.value })}
                />
              </label>
              <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                <span>Price ($)</span>
                <input
                  type="number"
                  step="0.01"
                  className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="0.00"
                  value={createForm.price}
                  onChange={e => setCreateForm({ ...createForm, price: Number(e.target.value) })}
                />
              </label>
              <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                <span>Deposit ($)</span>
                <input
                  type="number"
                  step="0.01"
                  className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="0.10"
                  value={createForm.deposit}
                  onChange={e => setCreateForm({ ...createForm, deposit: Number(e.target.value) })}
                />
              </label>
              <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                <span>Initial Stock</span>
                <input
                  type="number"
                  min="0"
                  className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="1"
                  value={createForm.stock}
                  onChange={e => setCreateForm({ ...createForm, stock: Number(e.target.value) })}
                />
              </label>
              <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                <span>Size (oz)</span>
                <input
                  type="number"
                  step="0.1"
                  className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="12.0"
                  value={createForm.sizeOz}
                  onChange={e => setCreateForm({ ...createForm, sizeOz: Number(e.target.value) })}
                />
              </label>
              <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                <span>Category</span>
                <select
                  className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  value={createForm.category}
                  onChange={e => setCreateForm({ ...createForm, category: e.target.value })}
                >
                  <option value="DRINK">Drink</option>
                  <option value="SNACK">Snack</option>
                  <option value="OTHER">Other</option>
                </select>
              </label>
            </div>
            <button
              onClick={onAnalyze}
              disabled={isAnalyzing}
              className="w-full py-4 bg-white/10 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3"
            >
              {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
              Analyze Label Photo (Optional)
            </button>
            <button
              onClick={handleCreate}
              disabled={!createForm.name.trim()}
              className="w-full py-4 bg-ninpo-lime text-ninpo-black rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:scale-[1.01] transition-all shadow-neon disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" />
              Create Product & Link UPC
            </button>
          </div>
        )}

        {activeTab === 'attach' && (
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-600" />
              <input
                className="w-full bg-black/40 border border-white/10 rounded-2xl pl-12 pr-4 py-4 text-sm text-white"
                placeholder="Search products by name or SKU..."
                value={attachSearch}
                onChange={e => setAttachSearch(e.target.value)}
              />
            </div>
            <div className="max-h-64 overflow-y-auto space-y-2">
              {filteredProducts.map(product => (
                <div
                  key={product.id}
                  onClick={() => setSelectedProductId(product.id)}
                  className={`p-4 rounded-2xl border cursor-pointer transition ${
                    selectedProductId === product.id
                      ? 'border-ninpo-lime bg-ninpo-lime/10'
                      : 'border-white/10 bg-black/30 hover:bg-black/50'
                  }`}
                >
                  <p className="text-white font-semibold">{product.name}</p>
                  <p className="text-[10px] text-slate-600 uppercase tracking-widest">
                    SKU: {product.sku || product.id}
                  </p>
                </div>
              ))}
              {filteredProducts.length === 0 && (
                <p className="text-slate-500 text-[10px] uppercase tracking-widest text-center py-8">
                  No products found matching "{attachSearch}"
                </p>
              )}
            </div>
            <button
              onClick={handleAttach}
              disabled={!selectedProductId}
              className="w-full py-4 bg-ninpo-lime text-ninpo-black rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:scale-[1.01] transition-all shadow-neon disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" />
              Link UPC to Selected Product
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default UnmappedUpcModal;