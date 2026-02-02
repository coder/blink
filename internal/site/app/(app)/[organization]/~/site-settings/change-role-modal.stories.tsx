import type { SiteUser } from "@blink.so/api";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChangeRoleModal } from "./change-role-modal";

const mockMemberUser: SiteUser = {
  id: "user-123",
  created_at: new Date(),
  updated_at: new Date(),
  display_name: "John Doe",
  email: "john@example.com",
  avatar_url: null,
  username: "johndoe",
  organization_id: "org-1",
  site_role: "member",
  suspended: false,
};

const mockAdminUser: SiteUser = {
  id: "user-456",
  created_at: new Date(),
  updated_at: new Date(),
  display_name: "Jane Admin",
  email: "jane@example.com",
  avatar_url: null,
  username: "janeadmin",
  organization_id: "org-1",
  site_role: "admin",
  suspended: false,
};

function ChangeRoleModalDemo({
  user,
  initialError,
}: {
  user: SiteUser;
  initialError?: string;
}) {
  const [open, setOpen] = useState(true);

  const handleRoleChanged = async () => {
    setOpen(false);
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>Open Modal</Button>
      <ChangeRoleModal
        open={open}
        user={user}
        onClose={() => setOpen(false)}
        onRoleChanged={handleRoleChanged}
        initialError={initialError}
      />
    </>
  );
}

const meta: Meta<typeof ChangeRoleModal> = {
  title: "Page/SiteAdmin/ChangeRoleModal",
  component: ChangeRoleModal,
  parameters: {
    layout: "centered",
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const MemberToAdmin: Story = {
  render: () => <ChangeRoleModalDemo user={mockMemberUser} />,
};

export const AdminToMember: Story = {
  render: () => <ChangeRoleModalDemo user={mockAdminUser} />,
};

export const WithError: Story = {
  render: () => (
    <ChangeRoleModalDemo
      user={mockMemberUser}
      initialError="Cannot change your own role"
    />
  ),
};
