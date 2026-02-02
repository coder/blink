import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { withMockClient } from "@/lib/api-client.mock";
import { CreateUserModal } from "./create-user-modal";

function CreateUserModalDemo({ initialError }: { initialError?: string }) {
  const [open, setOpen] = useState(true);

  return (
    <>
      <Button onClick={() => setOpen(true)}>Open Modal</Button>
      <CreateUserModal
        open={open}
        onClose={() => setOpen(false)}
        onUserCreated={() => {
          alert("User created!");
          setOpen(false);
        }}
        initialError={initialError}
      />
    </>
  );
}

const meta: Meta<typeof CreateUserModal> = {
  title: "Page/SiteAdmin/CreateUserModal",
  component: CreateUserModal,
  parameters: {
    layout: "centered",
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <CreateUserModalDemo />,
  decorators: [
    withMockClient((client) => {
      client.admin.users.create.mockResolvedValue({
        id: "new-user-123",
        created_at: new Date(),
        updated_at: new Date(),
        display_name: "New User",
        email: "newuser@example.com",
        avatar_url: null,
        username: "newuser",
        organization_id: "org-1",
        site_role: "member",
        suspended: false,
      });
    }),
  ],
};

export const WithError: Story = {
  render: () => (
    <CreateUserModalDemo initialError="A user with this email already exists" />
  ),
  decorators: [
    withMockClient((client) => {
      client.admin.users.create.mockRejectedValue(
        new Error("A user with this email already exists")
      );
    }),
  ],
};
