import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "./_r2.js";
import { getRedisClient } from "./_redis.js";

const INVENTORY_KEY = "data/inventory_master.json";

export default async function handler(req, res) {
  const redis = getRedisClient();

  // ==========================================
  // GET: Obtener Inventario (Hydrated with Redis Stock)
  // ==========================================
  if (req.method === "GET") {
    try {
      const INVENTORY_URL = `${process.env.R2_PUBLIC_URL}/${INVENTORY_KEY}`;
      
      const fileResponse = await fetch(`${INVENTORY_URL}?t=${Date.now()}`, {
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' }
      });
      
      if (!fileResponse.ok) return res.status(200).json([]);
      
      const text = await fileResponse.text();
      if (!text) return res.status(200).json([]);

      const inventoryData = JSON.parse(text);
      if (!Array.isArray(inventoryData) || inventoryData.length === 0) return res.status(200).json([]);

      const keysToFetch = inventoryData.map(item => `inv_stock:${item.id}`);
      const stockValues = (await redis.mget(keysToFetch)) || [];

      const hydratedInventory = inventoryData.map((item, index) => {
        const redisValue = stockValues[index];
        return { 
          ...item, 
          stock: redisValue !== null && redisValue !== undefined ? parseInt(redisValue, 10) : (item.stock || 0) 
        };
      });

      return res.status(200).json(hydratedInventory);
    } catch (error) {
      console.error("Backend Error in GET inventory:", error);
      return res.status(500).json({ error: error.message });
    }
  }

  // ==========================================
  // POST: Registrar Ingreso / Actualizar Stock Inicial
  // ==========================================
  else if (req.method === "POST") {
    try {
      const { class: itemClass, name, stock, costPrice, salePrice, type, material, size, image } = req.body;

      if (!name || isNaN(costPrice) || isNaN(salePrice)) {
        return res.status(400).json({ error: "Faltan datos requeridos o precios inválidos." });
      }

      let inventory = [];
      try {
        const result = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: INVENTORY_KEY }));
        const body = await result.Body.transformToString();
        inventory = JSON.parse(body);
      } catch (err) {
        if (err.name !== "NoSuchKey" && err.Code !== "NoSuchKey" && err.$metadata?.httpStatusCode !== 404) throw err;
      }

      const parsedStock = parseInt(stock, 10);
      const currentDate = new Date().toISOString();

      if (itemClass === 'material') {
        const existingIndex = inventory.findIndex(item => item.class === 'material' && item.name === name.trim());
        if (existingIndex > -1) {
          const newTotal = await redis.incrby(`inv_stock:${inventory[existingIndex].id}`, parsedStock);
          
          inventory[existingIndex].stock = newTotal;
          inventory[existingIndex].costPrice = parseFloat(costPrice);
          inventory[existingIndex].salePrice = parseFloat(salePrice);
          if (!inventory[existingIndex].history) inventory[existingIndex].history = [];
          
          inventory[existingIndex].history.push({ date: currentDate, added: parsedStock, totalAfter: newTotal });
          await r2.send(new PutObjectCommand({
            Bucket: process.env.R2_BUCKET, Key: INVENTORY_KEY,
            Body: JSON.stringify(inventory, null, 2), ContentType: "application/json",
          }));
          return res.status(200).json({ success: true, item: inventory[existingIndex], updated: true });
        }
      }

      const newId = Date.now().toString();
      const newItem = {
        id: newId, class: itemClass, material: material.trim(), name: name.trim(), type: type,
        stock: parsedStock,
        costPrice: parseFloat(costPrice), salePrice: parseFloat(salePrice),
        sold: 0, createdAt: currentDate
      };

      if (itemClass === 'material') {
        newItem.size = size;
        newItem.history = [{ date: currentDate, added: parsedStock, totalAfter: parsedStock }];
      } else if (itemClass === 'product') {
        if (image) newItem.image = image;
      }

      inventory.push(newItem);

      await r2.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET, Key: INVENTORY_KEY,
        Body: JSON.stringify(inventory, null, 2), ContentType: "application/json",
      }));

      await redis.set(`inv_stock:${newId}`, isNaN(parsedStock) ? 0 : parsedStock);

      return res.status(200).json({ success: true, item: newItem, updated: false });
    } catch (error) {
      console.error("Backend Error in POST inventory:", error);
      return res.status(500).json({ error: error.message });
    }
  }

  // ==========================================
  // PUT: Editar Costo, Venta, Material o Re-Ingresar Stock
  // ==========================================
  else if (req.method === "PUT") {
    try {
      const { id, stock, costPrice, salePrice, material } = req.body;
      if (!id || isNaN(costPrice) || isNaN(salePrice) || isNaN(stock)) {
        return res.status(400).json({ error: "Datos incompletos." });
      }

      const result = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: INVENTORY_KEY }));
      const inventory = JSON.parse(await result.Body.transformToString());
      
      const itemIndex = inventory.findIndex(item => item.id === id);
      if (itemIndex === -1) return res.status(404).json({ error: "Producto no encontrado" });

      const parsedStock = parseInt(stock, 10);
      
      const currentStockStr = await redis.get(`inv_stock:${id}`);
      const currentStock = currentStockStr !== null ? parseInt(currentStockStr, 10) : (inventory[itemIndex].stock || 0);
      const stockDiff = parsedStock - currentStock;

      inventory[itemIndex].stock = parsedStock; 
      inventory[itemIndex].costPrice = parseFloat(costPrice);
      inventory[itemIndex].salePrice = parseFloat(salePrice);
      
      // Update material if provided
      if (material) {
        inventory[itemIndex].material = material.trim();
      }
      
      if (stockDiff !== 0 && inventory[itemIndex].class === 'material') {
        if (!inventory[itemIndex].history) inventory[itemIndex].history = [];
        inventory[itemIndex].history.push({
            date: new Date().toISOString(),
            added: stockDiff,
            totalAfter: parsedStock
        });
      }

      await r2.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET, Key: INVENTORY_KEY,
        Body: JSON.stringify(inventory, null, 2), ContentType: "application/json",
      }));

      await redis.set(`inv_stock:${id}`, parsedStock);

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("Backend Error in PUT inventory:", error);
      return res.status(500).json({ error: error.message });
    }
  }

  // ==========================================
  // DELETE: Eliminar Elemento
  // ==========================================
  else if (req.method === "DELETE") {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "ID de producto requerido." });

      const result = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: INVENTORY_KEY }));
      const inventory = JSON.parse(await result.Body.transformToString());

      const newInventory = inventory.filter(item => item.id !== id);

      await r2.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET, Key: INVENTORY_KEY,
        Body: JSON.stringify(newInventory, null, 2), ContentType: "application/json",
      }));

      await redis.del(`inv_stock:${id}`);

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("Backend Error in DELETE inventory:", error);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}