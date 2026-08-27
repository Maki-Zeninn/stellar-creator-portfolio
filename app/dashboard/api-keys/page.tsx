import { Suspense } from "react";
import { ApiKeysManager } from "@/components/dashboard/api-keys-manager";
import { ApiKeysSkeleton } from "@/components/ui/skeleton-group";

export const metadata = {
  title: "API Keys | Tamgora Creators",
  description: "Manage developer API keys for third-party integrations",
};

export default function ApiKeysPage() {
  return (
    <div className="container max-w-3xl py-10 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">API Keys</h1>
        <p className="text-muted-foreground mt-1">
          Generate and manage API keys for programmatic access to the GraphQL API.
        </p>
      </div>
      {/* Matches the pattern used by the files dashboard: a skeleton covers
          the streaming/hydration gap, and the manager shows the same skeleton
          again while it fetches. */}
      <Suspense fallback={<ApiKeysSkeleton />}>
        <ApiKeysManager />
      </Suspense>
    </div>
  );
}
