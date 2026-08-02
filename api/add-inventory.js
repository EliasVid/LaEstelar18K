import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "./_r2.js";
import { getRedisClient } from "./_redis.js";

const INVENTORY_KEY = "data/inventory_master.json";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { class: itemClass, name, stock, costPrice, salePrice, type, material, size, image } = request.body;

    if (!name || isNaN(costPrice) || isNaN(salePrice)) {
      return response.status(400).json({ error: "Faltan datos requeridos o precios inválidos." });
    }

    let inventory = [];
    try {
      const result = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: INVENTORY_KEY }));
      const body = await result.Body.transformToString();
      inventory = JSON.parse(body);
    } catch (err) {
      if (err.name !== "NoSuchKey" && err.Code !== "NoSuchKey" && err.$metadata?.httpStatusCode !== 404) throw err;
    }

    const redis = getRedisClient();
    const parsedStock = parseInt(stock, 10);
    const currentDate = new Date().toISOString();

    // ---------------------------------------------------------
    // SMART STACKING (Insumos)
    // ---------------------------------------------------------
    if (itemClass === 'material') {
      const existingIndex = inventory.findIndex(item => item.class === 'material' && item.name === name.trim());

      if (existingIndex > -1) {
        // 1. ADD to existing stock in Redis FIRST to get the new exact total
        const newTotal = await redis.incrby(`inv_stock:${inventory[existingIndex].id}`, parsedStock);

        // 2. Update Prices
        inventory[existingIndex].costPrice = parseFloat(costPrice);
        inventory[existingIndex].salePrice = parseFloat(salePrice);
        
        if (!inventory[existingIndex].history) {
          inventory[existingIndex].history = [];
        }
        
        // 3. Log this addition with the new total
        inventory[existingIndex].history.push({
          date: currentDate,
          added: parsedStock,
          totalAfter: newTotal // NEW: Captures the total at this specific moment
        });

        // 4. Save metadata to R2
        await r2.send(new PutObjectCommand({
          Bucket: process.env.R2_BUCKET, Key: INVENTORY_KEY,
          Body: JSON.stringify(inventory, null, 2), ContentType: "application/json",
        }));

        return response.status(200).json({ success: true, item: inventory[existingIndex], updated: true });
      }
    }

    // ---------------------------------------------------------
    // CREATE NEW ITEM
    // ---------------------------------------------------------
    const newId = Date.now().toString();
    const newItem = {
      id: newId,
      class: itemClass,
      name: name.trim(),
      type: type,
      costPrice: parseFloat(costPrice),
      salePrice: parseFloat(salePrice),
      sold: 0,
      createdAt: currentDate
    };

    if (itemClass === 'material') {
      newItem.material = material;
      newItem.size = size;
      // Start the history log with the initial stock as the total
      newItem.history = [{ date: currentDate, added: parsedStock, totalAfter: parsedStock }];
    } else if (itemClass === 'product' && image) {
      newItem.image = image;
    }

    inventory.push(newItem);

    await r2.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET, Key: INVENTORY_KEY,
      Body: JSON.stringify(inventory, null, 2), ContentType: "application/json",
    }));

    await redis.set(`inv_stock:${newId}`, isNaN(parsedStock) ? 0 : parsedStock);

    return response.status(200).json({ success: true, item: newItem, updated: false });

  } catch (error) {
    console.error("Backend Error in add-inventory:", error);
    return response.status(500).json({ error: error.message });
  }
}