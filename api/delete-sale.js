import { getRedisClient } from './_redis.js';
import { verifyAdmin } from './_auth.js';

export default async function handler(request, response) {
  // 1. Only allow POST requests
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

  // 2. Strict Security Admin Check
  try {
    verifyAdmin(request);
  } catch {
    return response.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { index } = request.body;

    if (index === undefined || isNaN(parseInt(index, 10))) {
      return response.status(400).json({ error: 'El índice de la venta es requerido.' });
    }

    const redis = getRedisClient();
    const targetIdx = parseInt(index, 10);

    // 3. Get the exact item at that index array position from the Redis List
    // LINDEX returns the element at index inside the list
    const exactSaleString = await redis.lindex('sales:history', targetIdx);

    if (!exactSaleString) {
      return response.status(404).json({ error: 'No se encontró el registro de venta en la base de datos.' });
    }

    // 4. Delete the exact matched string from the list using LREM
    // LREM key count value (count = 1 means remove the first occurrence matching this value)
    await redis.lrem('sales:history', 1, exactSaleString);

    return response.status(200).json({ success: true, message: 'Registro de venta eliminado correctamente.' });

  } catch (error) {
    console.error('Backend Error in delete-sale:', error);
    return response.status(500).json({ error: error.message });
  }
}