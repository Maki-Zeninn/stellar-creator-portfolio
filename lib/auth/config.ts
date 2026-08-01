import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { prisma } from '@/lib/prisma';

// Legacy scheme (pre-fix): every account shared this one hardcoded salt,
// which defeats the point of salting. Kept only so accounts hashed before
// this fix can still log in; verifyPassword upgrades them to the new
// per-user random-salt format on successful login.
const LEGACY_SALT = createHash('sha256').update('stellar-salt').digest();

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const sepIndex = stored.indexOf(':');
  if (sepIndex === -1) {
    // Legacy fixed-salt hash — no embedded salt.
    const hash = scryptSync(password, LEGACY_SALT, 64);
    const storedBuf = Buffer.from(stored, 'hex');
    if (hash.length !== storedBuf.length) return false;
    return timingSafeEqual(hash, storedBuf);
  }

  const salt = Buffer.from(stored.slice(0, sepIndex), 'hex');
  const storedHash = Buffer.from(stored.slice(sepIndex + 1), 'hex');
  const hash = scryptSync(password, salt, 64);
  if (hash.length !== storedHash.length) return false;
  return timingSafeEqual(hash, storedHash);
}

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/auth/login',
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });
        if (!user?.password || !user.emailVerified) return null;
        if (!verifyPassword(credentials.password, user.password)) return null;

        // Transparently upgrade legacy fixed-salt hashes to the new
        // per-user random-salt format now that we know the plaintext.
        if (!user.password.includes(':')) {
          await prisma.user.update({
            where: { id: user.id },
            data: { password: hashPassword(credentials.password) },
          });
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          emailVerified: user.emailVerified?.toISOString() ?? null,
          onboardingCompleted: !!user.onboardingCompletedAt,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.emailVerified = (user as { emailVerified?: string | null }).emailVerified ?? null;
        token.onboardingCompleted = (user as { onboardingCompleted?: boolean }).onboardingCompleted ?? false;
      }
      if (trigger === 'update' && token.id) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { onboardingCompletedAt: true, emailVerified: true, role: true },
        });
        if (dbUser) {
          token.onboardingCompleted = !!dbUser.onboardingCompletedAt;
          token.emailVerified = dbUser.emailVerified?.toISOString() ?? null;
          token.role = dbUser.role;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = (token.role as string) ?? 'USER';
      }
      return session;
    },
  },
};

export { hashPassword };
