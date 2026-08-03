import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "./_r2.js";
import { getRedisClient } from "./_redis.js";

const INVENTORY_KEY = "data/inventory_master.json";
const TEJIDOS_KEY = "data/tejidos_master.json";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { name, laborCost, salePrice, materialsUsed } = request.body;

    if (!name || isNaN(laborCost) || isNaN(salePrice) || !materialsUsed || materialsUsed.length === 0) {
      return response.status(400).json({ error: "Faltan datos requeridos o materiales." });
    }

    const redis = getRedisClient();

    // 1. Fetch Inventory Metadata to get true costs
    let inventory = [];
    try {
      const result = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: INVENTORY_KEY }));
      inventory = JSON.parse(await result.Body.transformToString());
    } catch (err) {
      return response.status(500).json({ error: "No se pudo cargar el inventario maestro." });
    }

    // 2. Verify Stock and Calculate True Cost
    let totalMaterialCost = 0;
    const materialsLog = [];
    const keysToFetch = materialsUsed.map(m => `inv_stock:${m.id}`);
    const currentStocks = await redis.mget(keysToFetch);

    for (let i = 0; i < materialsUsed.length; i++) {
      const used = materialsUsed[i];
      const stockAvailable = parseInt(currentStocks[i] || 0, 10);
      
      if (used.qty > stockAvailable) {
        return response.status(400).json({ error: `Stock insuficiente para un insumo. Solo quedan ${stockAvailable}.` });
      }

      const invItem = inventory.find(item => item.id === used.id);
      if (!invItem) {
        return response.status(400).json({ error: "Insumo no encontrado en el inventario." });
      }

      totalMaterialCost += (invItem.costPrice * used.qty);
      materialsLog.push({
        id: invItem.id,
        name: invItem.name,
        qty: used.qty,
        unitCost: invItem.costPrice,
        totalCost: invItem.costPrice * used.qty
      });
    }

    const totalCost = totalMaterialCost + parseFloat(laborCost);

    // 3. Deduct Stock in Redis (Atomic Pipeline)
    const pipeline = redis.pipeline();
    materialsUsed.forEach(used => {
      pipeline.decrby(`inv_stock:${used.id}`, used.qty);
    });
    await pipeline.exec();

    // 4. Save the Tejido
    let tejidos = [];
    try {
      const result = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: TEJIDOS_KEY }));
      tejidos = JSON.parse(await result.Body.transformToString());
    } catch (err) {
      if (err.name !== "NoSuchKey" && err.Code !== "NoSuchKey" && err.$metadata?.httpStatusCode !== 404) throw err;
    }

    const newTejido = {
      id: Date.now().toString(),
      class: 'tejido',
      name: name.trim(),
      laborCost: parseFloat(laborCost),
      materialCost: totalMaterialCost,
      costPrice: totalCost,
      salePrice: parseFloat(salePrice),
      materials: materialsLog,
      sold: 0, // Starts as 0
      createdAt: new Date().toISOString()
    };

    tejidos.push(newTejido);

    await r2.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: TEJIDOS_KEY,
      Body: JSON.stringify(tejidos, null, 2),
      ContentType: "application/json",
    }));

    return response.status(200).json({ success: true, tejido: newTejido });

  } catch (error) {
    console.error("Backend Error in add-tejido:", error);
    return response.status(500).json({ error: error.message });
  }
}