'use client';

import Link from 'next/link';
import { Star } from 'lucide-react';

export interface Testimonial {
  id: string;
  clientId: string;
  creatorId: string;
  bountyId?: string;
  /** Display name of the client/author */
  author: string;
  role: string;
  quote: string;
  rating: number;
  featured: boolean;
  createdAt: string;
  creatorProfile?: { name: string; avatar?: string; slug: string };
  bountyTitle?: string;
  /** S3 URL for a video testimonial */
  videoUrl?: string;
}

const testimonials: Testimonial[] = [
  {
    id: '1',
    clientId: 'client-001',
    creatorId: 'creator-001',
    bountyId: 'bounty-101',
    author: 'Sarah Chen',
    role: 'Product Manager, TechStartup',
    quote:
      'Tamgora connected us with incredible designers who transformed our product. The process was seamless and professional.',
    rating: 5,
    featured: true,
    createdAt: '2024-11-12T10:00:00Z',
    bountyTitle: 'Dashboard UI Redesign',
    creatorProfile: { name: 'Alex Rivera', slug: 'alex-rivera' },
  },
  {
    id: '2',
    clientId: 'client-002',
    creatorId: 'creator-002',
    bountyId: 'bounty-102',
    author: 'Marcus Johnson',
    role: 'UI/UX Designer',
    quote:
      'As a freelancer, this platform gave me access to high-quality projects and clients who truly value creative work.',
    rating: 5,
    featured: true,
    createdAt: '2024-12-01T14:30:00Z',
    bountyTitle: 'Mobile App Prototype',
    creatorProfile: { name: 'Jordan Kim', slug: 'jordan-kim' },
    videoUrl: 'https://assets.stellar.app/testimonials/marcus-johnson.mp4',
  },
  {
    id: '3',
    clientId: 'client-003',
    creatorId: 'creator-003',
    bountyId: 'bounty-103',
    author: 'Emily Rodriguez',
    role: 'Marketing Director, GrowthCo',
    quote:
      'The bounty system is revolutionary. We found the perfect content creator for our campaign in days, not weeks.',
    rating: 5,
    featured: true,
    createdAt: '2025-01-08T09:15:00Z',
    bountyTitle: 'Brand Campaign Content',
    creatorProfile: { name: 'Sam Okafor', slug: 'sam-okafor' },
  },
];

/** Initials avatar fallback */
function InitialsAvatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-accent/20 text-accent font-semibold text-sm select-none">
      {initials}
    </span>
  );
}

function CaseStudyCard({ testimonial }: { testimonial: Testimonial }) {
  return (
    <div className="flex flex-col bg-card border border-border rounded-lg p-8 hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
      {/* Rating */}
      <div className="flex gap-1 mb-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star
            key={i}
            size={18}
            className={i < testimonial.rating ? 'fill-accent text-accent' : 'text-muted-foreground'}
          />
        ))}
      </div>

      {/* Quote */}
      <p className="text-foreground mb-4 italic leading-relaxed flex-1">
        &ldquo;{testimonial.quote}&rdquo;
      </p>

      {/* Optional video testimonial */}
      {testimonial.videoUrl && (
        <div className="mb-4 rounded-md overflow-hidden border border-border">
          <video
            src={testimonial.videoUrl}
            controls
            muted
            playsInline
            className="w-full max-h-48 object-cover"
            aria-label={`Video testimonial from ${testimonial.author}`}
          />
        </div>
      )}

      {/* Author */}
      <div className="flex items-center gap-3 mb-4">
        <InitialsAvatar name={testimonial.author} />
        <div>
          <p className="font-semibold text-foreground leading-tight">{testimonial.author}</p>
          <p className="text-sm text-muted-foreground">{testimonial.role}</p>
        </div>
      </div>

      {/* Links */}
      <div className="flex flex-wrap gap-3 text-sm mt-auto">
        {testimonial.creatorProfile && (
          <Link
            href={`/creators/${testimonial.creatorProfile.slug}`}
            className="text-accent hover:underline font-medium"
          >
            View creator &rarr;
          </Link>
        )}
        {testimonial.bountyId && (
          <Link
            href={`/bounties/${testimonial.bountyId}`}
            className="text-muted-foreground hover:text-foreground hover:underline"
          >
            View bounty &rarr;
          </Link>
        )}
      </div>
    </div>
  );
}

interface TestimonialsSectionProps {
  featuredOnly?: boolean;
}

export function TestimonialsSection({ featuredOnly = true }: TestimonialsSectionProps) {
  const displayed = featuredOnly
    ? testimonials.filter((t) => t.featured)
    : testimonials;

  return (
    <section className="py-20 sm:py-32 bg-muted/30 border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-foreground mb-4">
            Loved by Creators &amp; Clients
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            See what industry leaders are saying about Tamgora
          </p>
        </div>

        {/* Testimonials Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {displayed.map((testimonial) => (
            <CaseStudyCard key={testimonial.id} testimonial={testimonial} />
          ))}
        </div>
      </div>
    </section>
  );
}
