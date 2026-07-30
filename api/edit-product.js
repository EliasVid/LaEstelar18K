import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
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
    const {
      id,
      name,
      price,
      description,
      imageUrl,
      category,
      sizes,
      colors,
      variants,
      images,
    } = request.body;

    // Load catalog from R2
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
          error: "Catalog file not found",
        });
      }

      throw err;
    }

    const productIndex = catalog.findIndex((p) => p.id === id);

    if (productIndex === -1) {
      return response.status(404).json({
        error: "Product not found",
      });
    }

    const finalImageUrl = imageUrl || catalog[productIndex].image;

    const finalImagesArray =
      images && images.length > 0
        ? images
        : catalog[productIndex].images;

    catalog[productIndex] = {
      ...catalog[productIndex],
      name,
      price: parseFloat(price),
      description: description || "",
      image: finalImageUrl,
      images: finalImagesArray || (finalImageUrl ? [finalImageUrl] : []),
      category,
      sizes: sizes || [],
      colors: colors || [],
      variants: variants || [],
    };

    // Save catalog back to R2
    await r2.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: CATALOG_KEY,
        Body: JSON.stringify(catalog, null, 2),
        ContentType: "application/json",
      })
    );

    // Update Redis stock
    if (variants && Array.isArray(variants)) {
      const redis = getRedisClient();
      const pipeline = redis.multi();

      variants.forEach((variant) => {
        if (variant.color && variant.size) {
          const redisKey = `stock:${id}:${variant.color.toLowerCase()}:${variant.size}`;

          const stockValue = parseInt(variant.stock, 10) || 0;

          pipeline.set(redisKey, stockValue);
        }
      });

      await pipeline.exec();
    }

    return response.status(200).json({
      success: true,
      product: catalog[productIndex],
    });

  } catch (error) {
    console.error("Error executing edit-product sync pipeline:", error);

    return response.status(500).json({
      error: error.message,
    });
  }
}