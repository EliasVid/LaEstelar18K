import { getRedisClient } from './_redis.js';
import { verifyAdmin } from './_auth.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

  // ADMIN CHECK
  try {
    verifyAdmin(request);
  } catch {
    return response.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { productId, color, size } = request.body;

    if (!productId || !color || !size) {
      return response.status(400).json({ error: 'Faltan parámetros requeridos.' });
    }

    const redis = getRedisClient();
    const redisKey = `stock:${productId}:${color.toLowerCase()}:${size}`;

    const currentStockStr = await redis.get(redisKey);

    if (currentStockStr === null) {
      return response.status(404).json({ error: 'La variante no está registrada en Redis.' });
    }

    const currentStock = parseInt(currentStockStr, 10);

    if (currentStock <= 0) {
      return response.status(400).json({ error: 'No hay stock disponible para esta variante.' });
    }

    const newStock = await redis.decr(redisKey);

    const saleRecord = {
      timestamp: new Date().toLocaleTimeString('es-CO', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }),
      date: new Date().toISOString().split('T')[0],
      productId,
      name: request.body.productName || 'Prenda Básica',
      variantStr: `Talla ${size} - Color ${color}`,
      price: parseFloat(request.body.price) || 0
    };

    await redis.lpush('sales:history', JSON.stringify(saleRecord));

    return response.status(200).json({
      success: true,
      newStock
    });

  } catch (error) {
    console.error("Error running register-sale:", error);
    return response.status(500).json({ error: error.message });
  }
}