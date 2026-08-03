import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "./_r2.js";
import { getRedisClient } from "./_redis.js";

const INVENTORY_KEY = "data/inventory_master.json";
const TEJIDOS_KEY = "data/tejidos_master.json";
const TEJIDOS_URL = `${process.env.R2_PUBLIC_URL}/${TEJIDOS_KEY}`;

export default async function handler(req, res) {
  const redis = getRedisClient();

  if (req.method === "GET") {
    try {
      const fileResponse = await fetch(`${TEJIDOS_URL}?t=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' }});
      if (!fileResponse.ok) return res.status(200).json([]);
      
      const text = await fileResponse.text();
      if (!text) return res.status(200).json([]);

      const tejidosData = JSON.parse(text);
      if (!Array.isArray(tejidosData) || tejidosData.length === 0) return res.status(200).json([]);

      // HIDRATAR CON EL STOCK EN VIVO DE REDIS
      const keysToFetch = tejidosData.map(item => `inv_stock:${item.id}`);
      const stockValues = (await redis.mget(keysToFetch)) || [];

      const hydratedTejidos = tejidosData.map((item, index) => {
        const redisValue = stockValues[index];
        return { ...item, stock: redisValue !== null && redisValue !== undefined ? parseInt(redisValue, 10) : 0 };
      });

      return res.status(200).json(hydratedTejidos);

    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  else if (req.method === "POST") {
    try {
      const { name, laborCost, salePrice, materialsUsed } = req.body;
      if (!name || isNaN(laborCost) || isNaN(salePrice) || !materialsUsed || materialsUsed.length === 0) {
        return res.status(400).json({ error: "Faltan datos requeridos o materiales." });
      }

      let inventory = [];
      try {
        const result = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: INVENTORY_KEY }));
        inventory = JSON.parse(await result.Body.transformToString());
      } catch (err) {}

      let totalMaterialCost = 0;
      const materialsLog = [];
      const keysToFetch = materialsUsed.map(m => `inv_stock:${m.id}`);
      const currentStocks = await redis.mget(keysToFetch);

      for (let i = 0; i < materialsUsed.length; i++) {
        const used = materialsUsed[i];
        const stockAvailable = parseInt(currentStocks[i] || 0, 10);
        
        if (used.qty > stockAvailable) return res.status(400).json({ error: `Stock insuficiente para un insumo.` });

        const invItem = inventory.find(item => item.id === used.id);
        if (!invItem) return res.status(400).json({ error: "Insumo no encontrado." });

        totalMaterialCost += (invItem.costPrice * used.qty);
        materialsLog.push({ id: invItem.id, name: invItem.name, qty: used.qty, unitCost: invItem.costPrice, totalCost: invItem.costPrice * used.qty });
      }

      const pipeline = redis.pipeline();
      materialsUsed.forEach(used => pipeline.decrby(`inv_stock:${used.id}`, used.qty));
      await pipeline.exec();

      let tejidos = [];
      try {
        const result = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: TEJIDOS_KEY }));
        tejidos = JSON.parse(await result.Body.transformToString());
      } catch (err) {}

      const newId = Date.now().toString();
      const newTejido = {
        id: newId, class: 'tejido', name: name.trim(), laborCost: parseFloat(laborCost),
        materialCost: totalMaterialCost, costPrice: totalMaterialCost + parseFloat(laborCost),
        salePrice: parseFloat(salePrice), materials: materialsLog, sold: 0, createdAt: new Date().toISOString()
      };

      tejidos.push(newTejido);

      await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: TEJIDOS_KEY, Body: JSON.stringify(tejidos, null, 2), ContentType: "application/json" }));
      
      // NUEVO: ASIGNAR STOCK DE 1 EN REDIS AL TEJIDO CREADO
      await redis.set(`inv_stock:${newId}`, 1);

      return res.status(200).json({ success: true, tejido: newTejido });

    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}