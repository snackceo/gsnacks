export const buildPriceObservationPayload = ({
  item,
  storeId,
  receiptCaptureId,
  productId,
  unmappedProductId,
  observedAt,
}) => {
  const {
    unitPrice,
    quantity,
    totalPrice,
    receiptName,
    matchMethod,
    matchConfidence,
    promoDetected,
  } = item;

  if (!unitPrice || unitPrice <= 0) {
    return { ok: false, reason: 'invalid_price' };
  }

  return {
    ok: true,
    payload: {
      storeId,
      receiptCaptureId,
      productId,
      unmappedProductId,
      observedAt,
      price: unitPrice,
      quantity: quantity || 1,
      totalPrice: totalPrice || unitPrice * (quantity || 1),
      receiptName,
      matchMethod,
      matchConfidence,
      promoDetected: promoDetected || false,
      isAutoObserved: true,
    },
  };
};
