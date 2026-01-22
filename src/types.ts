export type ReceiptItemClassification = 'A' | 'B' | 'C' | 'D';

// ... other existing lines in types.ts ...

interface ParsedReceipt {
  // ... other existing members ...
  bucketCounts: {
      A: number;
      B: number;
      C: number;
      D: number; // added for noise items
  };
}