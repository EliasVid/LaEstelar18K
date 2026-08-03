import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "./_r2.js";
import { getRedisClient } from "./_redis.js";

const SALES_KEY = "data/sales_history.json";
const INVENTORY_KEY = "data/inventory_master.json";
const TEJIDOS_KEY = "data/tejidos_master.json";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { cart, bags, totalRevenue, totalCost, totalProfit } = req.body;
    const redis = getRedisClient();

    // 1. LOG THE SALE IN THE LEDGER
    let sales = [];
    try {
      const result = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: SALES_KEY }));
      sales = JSON.parse(await result.Body.transformToString());
    } catch (e) {} // File might not exist yet

    const newSale = {
      id: "sale_" + Date.now().toString(),
      date: new Date().toISOString(),
      cart, bags, totalRevenue, totalCost, totalProfit
    };
    
    sales.push(newSale);
    
    await r2.send(new PutObjectCommand({ 
      Bucket: process.env.R2_BUCKET, Key: SALES_KEY, 
      Body: JSON.stringify(sales, null, 2), ContentType: "application/json" 
    }));

    // 2. DEDUCT REDIS STOCK (For Products & Materials)
    const pipeline = redis.pipeline();
    cart.forEach(item => {
      if (item.class !== 'tejido') {
        pipeline.decrby(`inv_stock:${item.id}`, item.qty);
      }
    });
    await pipeline.exec();

    // 3. UPDATE THE 'SOLD' COUNTER IN MASTER INVENTORY
    try {
      const invRes = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: INVENTORY_KEY }));
      const inventory = JSON.parse(await invRes.Body.transformToString());
      let invUpdated = false;

      cart.forEach(cartItem => {
        const match = inventory.find(i => i.id === cartItem.id);
        if (match) { match.sold = (match.sold || 0) + cartItem.qty; invUpdated = true; }
      });

      if (invUpdated) {
        await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: INVENTORY_KEY, Body: JSON.stringify(inventory) }));
      }
    } catch (e) { console.error("Error updating inventory sold counter", e); }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Backend Error in register-sale:", error);
    return res.status(500).json({ error: error.message });
  }
}