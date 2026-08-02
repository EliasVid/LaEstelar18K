import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "./_r2.js";
import { getRedisClient } from "./_redis.js";

const INVENTORY_KEY = "data/inventory_master.json";

export default async function handler(request, response) {
  if (request.method !== "DELETE") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { id } = request.body;
    if (!id) {
      return response.status(400).json({ error: "ID de producto requerido." });
    }

    // 1. Fetch current inventory
    const result = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: INVENTORY_KEY }));
    const inventory = JSON.parse(await result.Body.transformToString());

    // 2. Filter out the item to be deleted
    const newInventory = inventory.filter(item => item.id !== id);

    // 3. Save the cleaned inventory back to R2
    await r2.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: INVENTORY_KEY,
      Body: JSON.stringify(newInventory, null, 2),
      ContentType: "application/json",
    }));

    // 4. Delete the live stock from Redis
    const redis = getRedisClient();
    await redis.del(`inv_stock:${id}`);

    return response.status(200).json({ success: true });

  } catch (error) {
    console.error("Backend Error in delete-inventory:", error);
    return response.status(500).json({ error: error.message });
  }
}