import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import type { Testimonial } from '@/components/testimonials';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const featuredParam = searchParams.get('featured');
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '10', 10), 50);

    const where: any = {};
    if (featuredParam === 'true') {
      where.featured = true;
    } else if (featuredParam === 'false') {
      where.featured = false;
    }

    const testimonials = await prisma.testimonial.findMany({
      where,
      include: {
        creator: {
          select: {
            id: true,
            creatorProfile: {
              select: {
                displayName: true,
              },
            },
          },
        },
        bounty: {
          select: {
            title: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const results: Testimonial[] = testimonials.map((t) => ({
      id: t.id,
      clientId: t.clientId,
      creatorId: t.creatorId,
      bountyId: t.bountyId ?? undefined,
      author: t.author,
      role: t.role,
      quote: t.quote,
      rating: t.rating,
      featured: t.featured,
      createdAt: t.createdAt.toISOString(),
      bountyTitle: t.bounty?.title,
      creatorProfile: t.creator.creatorProfile ? {
        name: t.creator.creatorProfile.displayName,
        slug: t.creator.creatorProfile.displayName.toLowerCase().replace(/\s+/g, '-'),
      } : undefined,
      videoUrl: t.videoUrl ?? undefined,
    }));

    return NextResponse.json({ testimonials: results, total: results.length });
  } catch (error) {
    console.error('Testimonials error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
