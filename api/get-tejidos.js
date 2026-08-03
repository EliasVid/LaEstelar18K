import { GetObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "./_r2.js";

const TEJIDOS_URL = `${process.env.R2_PUBLIC_URL}/data/tejidos_master.json`;

export default async function handler(request, response) {
  try {
    const fileResponse = await fetch(`${TEJIDOS_URL}?t=${Date.now()}`, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
    
    if (!fileResponse.ok) {
      return response.status(200).json([]);
    }
    
    const text = await fileResponse.text();
    if (!text) {
      return response.status(200).json([]);
    }

    const tejidosData = JSON.parse(text);

    if (!Array.isArray(tejidosData) || tejidosData.length === 0) {
      return response.status(200).json([]);
    }

    // Filter out Tejidos that have already been completely sold (if you implement stock limits on them later)
    // For now, we return all of them to be available in the POS
    return response.status(200).json(tejidosData);

  } catch (error) {
    console.error("Backend Error in get-tejidos:", error);
    return response.status(500).json({ error: error.message });
  }
}