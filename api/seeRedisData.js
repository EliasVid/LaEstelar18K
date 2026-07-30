import { getRedisClient } from './_redis.js';

export default async function handler(req, res) {
  try {
    const redis = getRedisClient();

    let keys = [];
    let cursor = '0';

    do {
      const reply = await redis.scan(cursor, 'MATCH', '*', 'COUNT', 100);
      cursor = reply[0];
      keys.push(...reply[1]);
    } while (cursor !== '0' && keys.length < 500);

    if (keys.length === 0) {
      return res.status(200).json({
        message: "Database is completely empty.",
        data: []
      });
    }

    const result = [];

    for (const key of keys) {
      const type = await redis.type(key);

      let value;

      switch (type) {
        case 'string':
          value = await redis.get(key);
          break;

        case 'list':
          value = await redis.lrange(key, 0, -1);
          break;

        case 'hash':
          value = await redis.hgetall(key);
          break;

        case 'set':
          value = await redis.smembers(key);
          break;

        case 'zset':
          value = await redis.zrange(key, 0, -1, 'WITHSCORES');
          break;

        default:
          value = `[Unsupported type: ${type}]`;
      }

      result.push({
        key,
        type,
        value
      });
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error("Failed to read Redis data:", error);

    return res.status(500).json({
      error: "Redis Connection Error",
      message: error.message,
      stack: error.stack
    });
  }
}