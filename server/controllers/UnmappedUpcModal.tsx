import React, { useState } from 'react';

interface UnmappedUpcModalProps {
  isOpen: boolean;
  onClose: () => void;
  upc: string;
  onCreateProduct: (upc: string) => void;
  onAttachToSku: (upc: string, sku: string) => void;
}

export const UnmappedUpcModal: React.FC<UnmappedUpcModalProps> = ({
  isOpen,
  onClose,
  upc,
  onCreateProduct,
  onAttachToSku,
}) => {
  const [skuToAttach, setSkuToAttach] = useState('');

  const handleAttach = () => {
    if (skuToAttach.trim()) {
      onAttachToSku(upc, skuToAttach.trim());
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2>Unmapped UPC: {upc}</h2>
        <p>This UPC is not linked to any product. Choose an action:</p>

        <div className="action-section">
          <h3>1. Create New Product</h3>
          <p>Create a new product and link this UPC to it.</p>
          <button onClick={() => onCreateProduct(upc)}>Create Product</button>
        </div>

        <div className="action-section">
          <h3>2. Attach to Existing SKU</h3>
          <p>Link this UPC to an existing product by its SKU.</p>
          <input
            type="text"
            value={skuToAttach}
            onChange={(e) => setSkuToAttach(e.target.value)}
            placeholder="Enter SKU (e.g., NP-000001)"
          />
          <button onClick={handleAttach} disabled={!skuToAttach.trim()}>
            Attach to SKU
          </button>
        </div>

        <button onClick={onClose} className="close-button">Close</button>
      </div>
    </div>
  );
};