import { normalizeStoreNumber } from '../storeMatcher.js';
import {
  buildInlineDataFromDataUrl,
  fetchAsInlineData,
  parseReceiptAddress,
  recoverItemsFromRawText
} from './shared.js';

const getGoogleApiKey = () => process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';

const extractStoreData = rawText => {
  const lines = String(rawText || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) return {};
  const phoneMatch = rawText.match(/(?:\+1\s*)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  const addressLine = lines.find(line => /\d+\s+.+\b(?:st|street|ave|avenue|rd|road|blvd|dr|drive|ln|lane)\b/i.test(line));
  const storeNumberLine = lines.find(line => /(store|st|sc)\s*#?\s*\d+/i.test(line));
  const storeNumber = storeNumberLine?.match(/\d{2,}/)?.[0];
  return {
    name: lines[0],
    phone: phoneMatch?.[0],
    address: addressLine ? parseReceiptAddress(addressLine) : undefined,
    storeNumber: storeNumber ? normalizeStoreNumber(storeNumber) : undefined
  };
};

const getBlockCoordinates = fullTextAnnotation => {
  const blocks = [];
  for (const page of fullTextAnnotation?.pages || []) {
    for (const block of page.blocks || []) {
      blocks.push({
        confidence: block.confidence,
        vertices: block.boundingBox?.vertices || []
      });
    }
  }
  return blocks;
};

export async function visionProvider({ images }) {
  const apiKey = getGoogleApiKey();
  if (!apiKey) {
    throw new Error('Google Vision API key not configured.');
  }

  const output = {
    provider: 'vision',
    rawText: '',
    rawTextByImage: [],
    confidenceMetadata: null,
    blockCoordinates: [],
    parsedByImage: [],
    skippedImages: [],
    parseStageFailures: { invalid_json: 0, no_items: 0, all_images_skipped: 0 },
    storeCandidateData: {},
    items: []
  };

  for (const image of images || []) {
    let imageContent;
    if (/^https?:\/\//i.test(image.url)) {
      imageContent = await fetchAsInlineData(image.url);
    } else if (String(image.url || '').startsWith('data:')) {
      imageContent = buildInlineDataFromDataUrl(image.url);
      if (!imageContent) {
        output.skippedImages.push({ url: image.url, reason: 'invalid_data_url' });
        continue;
      }
    } else {
      output.skippedImages.push({ url: image.url, reason: 'unsupported_image_url' });
      continue;
    }

    const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { content: imageContent.inlineData.data },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }]
        }]
      })
    });

    if (!response.ok) {
      throw new Error(`Vision OCR failed: ${response.status}`);
    }

    const payload = await response.json();
    const visionResult = payload?.responses?.[0] || {};
    const rawText = visionResult?.fullTextAnnotation?.text || visionResult?.textAnnotations?.[0]?.description || '';
    output.rawTextByImage.push(rawText);
    output.parsedByImage.push({ source: 'fullTextAnnotation', textLength: rawText.length });
    output.blockCoordinates.push(...getBlockCoordinates(visionResult?.fullTextAnnotation));

    const inferredStore = extractStoreData(rawText);
    output.storeCandidateData = {
      ...inferredStore,
      ...output.storeCandidateData
    };

    const items = recoverItemsFromRawText(rawText);
    if (!items.length) output.parseStageFailures.no_items += 1;
    output.items.push(...items);
  }

  output.rawText = output.rawTextByImage.join('\n\n');
  const totalImages = (images || []).length;
  if (output.skippedImages.length === totalImages && totalImages > 0) {
    output.parseStageFailures.all_images_skipped += 1;
  }
  const blockCount = output.blockCoordinates.length;
  const totalBlockConfidence = output.blockCoordinates.reduce((sum, block) => sum + (block.confidence || 0), 0);
  output.confidenceMetadata = {
    avgBlockConfidence: blockCount ? totalBlockConfidence / blockCount : null,
    blockCount,
    itemCount: output.items.length
  };

  return output;
}
