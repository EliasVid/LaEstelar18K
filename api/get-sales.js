import { GetObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "./_r2.js";

export default async function handler(req, res) {
  try {
    const result = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: "data/sales_history.json" }));
    return res.status(200).json(JSON.parse(await result.Body.transformToString()));
  } catch (e) {
    // If file doesn't exist, return empty array
    return res.status(200).json([]);
  }
}