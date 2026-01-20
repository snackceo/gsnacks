import React, { useState, useEffect } from 'react';
import { XCircle, Plus, Search } from 'lucide-react';
import { UnmappedUpcData, SizeUnit } from '../types';

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
    onCreateProduct(createForm);
  };

  const handleAttach = () => {
    if (selectedProductId) {
      onAttachToExisting(selectedProductId);
    }
  };

  return (
    <div className="fixed inset-0 z-[14000] flex items-center justify-center p-6">
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-md"
        onClick={onClose}
      />
      <div className="relative w-full max-w-2xl bg-ninpo-black border border-white/10 rounded-[2.5rem] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <p className="text-white font-black uppercase tracking-widest text-lg">
              Unmapped UPC: {data.upc}
            </p>
            <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest mt-1">
              This UPC is not linked to any product. Choose how to handle it.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-3 rounded-2xl bg-ninpo-red/10 text-ninpo-red border border-ninpo-red/20 hover:bg-ninpo-red/20 transition"
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
                  id="newProductName"
                  name="newProductName"
                  className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="e.g. Coca-Cola 12oz"
                  value={createForm.name}
                  onChange={e => setCreateForm({ ...createForm, name: e.target.value })}
                />
              </label>
              <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                <span>Price ($)</span>
                <input
                  id="newProductPrice"
                  name="newProductPrice"
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
                  id="newProductDeposit"
                  name="newProductDeposit"
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
                  id="newProductStock"
                  name="newProductStock"
                  type="number"
                  min="0"
                  className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="1"
                  value={createForm.stock}
                  onChange={e => setCreateForm({ ...createForm, stock: Number(e.target.value) })}
                />
              </label>
              <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                <span>Size</span>
                <div className="flex gap-2">
                  <input
                    id="newProductSizeOz"
                    name="newProductSizeOz"
                    type="number"
                    step="0.1"
                    className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                    placeholder="12.0"
                    value={createForm.sizeOz}
                    onChange={e => setCreateForm({ ...createForm, sizeOz: Number(e.target.value) })}
                  />
                  <select
                    className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                    value={createForm.sizeUnit}
                    onChange={e =>
                      setCreateForm({ ...createForm, sizeUnit: e.target.value as SizeUnit })
                    }
                  >
                    {sizeUnitOptions.map(option => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
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
              <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600 md:col-span-2">
                <span>Nutrition Note (Customer Info)</span>
                <textarea
                  className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white min-h-[96px]"
                  placeholder="e.g. 12g protein • 220 calories • contains peanuts"
                  value={createForm.nutritionNote}
                  onChange={e =>
                    setCreateForm({ ...createForm, nutritionNote: e.target.value })
                  }
                />
              </label>
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
    </div>
  );
};

export default UnmappedUpcModal;
