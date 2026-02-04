import type { SiteUser } from "@blink.so/api";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChangePasswordModal } from "./change-password-modal";

const mockUser: SiteUser = {
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

function ChangePasswordModalDemo({
  user,
  initialError,
}: {
  user: SiteUser;
  initialError?: string;
}) {
  const [open, setOpen] = useState(true);

  const handlePasswordChanged = async () => {
    setOpen(false);
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>Open Modal</Button>
      <ChangePasswordModal
        open={open}
        user={user}
        onClose={() => setOpen(false)}
        onPasswordChanged={handlePasswordChanged}
        initialError={initialError}
      />
    </>
  );
}

const meta: Meta<typeof ChangePasswordModal> = {
  title: "Page/SiteAdmin/ChangePasswordModal",
  component: ChangePasswordModal,
  parameters: {
    layout: "centered",
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <ChangePasswordModalDemo user={mockUser} />,
};

export const WithError: Story = {
  render: () => (
    <ChangePasswordModalDemo
      user={mockUser}
      initialError="Failed to change password"
    />
  ),
};
