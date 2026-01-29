import type { Meta, StoryObj } from "@storybook/react";

import SetupLayout from "../layout";
import { SetupForm } from "./setup-form";

const meta: Meta<typeof SetupForm> = {
  title: "Page/Setup/FirstUserSetup",
  component: SetupForm,
  decorators: [
    (Story) => (
      <SetupLayout>
        <Story />
      </SetupLayout>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof SetupForm>;

export const Default: Story = {
  args: {},
};

export const WithError: Story = {
  args: {
    error: "An account with this email already exists",
  },
};
