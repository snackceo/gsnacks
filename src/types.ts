// Types
export type ReceiptItemClassification = 'A' | 'B' | 'C' | 'D';

// ... previous lines
// ... other types
// ... after line 350

export interface bucketCounts {
    A: number;
    B: number;
    C: number;
    D: number; // Noise (coupons, taxes, subtotals)
}