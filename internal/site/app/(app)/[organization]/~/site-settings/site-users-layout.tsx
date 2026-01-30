import type { ReactNode } from "react";

export function SiteUsersLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-8">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium">Users</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              All users registered on this site
            </p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
