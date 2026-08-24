import { Settings } from "lucide-react";

export const metadata = {
  title: "Settings | Tamgora Creators",
  description: "Manage your account and workspace settings",
};

export default function SettingsPage() {
  return (
    <div className="container max-w-3xl py-10 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage your account, notifications, and workspace preferences.
        </p>
      </div>

      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
        <Settings className="h-8 w-8 text-muted-foreground" />
        <p className="font-medium text-foreground">No settings configured yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Once you connect a wallet and set up your profile, your account and
          notification preferences will show up here.
        </p>
      </div>
    </div>
  );
}
