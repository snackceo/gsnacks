export const providerNormalizationFixtures = [
  {
    name: 'gemini-style payload stays compatible after normalization',
    input: [
      {
        receiptName: '  MTN\nDEW BAJA BLAST  ',
        quantity: '2',
        unitPrice: '3,50',
        totalPrice: '7,00',
        upc: 'O123456789I2'
      }
    ],
    expected: [
      {
        receiptName: 'MTN DEW BAJA BLAST',
        quantity: 2,
        unitPrice: 3.5,
        totalPrice: 7,
        upc: '012345678912'
      }
    ]
  },
  {
    name: 'vision/raw recovery style payload is normalized to unified contract',
    input: [
      {
        description: ' LAYS  CLASSIC ',
        qty: 'I',
        priceEach: '$2.99',
        lineTotal: '$2.99',
        barcode: ''
      },
      {
        itemName: 'COKE\nZERO',
        count: '3',
        price: '1.25',
        amount: '3.75',
        upcCandidate: ' 0490000I234 '
      }
    ],
    expected: [
      {
        receiptName: 'LAYS CLASSIC',
        quantity: 1,
        unitPrice: 2.99,
        totalPrice: 2.99,
        upc: null
      },
      {
        receiptName: 'COKE ZERO',
        quantity: 3,
        unitPrice: 1.25,
        totalPrice: 3.75,
        upc: '04900001234'
      }
    ]
  }
];
