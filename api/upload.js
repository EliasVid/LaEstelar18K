import formidable from "formidable";
import fs from "fs";
import crypto from "crypto";
import os from "os";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "./_r2.js";
import { verifyAdmin } from "./_auth.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ADMIN CHECK
  try {
    verifyAdmin(req);
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const form = formidable({
      multiples: false,
      keepExtensions: true,
      uploadDir: os.tmpdir(), // Fixes Vercel read-only file system crash
      maxFileSize: 10 * 1024 * 1024, // 10MB limit
    });

    // Bulletproof parsing (Works for both Formidable v2 and v3)
    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        resolve([fields, files]);
      });
    });

    // Handle formidable array structures safely
    const file = files.file?.[0] || files.file;

    if (!file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

    if (!allowedTypes.includes(file.mimetype)) {
      return res.status(400).json({ error: "Invalid file type." });
    }

    const extension = file.originalFilename.split(".").pop();
    const key = `${crypto.randomUUID()}.${extension}`;

    await r2.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        Body: fs.createReadStream(file.filepath),
        ContentType: file.mimetype,
      })
    );

    const url = `${process.env.R2_PUBLIC_URL}/${key}`;

    return res.status(200).json({
      url,
      pathname: key,
    });
  } catch (err) {
    console.error("Upload Error:", err);
    return res.status(500).json({
      error: err.message,
    });
  }
}