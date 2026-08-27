import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/config';

const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(100).optional(),
});

/**
 * POST /api/auth/register — email/password account creation.
 *
 * TODO: this auto-verifies the email at creation instead of sending a real
 * verification link. lib/email/mailer.ts (which lib/email/index.ts already
 * imports from) doesn't exist yet, so there's no working mail-sending path
 * to hook up here — wire this to VerificationToken + /api/auth/verify-email
 * (both already exist) once that's built.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }
  const { email, password, name } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 });
  }

  await prisma.user.create({
    data: {
      email,
      name: name ?? null,
      password: hashPassword(password),
      emailVerified: new Date(),
    },
  });

  return NextResponse.json({ success: true });
}
