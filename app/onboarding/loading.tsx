import { TextSkeleton } from '@/components/skeletons/card-skeleton';

export default function OnboardingLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-lg space-y-6">
        <TextSkeleton lines={2} />
        <div className="h-40 rounded-lg bg-muted animate-pulse" />
        <TextSkeleton lines={1} />
      </div>
    </div>
  );
}
