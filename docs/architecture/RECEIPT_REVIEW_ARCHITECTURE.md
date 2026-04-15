┌──────────────────────────────────────────────────────────────┐
│                  RECEIPT REVIEW SYSTEM                       │
└──────────────────────────────────────────────────────────────┘

Frontend (Driver)
   │
   ├─ Capture photo (camera/gallery)
   │
   └──→ Upload → Cloudinary
                │
                └──→ secureUrl
                         │
                         ▼
                 Backend API
                 ├─ POST /receipt-capture
                 │    → creates:
                 │       • ReceiptCapture
                 │       • ReceiptParseJob (QUEUED)
                 │
                 └─ POST /receipt-parse
                      → either:
                        • Immediate processing (sync)
                        • Queue worker (BullMQ)

Processing Layer
   │
   ├─ Gemini Vision API (OCR)
   ├─ Product Matching
   │    • Alias lookup
   │    • Fuzzy match
   │
   ├─ Validation
   │    • Price bounds
   │    • Missing size
   │    • Confidence checks
   │
   └─ Output:
        ReceiptParseJob
        status = PARSED or NEEDS_REVIEW