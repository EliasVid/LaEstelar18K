import { getRedisClient } from './_redis.js';

// We use fetch for reading from R2 as it is faster and uses less serverless memory
const INVENTORY_URL = `${process.env.R2_PUBLIC_URL}/data/inventory_master.json`;

export default async function handler(request, response) {
  try {
    // 1. Fetch metadata from R2
    const fileResponse = await fetch(`${INVENTORY_URL}?t=${Date.now()}`, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
    
    if (fileResponse.status === 404) {
      return response.status(200).json([]);
    }
    
    let inventoryData = await fileResponse.json();
    if (!Array.isArray(inventoryData) || inventoryData.length === 0) {
      return response.status(200).json([]);
    }

    const redis = getRedisClient();

    // 2. Gather all keys to fetch stock from Redis
    const keysToFetch = inventoryData.map(item => `inv_stock:${item.id}`);

    // 3. Fetch all stock values in one quick blast
    const stockValues = (await redis.mget(keysToFetch)) || [];

    // 4. Hydrate the JSON with real-time stock
    const hydratedInventory = inventoryData.map((item, index) => {
      const redisValue = stockValues[index];
      return { 
        ...item, 
        stock: redisValue !== null && redisValue !== undefined ? parseInt(redisValue, 10) : 0 
      };
    });

    return response.status(200).json(hydratedInventory);

  } catch (error) {
    console.error("Backend Error in get-inventory:", error);
    return response.status(500).json({ error: error.message });
  }
}