import { TextSkeleton } from '@/components/skeletons/card-skeleton';

export default function AboutLoading() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="border-b border-border bg-muted/30 py-16 sm:py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <TextSkeleton lines={3} />
        </div>
      </div>
      <div className="py-16 sm:py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-4">
          <TextSkeleton lines={4} />
        </div>
      </div>
    </div>
  );
}
