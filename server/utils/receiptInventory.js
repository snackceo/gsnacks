const assertSingleInventoryId = ({ productId, unmappedProductId }) => {
  const hasProductId = Boolean(productId);
  const hasUnmappedProductId = Boolean(unmappedProductId);
  if (hasProductId === hasUnmappedProductId) {
    throw new Error('Exactly one of productId or unmappedProductId must be set.');
  }
};

export const buildStoreInventoryQuery = ({ storeId, productId, unmappedProductId }) => {
  if (productId) {
    return { storeId, productId };
  }
  if (unmappedProductId) {
    return { storeId, unmappedProductId };
  }
  return null;
};

export const buildInventoryUpdate = ({
  storeId,
  price,
  inventoryId,
  lineIndex,
  productId,
  unmappedProductId
}) => {
  assertSingleInventoryId({ productId, unmappedProductId });
  return {
    storeId,
    price,
    inventoryId,
    lineIndex,
    ...(productId ? { productId } : { unmappedProductId })
  };
};
