import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { r2 } from "./_r2.js";
import { getRedisClient } from "./_redis.js";
import { verifyAdmin } from "./_auth.js";

const CATALOG_KEY = "data/data_catalog.json";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  // ADMIN CHECK
  try {
    verifyAdmin(request);
  } catch {
    return response.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { id } = request.body;

    if (!id) {
      return response.status(400).json({
        error: "Missing product ID parameters",
      });
    }

    // Read catalog from R2
    let catalog = [];

    try {
      const result = await r2.send(
        new GetObjectCommand({
          Bucket: process.env.R2_BUCKET,
          Key: CATALOG_KEY,
        })
      );

      const body = await result.Body.transformToString();
      catalog = JSON.parse(body);

    } catch (err) {
      if (
        err.name === "NoSuchKey" ||
        err.Code === "NoSuchKey" ||
        err.$metadata?.httpStatusCode === 404
      ) {
        return response.status(404).json({
          error: "Catalog data archive empty",
        });
      }

      throw err;
    }

    const targetProduct = catalog.find((product) => product.id === id);

    if (!targetProduct) {
      return response.status(404).json({
        error: "Product not found in current inventory dataset",
      });
    }

    // Delete stock from Redis
    if (targetProduct.variants && Array.isArray(targetProduct.variants)) {
      const redis = getRedisClient();
      const pipeline = redis.multi();

      targetProduct.variants.forEach((variant) => {
        if (variant.color && variant.size) {
          pipeline.del(
            `stock:${id}:${variant.color.toLowerCase()}:${variant.size}`
          );
        }
      });

      await pipeline.exec();
    }

    // Delete images from R2
    if (Array.isArray(targetProduct.images)) {
      for (const imageUrl of targetProduct.images) {
        try {
          const url = new URL(imageUrl);

          // Remove leading slash
          const key = url.pathname.substring(1);

          await r2.send(
            new DeleteObjectCommand({
              Bucket: process.env.R2_BUCKET,
              Key: key,
            })
          );

          console.log(`Deleted image: ${key}`);
        } catch (err) {
          console.warn(`Couldn't delete image ${imageUrl}:`, err.message);
        }
      }
    }

    // Delete old "image" field too if it isn't in images[]
    if (
      targetProduct.image &&
      (!targetProduct.images ||
        !targetProduct.images.includes(targetProduct.image))
    ) {
      try {
        const url = new URL(targetProduct.image);
        const key = url.pathname.substring(1);

        await r2.send(
          new DeleteObjectCommand({
            Bucket: process.env.R2_BUCKET,
            Key: key,
          })
        );

        console.log(`Deleted image: ${key}`);
      } catch (err) {
        console.warn(err.message);
      }
    }

    // Remove product from catalog
    catalog = catalog.filter((product) => product.id !== id);

    // Save updated catalog
    await r2.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: CATALOG_KEY,
        Body: JSON.stringify(catalog, null, 2),
        ContentType: "application/json",
      })
    );

    return response.status(200).json({
      success: true,
      message: "Product and images deleted successfully",
    });

  } catch (error) {
    console.error("Delete product error:", error);

    return response.status(500).json({
      error: error.message,
    });
  }
}