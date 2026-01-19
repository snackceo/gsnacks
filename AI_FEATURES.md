# 🤖 AI Features Documentation

## Overview
NinpoSnacks now includes 6 powerful AI features powered by Google Gemini:

1. ✅ Smart Address Validation
2. 💬 Customer Support Chatbot
3. 🎯 Product Recommendations
4. 🏷️ Automatic Product Categorization
5. 📊 Demand Forecasting
6. 🔍 Natural Language Search

---

## 1. Smart Address Validation

**Purpose**: Validate and correct customer addresses before calculating delivery distance.

### Backend Endpoint
```
POST /api/ai/validate-address
```

**Request Body**:
```json
{
  "address": "123 Main Steet, Detroit MI 48226",
  "model": "gemini-2.5-flash" // optional
}
```

**Response**:
```json
{
  "isValid": false,
  "correctedAddress": "123 Main Street, Detroit MI 48226",
  "confidence": 95,
  "issues": ["Typo: 'Steet' → 'Street'"],
  "suggestions": "Address corrected successfully"
}
```

### Frontend Usage
```typescript
import { validateAddress } from '../services/geminiService';

const result = await validateAddress("123 Main Steet, Detroit MI");
if (!result.isValid) {
  console.log('Corrected:', result.correctedAddress);
}
```

### When to Use
- Before checkout to verify delivery address
- During user registration
- When customer updates profile address
- Before calculating distance/delivery fees

---

## 2. Customer Support Chatbot

**Purpose**: AI-powered chat to answer questions about orders, products, returns, and delivery.

### Backend Endpoint
```
POST /api/ai/chat
```

**Request Body**:
```json
{
  "message": "Where's my order?",
  "conversationHistory": [
    {"role": "user", "message": "Hello"},
    {"role": "agent", "message": "Hi! How can I help?"}
  ],
  "userContext": {
    "userId": "user123",
    "recentOrders": [...],
    "creditBalance": 5.50
  },
  "model": "gemini-2.5-flash" // optional
}
```

**Response**:
```json
{
  "reply": "I can help you track your order! Could you provide your order number?",
  "timestamp": "2026-01-19T10:30:00Z"
}
```

### Frontend Usage
Component already created: `<SupportChatbot />`

**Already integrated** in `App.tsx` - appears as floating chat button in bottom-right corner.

### Features
- Floating chat widget (bottom-right)
- Conversation history
- Typing indicators
- Auto-scrolling messages
- Quick example prompts
- Powered by Gemini AI

---

## 3. Product Recommendations

**Purpose**: Personalized product suggestions based on order history and current cart.

### Backend Endpoint
```
POST /api/ai/recommendations
```

**Request Body**:
```json
{
  "userId": "user123",
  "orderHistory": [...], // last 10 orders
  "currentCart": [...],
  "model": "gemini-2.5-flash" // optional
}
```

**Response**:
```json
{
  "recommendations": [
    {
      "productName": "Coca-Cola 12-pack",
      "category": "Beverages",
      "reason": "You frequently buy Pepsi products",
      "confidence": 85
    }
  ],
  "userId": "user123"
}
```

### Frontend Usage
Component already created: `<ProductRecommendations />`

**Already integrated** in `CustomerView.tsx` - appears above product grid.

### How It Works
- Analyzes past purchase patterns
- Suggests complementary items (chips + dip)
- Identifies missing frequently-bought items
- Shows confidence percentage
- Click recommendation to auto-search

---

## 4. Automatic Product Categorization

**Purpose**: AI categorizes new products when scanning UPC codes.

### Backend Endpoint
```
POST /api/ai/categorize-product
```

**Request Body**:
```json
{
  "productName": "Doritos Nacho Cheese",
  "brand": "Frito-Lay",
  "description": "Tortilla chips",
  "image": "base64_encoded_image", // optional
  "model": "gemini-2.5-flash" // optional
}
```

**Response**:
```json
{
  "category": "Snacks",
  "subcategory": "Chips",
  "tags": ["salty", "tortilla", "cheese"],
  "dietaryInfo": ["vegetarian"],
  "shelfLife": "6 months",
  "storageType": "pantry"
}
```

### Frontend Usage
```typescript
import { categorizeProduct } from '../services/geminiService';

const result = await categorizeProduct(
  "Doritos Nacho Cheese",
  "Frito-Lay",
  "Tortilla chips"
);

// Use result.category, result.tags, etc.
```

### When to Use
- After UPC scan in `InlineScanner` or `ScannerPanel`
- When manually adding new products
- During inventory management
- For bulk product imports

---

## 5. Demand Forecasting

**Purpose**: Predict which products will sell best next week/month.

### Backend Endpoint
```
POST /api/ai/demand-forecast
```

**Request Body**:
```json
{
  "products": [...], // current inventory
  "orderHistory": [...], // last 30 days
  "timeframe": "week", // or "month"
  "model": "gemini-2.5-flash" // optional
}
```

**Response**:
```json
{
  "forecast": [
    {
      "productId": "prod123",
      "productName": "Coca-Cola 2L",
      "predictedSales": 45,
      "confidence": 78,
      "trend": "increasing",
      "stockRecommendation": "Restock 30 units"
    }
  ],
  "insights": "Weekend sales show 20% spike in beverage demand..."
}
```

### Frontend Usage
**Already integrated** in `ManagementDashboard.tsx` - shows weekly forecast section.

### Features
- Top 10 predicted products
- Trend indicators (↗ increasing, ↘ decreasing, → stable)
- Stock recommendations
- AI-generated insights
- Refresh button

---

## 6. Natural Language Search

**Purpose**: Search products using natural language queries like "cheap snacks under $5".

### Backend Endpoint
```
POST /api/ai/natural-search
```

**Request Body**:
```json
{
  "query": "healthy breakfast options under $10",
  "products": [...], // all available products
  "model": "gemini-2.5-flash" // optional
}
```

**Response**:
```json
{
  "matchedProducts": ["prod1", "prod2", "prod3"],
  "interpretation": "Showing healthy breakfast items (cereal, oatmeal, granola) priced under $10",
  "filters": {
    "priceRange": {"min": 0, "max": 10},
    "categories": ["Breakfast", "Cereal"],
    "keywords": ["healthy", "organic", "whole grain"]
  }
}
```

### Frontend Usage
Component created: `<NaturalSearchBar />`

**To integrate** in `CustomerView.tsx`:
```tsx
import { NaturalSearchBar } from '../components/NaturalSearchBar';

<NaturalSearchBar
  products={products}
  onSearchResults={(productIds, interpretation) => {
    // Filter products to show only matched IDs
    console.log('AI found:', interpretation);
  }}
/>
```

### Example Queries
- "cheap snacks under $5"
- "healthy breakfast options"
- "gluten free pasta"
- "party drinks"
- "best selling chips"
- "new arrivals this week"

---

## Environment Setup

### Required Environment Variables
```bash
# Backend (.env)
GEMINI_API_KEY=your_gemini_api_key
GOOGLE_MAPS_API_KEY=your_maps_api_key # for distance calculation
HUB_LAT=42.3314 # your store latitude
HUB_LNG=-83.0458 # your store longitude
```

### Model Configuration (Optional)
```bash
# Allowed models (comma-separated)
GEMINI_MODELS=gemini-2.5-flash,gemini-2.0-flash

# Default model
GEMINI_DEFAULT_MODEL=gemini-2.5-flash
```

---

## Integration Checklist

### ✅ Already Implemented
- [x] Backend endpoints for all 6 features
- [x] Frontend service methods in `geminiService.ts`
- [x] Support chatbot (floating widget)
- [x] Product recommendations (customer view)
- [x] Demand forecast (management dashboard)
- [x] Natural search bar component

### 🔧 Optional Enhancements

#### Add Natural Search to Customer View
```tsx
// In CustomerView.tsx, replace the search input with:
<NaturalSearchBar
  products={products}
  onSearchResults={(productIds) => {
    // Show only matched products
    setFilteredProductIds(productIds);
  }}
/>
```

#### Add Address Validation to Checkout
```tsx
// In CartDrawer.tsx or checkout flow:
const validation = await validateAddress(userAddress);
if (!validation.isValid && validation.confidence > 80) {
  // Prompt user: "Did you mean: {validation.correctedAddress}?"
}
```

#### Use Product Categorization in Scanner
```tsx
// In ScannerPanel.tsx after UPC scan:
const categories = await categorizeProduct(productName, brand);
// Auto-fill category, tags, storage info
```

---

## API Rate Limits

Gemini API has usage quotas. Monitor usage in Google Cloud Console.

**Recommended limits**:
- Chatbot: 100 requests/hour per user
- Recommendations: 10 requests/hour per user
- Natural search: 50 requests/hour
- Demand forecast: 5 requests/day
- Address validation: 200 requests/hour
- Product categorization: 100 requests/hour

---

## Error Handling

All AI features have graceful fallbacks:

```typescript
// Chatbot fails → Shows error message
// Recommendations fail → Empty list (no UI shown)
// Search fails → Shows "Search unavailable"
// Forecast fails → Shows "Unable to generate forecast"
// Validation fails → Assumes address is valid
// Categorization fails → Returns "Uncategorized"
```

---

## Cost Optimization Tips

1. **Cache Results**: Store demand forecasts for 24 hours
2. **Debounce Searches**: Wait 500ms before triggering AI search
3. **Limit History**: Send only last 10 orders (not all)
4. **Reduce Product Count**: Send max 100 products to AI
5. **Use Lower Temperatures**: 0.1-0.3 for deterministic tasks

---

## Testing

### Test Chatbot
1. Click floating chat icon (bottom-right)
2. Ask: "What are your hours?"
3. Ask: "Where's my order #12345?"

### Test Recommendations
1. Login as user with order history
2. View customer page
3. See "Recommended For You" section

### Test Demand Forecast
1. Login as owner/manager
2. Go to Management → Dashboard
3. Scroll to "Weekly Demand Forecast"
4. Click Refresh

### Test Natural Search
1. Add `<NaturalSearchBar />` to CustomerView
2. Type: "cheap snacks under $5"
3. Press Enter or click "AI Search"

### Test Address Validation
```typescript
const result = await validateAddress("123 Main Steet Detroit");
console.log(result.correctedAddress); // "123 Main Street, Detroit"
```

---

## Troubleshooting

### "Gemini API key not configured"
- Check `GEMINI_API_KEY` in `server/.env`
- Restart backend server

### "Model not allowed"
- Check `GEMINI_MODELS` in environment variables
- Default model is `gemini-2.5-flash`

### Chatbot not appearing
- Check `App.tsx` imports `<SupportChatbot />`
- Check z-index (should be 50)

### Recommendations empty
- User needs order history
- Check backend logs for errors
- Verify `orderHistory` is passed correctly

### Natural search not working
- Ensure `products` array is not empty
- Check console for errors
- Try simpler queries first

---

## Future Enhancements

1. **Voice Chat**: Add speech-to-text for chatbot
2. **Image Search**: "Find products that look like this photo"
3. **Price Optimization**: AI suggests optimal pricing
4. **Route Optimization**: AI plans delivery routes
5. **Fraud Detection**: Detect suspicious order patterns
6. **Inventory Alerts**: "Restock Coca-Cola in 3 days"
7. **Customer Segmentation**: Group users by preferences
8. **Seasonal Predictions**: "Stock pumpkin spice in September"

---

## Support

For issues with AI features:
1. Check backend logs: `tail -f server/logs/error.log`
2. Check browser console for frontend errors
3. Verify API keys in environment variables
4. Test endpoints with Postman/curl
5. Check Gemini API quotas in Google Cloud Console

---

**Last Updated**: January 19, 2026
**Gemini Model**: gemini-2.5-flash
**Backend**: Node.js + Express
**Frontend**: React + TypeScript
