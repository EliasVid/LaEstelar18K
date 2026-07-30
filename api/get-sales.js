import { getRedisClient } from './_redis.js';

export default async function handler(req, res) {
    try {
        const redis = getRedisClient();

        const sales = await redis.lrange('sales:history', 0, -1);

        const parsedSales = sales.map(sale =>
            typeof sale === 'string'
                ? JSON.parse(sale)
                : sale
        );

        res.status(200).json(parsedSales);

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
}