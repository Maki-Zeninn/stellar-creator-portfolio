import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import jwt from 'jsonwebtoken';
import { hashApiKey } from '@/lib/api-keys';

export interface GraphQLContext {
  req: NextRequest;
  userId?: string;
  apiKeyId?: string;
  isAuthenticated: boolean;
}

export async function createGraphQLContext(req: NextRequest): Promise<GraphQLContext> {
  const headers = req.headers;
  let userId: string | undefined;
  let apiKeyId: string | undefined;

  // Try JWT auth first
  const authorization = headers.get('authorization');
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice(7);
    try {
      const JWT_SECRET = process.env.JWT_SECRET;
      if (!JWT_SECRET) {
        throw new Error('JWT_SECRET environment variable is not set');
      }
      const decoded = jwt.verify(token, JWT_SECRET) as any;

      const dbUser = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true },
      });

      if (dbUser) {
        userId = dbUser.id;
      }
    } catch (error) {
      console.warn('Invalid JWT token:', error);
    }
  }

  // Fall back to API key auth if JWT not provided
  const apiKeyHeader = headers.get('x-api-key');
  if (!userId && apiKeyHeader) {
    try {
      // Hash the incoming key for comparison against stored keyHash
      const keyHash = hashApiKey(apiKeyHeader);

      // Find the API key by its hash
      const apiKey = await prisma.apiKey.findUnique({
        where: { keyHash },
        select: { id: true, userId: true, revokedAt: true, expiresAt: true },
      });

      if (!apiKey) {
        throw new Error('API key not found');
      }

      if (apiKey.revokedAt) {
        throw new Error('API key has been revoked');
      }

      // Check expiration
      if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
        throw new Error('API key expired');
      }

      userId = apiKey.userId;
      apiKeyId = apiKey.id;
    } catch (error) {
      console.warn('Invalid API key:', error);
    }
  }

  return {
    req,
    userId,
    apiKeyId,
    isAuthenticated: !!userId,
  };
}
