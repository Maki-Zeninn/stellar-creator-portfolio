import { prisma } from '@/lib/prisma';

/**
 * Find-or-create the User row for an OAuth identity (Google, so far).
 * Shared by the web NextAuth signIn callback and the mobile Google token
 * exchange endpoint so both platforms land on the same account for a given
 * email instead of drifting into separate upsert logic.
 */
export async function upsertOAuthUser(profile: {
  email: string;
  name?: string | null;
  image?: string | null;
}) {
  const existing = await prisma.user.findUnique({ where: { email: profile.email } });
  if (existing) return existing;

  return prisma.user.create({
    data: {
      email: profile.email,
      name: profile.name ?? null,
      image: profile.image ?? null,
      // The OAuth provider has already verified ownership of this address.
      emailVerified: new Date(),
      role: 'USER',
    },
  });
}
