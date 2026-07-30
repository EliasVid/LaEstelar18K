// api/_redis.js (or lib/redis.js)
import Redis from 'ioredis';

// Reuse the connection across serverless invocations if it exists
let redisClient;

export function getRedisClient() {
  if (!redisClient) {
    const connectionString = process.env.REDIS_URL;
    if (!connectionString) {
      throw new Error("Missing REQUIRED environment variable: REDIS_URL");
    }
    redisClient = new Redis(connectionString);
  }
  return redisClient;
}