import { getRedisClient } from './_redis.js';
import { verifyAdmin } from './_auth.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

  // ADMIN CHECK
  try {
    verifyAdmin(request);
  } catch {
    return response.status(401).json({ error: "Unauthorized" });
  }

  try {
    const redis = getRedisClient();

    const sales = await redis.lrange('sales:history', 0, 49);

    const parsedSales = sales.map(item =>
      typeof item === 'string' ? JSON.parse(item) : item
    );

    return response.status(200).json(parsedSales);

  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
}