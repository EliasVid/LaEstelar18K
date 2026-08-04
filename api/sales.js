import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "./_r2.js";
import { getRedisClient } from "./_redis.js";

const SALES_KEY = "data/sales_history.json";
const INVENTORY_KEY = "data/inventory_master.json";
const TEJIDOS_KEY = "data/tejidos_master.json"; // NUEVO: Para marcar tejidos como vendidos

export default async function handler(req, res) {
  // ==========================================
  // GET: Obtener historial de ventas
  // ==========================================
  if (req.method === "GET") {
    try {
      const result = await r2.send(
        new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: SALES_KEY })
      );
      const data = await result.Body.transformToString();
      return res.status(200).json(JSON.parse(data));
    } catch (e) {
      return res.status(200).json([]);
    }
  }

  // ==========================================
  // POST: Registrar una nueva venta
  // ==========================================
  else if (req.method === "POST") {
    try {
      const { cart, bags, totalRevenue, totalCost, totalProfit } = req.body;
      const redis = getRedisClient();

      // 1. REGISTRAR LA VENTA EN EL HISTORIAL
      let sales = [];
      try {
        const result = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: SALES_KEY }));
        sales = JSON.parse(await result.Body.transformToString());
      } catch (e) {} 

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

      // 2. DESCONTAR STOCK EN REDIS DE TODO (Incluyendo Tejidos)
      const pipeline = redis.pipeline();
      cart.forEach(item => {
        pipeline.decrby(`inv_stock:${item.id}`, item.qty);
      });
      await pipeline.exec();

      // 3. ACTUALIZAR EL CONTADOR 'SOLD' EN LOS ARCHIVOS
      let inventory = [];
      let invUpdated = false;
      try {
        const invRes = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: INVENTORY_KEY }));
        inventory = JSON.parse(await invRes.Body.transformToString());
      } catch (e) {}

      let tejidos = [];
      let tejUpdated = false;
      try {
        const tejRes = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: TEJIDOS_KEY }));
        tejidos = JSON.parse(await tejRes.Body.transformToString());
      } catch (e) {}

      cart.forEach(cartItem => {
        if (cartItem.class === 'tejido') {
          const match = tejidos.find(i => i.id === cartItem.id);
          if (match) { 
            match.sold = (match.sold || 0) + cartItem.qty; 
            tejUpdated = true; 
          }
        } else {
          const match = inventory.find(i => i.id === cartItem.id);
          if (match) { 
            match.sold = (match.sold || 0) + cartItem.qty; 
            invUpdated = true; 
          }
        }
      });

      if (invUpdated) {
        await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: INVENTORY_KEY, Body: JSON.stringify(inventory) }));
      }
      if (tejUpdated) {
        await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: TEJIDOS_KEY, Body: JSON.stringify(tejidos) }));
      }

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("Backend Error in POST sales:", error);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}