import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
// Notice: We completely removed the 'cookie' import

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { password } = req.body;

  // hashed version of your admin password
  const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;

  const passwordOk = await bcrypt.compare(
    password,
    ADMIN_PASSWORD_HASH
  );

  if (!passwordOk) {
    return res.status(401).json({ error: "Wrong password" });
  }

  const token = jwt.sign(
    { isAdmin: true },
    process.env.JWT_SECRET,
    { expiresIn: "2h" }
  );

  // Build the cookie string manually (7200 seconds = 2 hours)
  const isProd = process.env.NODE_ENV === "production";
  const cookieString = `adminToken=${token}; HttpOnly; ${isProd ? 'Secure; ' : ''}SameSite=Strict; Path=/; Max-Age=7200`;

  res.setHeader("Set-Cookie", cookieString);

  res.status(200).json({ success: true });
}