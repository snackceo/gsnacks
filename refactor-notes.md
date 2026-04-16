### 3. Modify Order Creation Logic

As per your requirements, stock should only be decremented *after* a successful payment. I'll remove the stock decrement logic from the `addOrderItems` function in `c:\Users\yohra\Gsnacks\gsnacks\orderController.js`. The webhook will now be responsible for this.

```diff
--- a/c:\Users\yohra\Gsnacks\gsnacks\orderController.js
+++ b/c:\Users\yohra\Gsnacks\gsnacks\orderController.js
@@ -38,13 +38,6 @@
 
   const createdOrder = await order.save();
 
-  // --- Decrement Stock ---
-  for (const item of createdOrder.orderItems) {
-    await Product.findByIdAndUpdate(item.product, {
-      $inc: { stock: -item.quantity },
-    });
-  }
-
   res.status(201).json({ success: true, data: createdOrder });
 });
 
```