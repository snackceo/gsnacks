import React, { useState, useEffect } from 'react';
import { XCircle, Plus, Search } from 'lucide-react';
import { UnmappedUpcData, SizeUnit } from '../types';
import { useNinpoCore } from '../hooks/useNinpoCore';

interface UnmappedUpcModalProps {
  data: UnmappedUpcData;
  onCreateProduct: (productData: {
    name: string;
    price: number;
    deposit: number;
    stock: number;
    sizeOz: number;
    sizeUnit: SizeUnit;
    category: string;
    nutritionNote: string;
  }) => void;
  onAttachToExisting: (productId: string) => void;
  onClose: () => void;
  products: Array<{ id: string; name: string; sku?: string }>;
}

const UnmappedUpcModal: React.FC<UnmappedUpcModalProps> = ({
  data,
  onCreateProduct,
  onAttachToExisting,
  onClose,
  products
}) => {
  const { addToast } = useNinpoCore ? useNinpoCore() : { addToast: () => {} };
  const [activeTab, setActiveTab] = useState<'create' | 'attach'>('create');
  const [createForm, setCreateForm] = useState({
    name: '',
    price: 0,
    deposit: 0,
    stock: 1,
    sizeOz: 0,
    sizeUnit: 'oz' as SizeUnit,
    category: 'DRINK',
    nutritionNote: ''
  });
  const [attachSearch, setAttachSearch] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      setCreateForm(prev => ({
        ...prev,
        name: data.name || prev.name,
        price: data.price || prev.price,
        deposit: data.deposit || prev.deposit,
        sizeOz: data.sizeOz || prev.sizeOz,
        sizeUnit: prev.sizeUnit,
        category: data.category || prev.category,
        nutritionNote: prev.nutritionNote
      }));
    }
  }, [data]);

  const sizeUnitOptions: SizeUnit[] = ['oz', 'fl oz', 'g', 'kg', 'ml', 'l'];

  const filteredProducts = products.filter(
    p =>
      p.name.toLowerCase().includes(attachSearch.toLowerCase()) ||
      (p.sku && p.sku.toLowerCase().includes(attachSearch.toLowerCase()))
  );

  const handleCreate = () => {
    if (!createForm.name.trim()) {
      addToast('Product name is required', 'error');
      return;
    }
    onCreateProduct(createForm);
    addToast('Product created and UPC linked', 'success');
  };

  const handleAttach = () => {
    if (!selectedProductId) {
      addToast('Select a product to attach', 'error');
      return;
    }
    onAttachToExisting(selectedProductId);
    addToast('UPC linked to selected product', 'success');
  };

  // Modal scroll lock
  React.useEffect(() => {
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center">
      <div
        className="w-full sm:max-w-2xl h-[100dvh] sm:h-auto sm:max-h-[90dvh] bg-ninpo-black border border-white/10 rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-ninpo-black border-b border-white/10 px-4 py-3 flex items-center justify-between">
          <div className="text-white font-black">Unmapped UPC: {data.upc}</div>
          <button className="px-3 py-2 rounded-xl border border-white/10" onClick={onClose}>
            <XCircle className="w-4 h-4" />
          </button>
        </div>
        {/* Tabs */}
        <div className="flex gap-2 px-4 pt-3 pb-2 bg-ninpo-black sticky top-[56px] z-9">
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
        {/* Body */}
        <div className="modal-body overflow-y-auto px-4 py-4 flex-1" style={{ maxHeight: 'calc(100dvh - 140px)' }}>
          {activeTab === 'create' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* ...existing code for create form... */}
                <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                  <span>Product Name</span>
                  <input
                    id="newProductName"
                    name="newProductName"
                    className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                    placeholder="e.g. Coca-Cola 12oz"
                    value={createForm.name}
                    onChange={e => setCreateForm({ ...createForm, name: e.target.value })}
                  />
                </label>
                {/* ...rest of create form fields... */}
                {/* ...existing code... */}
              </div>
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
                  id="attachProductSearch"
                  name="attachProductSearch"
                  className="w-full bg-black/40 border border-white/10 rounded-2xl pl-12 pr-4 py-4 text-sm text-white"
                  placeholder="Search products by name or SKU..."
                  value={attachSearch}
                  onChange={e => setAttachSearch(e.target.value)}
                />
              </div>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {filteredProducts.map(product => {
                  const pid = (product as any)._id || product.id;
                  return (
                    <div
                      key={pid}
                      onClick={() => setSelectedProductId(pid)}
                      className={`p-4 rounded-2xl border cursor-pointer transition ${
                        selectedProductId === pid
                          ? 'border-ninpo-lime bg-ninpo-lime/10'
                          : 'border-white/10 bg-black/30 hover:bg-black/50'
                      }`}
                    >
                    <p className="text-white font-semibold">{product.name}</p>
                    <p className="text-[10px] text-slate-600 uppercase tracking-widest">
                      SKU: {product.sku || pid}
                    </p>
                    </div>
                  );
                })}
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
        {/* Footer */}
        <div className="sticky bottom-0 z-10 bg-ninpo-black border-t border-white/10 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
          <button className="w-full rounded-2xl bg-ninpo-lime text-ninpo-black font-black py-3" onClick={activeTab === 'create' ? handleCreate : handleAttach} disabled={activeTab === 'create' ? !createForm.name.trim() : !selectedProductId}>
            {activeTab === 'create' ? (<><Plus className="w-4 h-4" /> Create Product & Link UPC</>) : (<><Plus className="w-4 h-4" /> Link UPC to Selected Product</>)}
          </button>
        </div>
      </div>
    </div>
  );
};

export default UnmappedUpcModal;
