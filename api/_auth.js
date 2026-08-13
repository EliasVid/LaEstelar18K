import jwt from "jsonwebtoken";

export function verifyAdmin(request) {
  // 1. Grab the Authorization header (Express/Vercel typically lowercases headers)
  const authHeader = request.headers.authorization || request.headers.Authorization;

  if (!authHeader) {
    throw new Error("No authorization header provided");
  }

  // 2. The header looks like "Bearer eyJhbGciOiJIUz...", so we split it by the space and grab the second part
  const token = authHeader.split(" ")[1];

  if (!token) {
    throw new Error("Malformed or missing token");
  }

  // 3. Verify the token against your secret
  const decoded = jwt.verify(token, process.env.JWT_SECRET);

  if (!decoded.isAdmin) {
    throw new Error("Not admin");
  }

  return decoded;
}