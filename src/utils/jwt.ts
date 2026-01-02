import jwt from "jsonwebtoken";
import { config } from "../config";
import crypto from "crypto";
import { logger } from "./sharedLogger";

import type { ForgeType } from "../db/schema";

/**
 * Payload for Keyway JWT tokens
 */
export interface KeywayTokenPayload {
  userId: string;
  forgeType: ForgeType;
  forgeUserId: string;
  username: string;
}

/**
 * Generate a Keyway JWT access token
 */
export function generateKeywayToken(payload: KeywayTokenPayload): string {
  logger.debug({ username: payload.username, userId: payload.userId }, "Generating JWT token");

  const token = jwt.sign(payload, config.jwt.secret, {
    algorithm: "HS256",
    expiresIn: config.jwt.accessTokenExpiresIn,
    issuer: "keyway-api",
    subject: payload.userId,
  });

  logger.debug({ username: payload.username }, "JWT token generated");

  return token;
}

/**
 * Generate a secure refresh token (opaque token, not JWT)
 * Returns a cryptographically random string
 */
export function generateRefreshToken(): string {
  return crypto.randomBytes(64).toString("base64url");
}

/**
 * Calculate refresh token expiration date
 */
export function getRefreshTokenExpiresAt(): Date {
  const expiresInDays = parseInt(config.jwt.refreshTokenExpiresIn);
  return new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
}

/**
 * Verify and decode a Keyway JWT token
 * @throws Error if token is invalid or expired
 */
export function verifyKeywayToken(token: string): KeywayTokenPayload {
  logger.debug("Verifying JWT token");

  try {
    const decoded = jwt.verify(token, config.jwt.secret, {
      algorithms: ["HS256"],
      issuer: "keyway-api",
    }) as jwt.JwtPayload;

    logger.debug({ username: decoded.username }, "JWT token verified successfully");

    return {
      userId: decoded.sub as string,
      forgeType: decoded.forgeType as ForgeType,
      forgeUserId: decoded.forgeUserId as string,
      username: decoded.username as string,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    logger.debug({ error: errorMsg }, "JWT token verification failed");

    if (error instanceof jwt.TokenExpiredError) {
      throw new Error("Token expired");
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error("Invalid token");
    }
    throw error;
  }
}

/**
 * Get token expiration date
 */
export function getTokenExpiresAt(token: string): Date {
  const decoded = jwt.decode(token) as jwt.JwtPayload;
  if (!decoded || !decoded.exp) {
    throw new Error("Invalid token: no expiration");
  }
  return new Date(decoded.exp * 1000);
}
