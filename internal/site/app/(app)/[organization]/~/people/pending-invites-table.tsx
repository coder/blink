import type { OrganizationInviteWithCode } from "@blink.so/api";
import { Mail } from "lucide-react";
import { MemberActionsDropdown } from "./member-actions-dropdown";
import { formatDate, formatRole } from "./utils";

interface PendingInvitesTableProps {
  invites: OrganizationInviteWithCode[];
  organizationId: string;
  onInviteDeleted?: () => void;
}

export function PendingInvitesTable({
  invites,
  organizationId,
  onInviteDeleted,
}: PendingInvitesTableProps) {
  if (invites.length === 0) return null;

  return (
    <section aria-labelledby="invites-heading" className="space-y-6">
      <div>
        <h2 id="invites-heading" className="text-lg font-medium">
          Pending Invites
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {invites.length} {invites.length === 1 ? "invite" : "invites"}{" "}
          awaiting response
        </p>
      </div>

      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full">
          <thead className="border-b bg-neutral-50 dark:bg-neutral-900/50">
            <tr>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
              >
                Email
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
              >
                Role
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
              >
                Expires
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider"
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200 dark:divide-neutral-700">
            {invites.map((invite) => (
              <tr key={invite.id}>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <span className="font-medium">
                      {invite.email || "Anyone with link"}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm whitespace-nowrap">
                  <span className="capitalize">{formatRole(invite.role)}</span>
                </td>
                <td className="px-6 py-4 text-sm whitespace-nowrap">
                  {invite.expires_at ? (
                    <time
                      className="text-muted-foreground"
                      dateTime={new Date(invite.expires_at).toISOString()}
                    >
                      {formatDate(invite.expires_at)}
                    </time>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  <MemberActionsDropdown
                    organizationId={organizationId}
                    inviteId={invite.id}
                    inviteEmail={invite.email || undefined}
                    onInviteDeleted={onInviteDeleted}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
