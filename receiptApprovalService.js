import mongoose from 'mongoose';
import ReceiptParseJob from '../../models/ReceiptParseJob.js';
import ReceiptCapture from '../../models/ReceiptCapture.js';
import Store from '../../models/Store.js';
import Product from '../../models/Product.js';
import UnmappedProduct from '../../models/UnmappedProduct.js';
import PriceObservation from '../../models/PriceObservation.js';
import StoreInventory from '../../models/StoreInventory.js';
import UpcItem from '../../models/UpcItem.js';
import { recordAuditLog } from '../../utils/audit.js';
import { transitionReceiptParseJobStatus } from '../../utils/receiptParseJobStatus.js';

export const approveJob = async (jobId, payload, actor) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      finalStoreId,
      confirmStoreCreate,
      storeCandidate,
      items: approvalItems,
    } = payload;

    const job = await ReceiptParseJob.findById(jobId).session(session);
    if (!job) {
      throw new Error('ReceiptParseJob not found');
    }

    const capture = await ReceiptCapture.findById(job.captureId).session(session);
    if (!capture) {
      throw new Error('ReceiptCapture not found');
    }

    let store;
    if (finalStoreId) {
      store = await Store.findById(finalStoreId).session(session);
    } else if (confirmStoreCreate && storeCandidate?.name) {
      const [newStore] = await Store.create([{
        name: storeCandidate.name,
        address: storeCandidate.address,
        phone: storeCandidate.phone,
        storeType: storeCandidate.storeType,
      }], { session });
      store = newStore;
    }

    if (!store) {
      throw new Error('Store could not be resolved or created.');
    }

    capture.storeId = store._id;
    capture.storeName = store.name;

    const now = new Date();
    // Process each approved item from the draft
    for (const item of approvalItems) {
      const jobItem = job.items.find(i => i.lineIndex === item.lineIndex);
      if (!jobItem) continue;

      switch (item.action) {
        case 'CREATE_PRODUCT':
          if (item.createProduct?.name) {
            const [newProduct] = await Product.create([{
              name: item.createProduct.name,
              price: item.createProduct.price,
              deposit: item.createProduct.deposit,
              sizeOz: item.createProduct.sizeOz,
              sizeUnit: item.createProduct.sizeUnit,
              category: item.createProduct.category,
              brand: item.createProduct.brand,
              productType: item.createProduct.productType,
              storageZone: item.createProduct.storageZone,
              storageBin: item.createProduct.storageBin,
              isGlass: item.createProduct.isGlass,
              isTaxable: item.createProduct.isTaxable,
            }], { session });
            await StoreInventory.findOneAndUpdate(
              { storeId: store._id, productId: newProduct._id },
              { $inc: { stock: jobItem.quantity || 1 } },
              { upsert: true, new: true, session }
            );
            await PriceObservation.create([{
              productId: newProduct._id,
              storeId: store._id,
              price: jobItem.unitPrice,
              observedAt: now,
              receiptCaptureId: capture._id,
            }], { session });
            if (jobItem.upcCandidate) {
              await UpcItem.findOneAndUpdate(
                { upc: jobItem.upcCandidate },
                { sku: newProduct.sku, name: newProduct.name },
                { upsert: true, new: true, session }
              );
            }
          }
          break;

        case 'LINK_UPC_TO_PRODUCT':
          if (item.sku && jobItem.upcCandidate) {
            const existingProduct = await Product.findOne({ sku: item.sku }).session(session);
            if (!existingProduct) {
              throw new Error(`Attempted to link UPC to non-existent SKU: ${item.sku}`);
            }

            await StoreInventory.findOneAndUpdate(
              { storeId: store._id, productId: existingProduct._id },
              { $inc: { stock: jobItem.quantity || 1 } },
              { upsert: true, new: true, session }
            );
            await PriceObservation.create([{
              productId: existingProduct._id,
              storeId: store._id,
              price: jobItem.unitPrice,
              observedAt: now,
              receiptCaptureId: capture._id,
            }], { session });

            await UpcItem.findOneAndUpdate(
              { upc: jobItem.upcCandidate },
              { sku: item.sku },
              { upsert: true, new: true, session }
            );
          }
          break;

        case 'CAPTURE_UNMAPPED':
          const [unmapped] = await UnmappedProduct.create([{
            storeId: store._id,
            rawName: jobItem.nameCandidate,
            normalizedName: jobItem.nameCandidate?.toLowerCase(), // Simplified normalization
            status: 'NEW',
          }], { session });
          await PriceObservation.create([{
            unmappedProductId: unmapped._id,
            storeId: store._id,
            price: jobItem.unitPrice,
            observedAt: now,
            receiptCaptureId: capture._id,
          }], { session });
          break;

        case 'IGNORE':
        default:
          // Do nothing for ignored items
          break;
      }
    }

    await transitionReceiptParseJobStatus({
      captureId: capture._id.toString(),
      actor,
      status: 'APPROVED',
      session,
    });

    await capture.save({ session });

    await recordAuditLog({ type: 'receipt_job_approved', actorId: actor, details: `jobId=${jobId} storeId=${store._id}`, session });

    await session.commitTransaction();
    return { job, capture, store };
  } catch (error) {
    await session.abortTransaction();
    throw error; // Re-throw the error to be handled by the controller
  } finally {
    session.endSession();
  }
};