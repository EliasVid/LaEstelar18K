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
      name,
      price,
      description,
      imageUrl,
      category,
      colors,
      variants,
      images,
    } = request.body;

    // STRICT BACKEND VALIDATION ENGINE
    if (!name || typeof name !== "string" || name.trim() === "") {
      return response
        .status(400)
        .json({ error: "El nombre del producto es requerido y debe ser un texto válido." });
    }

    const parsedPrice = parseFloat(price);
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      return response
        .status(400)
        .json({ error: "El precio debe ser un número válido mayor que cero." });
    }

    if (!category || typeof category !== "string" || category.trim() === "") {
      return response
        .status(400)
        .json({ error: "La categoría es requerida." });
    }

    if (!variants || !Array.isArray(variants) || variants.length === 0) {
      return response
        .status(400)
        .json({ error: "El producto debe tener al menos una variante configurada." });
    }

    if (!imageUrl || !images || images.length === 0) {
      return response
        .status(400)
        .json({ error: "El producto requiere al menos una imagen de catálogo válida." });
    }

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
        err.name !== "NoSuchKey" &&
        err.Code !== "NoSuchKey" &&
        err.$metadata?.httpStatusCode !== 404
      ) {
        throw err;
      }
    }

    const newProductId = Date.now().toString();
    const redis = getRedisClient();

    // Save stock in Redis without size: stock:{productId}:{color}
    const pipeline = redis.pipeline();

    variants.forEach((v) => {
      if (v.color) {
        const redisKey = `stock:${newProductId}:${v.color.toLowerCase()}`;
        const parsedStock = parseInt(v.stock, 10);

        pipeline.set(redisKey, isNaN(parsedStock) ? 0 : parsedStock);
      }
    });

    await pipeline.exec();

    // Save only color in catalog variants
    const cleanVariantsForBlob = variants.map((v) => ({
      color: v.color,
    }));

    const newProduct = {
      id: newProductId,
      name: name.trim(),
      price: parsedPrice,
      description: description ? description.trim() : "",
      image: imageUrl,
      images: Array.isArray(images) ? images : [imageUrl],
      category: category.trim(),
      colors: Array.isArray(colors) ? colors : [],
      variants: cleanVariantsForBlob,
    };

    catalog.push(newProduct);

    // Upload updated catalog to R2
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
      product: newProduct,
    });
  } catch (error) {
    console.error("Backend Error in add-product:", error);
    return response.status(500).json({
      error: error.message,
    });
  }
}