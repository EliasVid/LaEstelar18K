import jwt from "jsonwebtoken";

export function verifyAdmin(request) {
  const cookieHeader = request.headers.cookie;

  if (!cookieHeader) {
    throw new Error("No cookie");
  }

  // Find adminToken in cookies
  const cookies = Object.fromEntries(
    cookieHeader.split(";").map(c => {
      const [key, ...v] = c.trim().split("=");
      return [key, v.join("=")];
    })
  );

  const token = cookies.adminToken;

  if (!token) {
    throw new Error("No token");
  }

  const decoded = jwt.verify(token, process.env.JWT_SECRET);

  if (!decoded.isAdmin) {
    throw new Error("Not admin");
  }

  return decoded;
}