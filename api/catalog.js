import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "./_r2.js";
import { verifyAdmin } from "./_auth.js";

const CATALOG_KEY = "data/data_catalog.json";
const CATALOG_URL = `${process.env.R2_PUBLIC_URL}/${CATALOG_KEY}`;

export default async function handler(req, res) {
  // ==========================================
  // GET: Fetch Catalog (Public)
  // ==========================================
  if (req.method === "GET") {
    try {
      const fileRes = await fetch(`${CATALOG_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (!fileRes.ok) return res.status(200).json([]);
      const text = await fileRes.text();
      if (!text) return res.status(200).json([]);
      return res.status(200).json(JSON.parse(text));
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // ADMIN CHECK
  try {
    verifyAdmin(req);
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const getCatalog = async () => {
    try {
      const result = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: CATALOG_KEY }));
      return JSON.parse(await result.Body.transformToString());
    } catch (err) { return []; }
  };

  const saveCatalog = async (catalogData) => {
    await r2.send(new PutObjectCommand({ 
      Bucket: process.env.R2_BUCKET, Key: CATALOG_KEY, 
      Body: JSON.stringify(catalogData, null, 2), ContentType: "application/json" 
    }));
  };

  // ==========================================
  // POST: Add Product
  // ==========================================
  if (req.method === "POST") {
    try {
      const { name, type, price, description, category, colors, sizes, images } = req.body;

      if (!name) return res.status(400).json({ error: "Nombre requerido." });
      if (!type) return res.status(400).json({ error: "Tipo de joya requerido." });
      const parsedPrice = parseFloat(price);
      if (isNaN(parsedPrice) || parsedPrice <= 0) return res.status(400).json({ error: "Precio inválido." });
      if (!category) return res.status(400).json({ error: "Categoría requerida." });
      if (!images || images.length === 0) return res.status(400).json({ error: "Imagen requerida." });

      const catalog = await getCatalog();

      const newProduct = {
        id: Date.now().toString(),
        name: name.trim(),
        type: type.trim(), // Nuevo campo
        price: parsedPrice,
        description: description ? description.trim() : "",
        category: category.trim(),
        colors: Array.isArray(colors) ? colors : [],
        sizes: Array.isArray(sizes) ? sizes : [], // Nuevo array de tallas
        image: images[0],
        images: images,
      };

      catalog.push(newProduct);
      await saveCatalog(catalog);

      return res.status(200).json({ success: true, product: newProduct });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // ==========================================
  // PUT: Edit Product
  // ==========================================
  else if (req.method === "PUT") {
    try {
      const { id, name, type, price, description, category, colors, sizes, images } = req.body;
      const catalog = await getCatalog();
      const index = catalog.findIndex((p) => p.id === id);

      if (index === -1) return res.status(404).json({ error: "Product not found" });

      const finalImages = (images && images.length > 0) ? images : catalog[index].images;

      catalog[index] = {
        ...catalog[index],
        name: name.trim(),
        type: type.trim(),
        price: parseFloat(price),
        description: description || "",
        category: category.trim(),
        colors: Array.isArray(colors) ? colors : [],
        sizes: Array.isArray(sizes) ? sizes : [],
        image: finalImages[0],
        images: finalImages,
      };

      await saveCatalog(catalog);
      return res.status(200).json({ success: true, product: catalog[index] });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // ==========================================
  // DELETE: Remove Product
  // ==========================================
  else if (req.method === "DELETE") {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "ID requerido." });

      const catalog = await getCatalog();
      const newCatalog = catalog.filter(p => p.id !== id);
      
      await saveCatalog(newCatalog);
      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}