const crypto = require("crypto");

const TOKEN_PREFIX = "enc:v1:";

function getKey() {
  const secret = process.env.TOKEN_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("TOKEN_ENCRYPTION_KEY ou SESSION_SECRET precisa estar definido.");
  }

  return crypto.createHash("sha256").update(secret).digest();
}

function encryptToken(token) {
  if (!token) return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(String(token), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    TOKEN_PREFIX,
    iv.toString("base64url"),
    ".",
    tag.toString("base64url"),
    ".",
    encrypted.toString("base64url"),
  ].join("");
}

function decryptToken(value) {
  if (!value) return null;

  const token = String(value);
  if (!token.startsWith(TOKEN_PREFIX)) {
    return token;
  }

  const payload = token.slice(TOKEN_PREFIX.length);
  const [ivEncoded, tagEncoded, encryptedEncoded] = payload.split(".");

  if (!ivEncoded || !tagEncoded || !encryptedEncoded) {
    return null;
  }

  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      getKey(),
      Buffer.from(ivEncoded, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(encryptedEncoded, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (err) {
    return null;
  }
}

module.exports = {
  decryptToken,
  encryptToken,
};
