import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "@/components/ui/button";
import { withMockClient } from "@/lib/api-client.mock";
import { ChangePasswordDialog } from "./change-password-dialog";

const meta: Meta<typeof ChangePasswordDialog> = {
  title: "Page/UserSettings/ChangePasswordDialog",
  component: ChangePasswordDialog,
  parameters: {
    layout: "centered",
  },
  decorators: [
    withMockClient((client) => {
      client.auth.changePassword.mockResolvedValue({ ok: true });
    }),
  ],
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <ChangePasswordDialog
      trigger={
        <Button variant="outline" size="sm">
          Change
        </Button>
      }
    />
  ),
};
