import { z } from "zod";

/**
 * Creates a URL to initialize Slack App creation with a manifest.
 * Users will need to manually configure environment variables after creation.
 * @param manifest The Slack App manifest configuration
 * @returns URL to create the Slack app with the provided manifest
 */
export function createSlackApp(
  manifest: z.infer<typeof createSlackAppSchema>
): string {
  const manifestJson = encodeURIComponent(JSON.stringify(manifest));
  return `https://api.slack.com/apps?new_app=1&manifest_json=${manifestJson}`;
}

// Common Slack bot events
const BotEvent = z.union([
  z
    .literal("app_mention")
    .describe(
      "Bot is @mentioned in a channel or conversation. Requires scope: app_mentions:read"
    ),
  z
    .literal("app_home_opened")
    .describe(
      "User opened the app's Home tab. No additional scope required beyond bot token"
    ),
  z
    .literal("app_installed")
    .describe(
      "App was installed to a workspace. No additional scope required beyond bot token"
    ),
  z
    .literal("app_uninstalled")
    .describe(
      "App was uninstalled from a workspace. No additional scope required beyond bot token"
    ),
  z
    .literal("assistant_thread_context_changed")
    .describe(
      "Context changed in an assistant thread. Requires scope: assistant:write"
    ),
  z
    .literal("assistant_thread_started")
    .describe(
      "New assistant thread was started. Requires scope: assistant:write"
    ),
  z
    .literal("channel_archive")
    .describe("Public channel was archived. Requires scope: channels:read"),
  z
    .literal("channel_created")
    .describe("Public channel was created. Requires scope: channels:read"),
  z
    .literal("channel_deleted")
    .describe("Public channel was deleted. Requires scope: channels:read"),
  z
    .literal("channel_rename")
    .describe("Public channel was renamed. Requires scope: channels:read"),
  z
    .literal("channel_unarchive")
    .describe("Public channel was unarchived. Requires scope: channels:read"),
  z
    .literal("dnd_updated_user")
    .describe(
      "User's Do Not Disturb settings changed. Requires scope: dnd:read"
    ),
  z
    .literal("email_domain_changed")
    .describe("Workspace's email domain changed. Requires scope: team:read"),
  z
    .literal("emoji_changed")
    .describe("Custom emoji was added or changed. Requires scope: emoji:read"),
  z
    .literal("file_change")
    .describe("File was changed. Requires scope: files:read"),
  z
    .literal("file_created")
    .describe("File was created. Requires scope: files:read"),
  z
    .literal("file_deleted")
    .describe("File was deleted. Requires scope: files:read"),
  z
    .literal("file_public")
    .describe("File was made public. Requires scope: files:read"),
  z
    .literal("file_shared")
    .describe("File was shared. Requires scope: files:read"),
  z
    .literal("file_unshared")
    .describe("File was unshared. Requires scope: files:read"),
  z
    .literal("group_archive")
    .describe("Private channel was archived. Requires scope: groups:read"),
  z
    .literal("group_deleted")
    .describe("Private channel was deleted. Requires scope: groups:read"),
  z
    .literal("group_rename")
    .describe("Private channel was renamed. Requires scope: groups:read"),
  z
    .literal("group_unarchive")
    .describe("Private channel was unarchived. Requires scope: groups:read"),
  z
    .literal("link_shared")
    .describe(
      "Link from a registered domain was shared. Requires scope: links:read"
    ),
  z
    .literal("member_joined_channel")
    .describe(
      "User joined a public or private channel. Requires scope: channels:read (public) or groups:read (private)"
    ),
  z
    .literal("member_left_channel")
    .describe(
      "User left a public or private channel. Requires scope: channels:read (public) or groups:read (private)"
    ),
  z
    .literal("message.channels")
    .describe(
      "Message was posted in a public channel. Requires scope: channels:history"
    ),
  z
    .literal("message.groups")
    .describe(
      "Message was posted in a private channel. Requires scope: groups:history"
    ),
  z
    .literal("message.im")
    .describe(
      "Message was posted in a direct message. Requires scope: im:history"
    ),
  z
    .literal("message.mpim")
    .describe(
      "Message was posted in a multi-party direct message. Requires scope: mpim:history"
    ),
  z
    .literal("pin_added")
    .describe("Item was pinned in a channel. Requires scope: pins:read"),
  z
    .literal("pin_removed")
    .describe("Item was unpinned from a channel. Requires scope: pins:read"),
  z
    .literal("reaction_added")
    .describe(
      "Reaction was added to a message. Requires scope: reactions:read"
    ),
  z
    .literal("reaction_removed")
    .describe(
      "Reaction was removed from a message. Requires scope: reactions:read"
    ),
  z
    .literal("team_join")
    .describe("New user joined the workspace. Requires scope: users:read"),
  z
    .literal("user_change")
    .describe("User's profile or settings changed. Requires scope: users:read"),
]);

// Common Slack bot scopes
const BotScope = z.union([
  z
    .literal("app_mentions:read")
    .describe(
      "Read messages that directly mention the bot. Required for: app_mention event"
    ),
  z
    .literal("assistant:write")
    .describe(
      "Update bot status and write assistant messages. This should *always* be included for Slack bots. It improves the UX dramatically for users. Required for: assistant_thread_context_changed, assistant_thread_started events"
    ),
  z
    .literal("channels:history")
    .describe(
      "Read message history in public channels the bot has access to. Required for: message.channels event"
    ),
  z.literal("channels:join").describe("Join public channels"),
  z
    .literal("channels:manage")
    .describe("Manage public channels (archive, rename, etc.)"),
  z
    .literal("channels:read")
    .describe(
      "View basic information about public channels. Required for: channel_archive, channel_created, channel_deleted, channel_rename, channel_unarchive, member_joined_channel, member_left_channel events"
    ),
  z.literal("chat:write").describe("Send messages as the bot"),
  z
    .literal("chat:write.customize")
    .describe("Send messages with a customized username and avatar"),
  z
    .literal("chat:write.public")
    .describe("Send messages to public channels without joining"),
  z.literal("commands").describe("Add and use slash commands"),
  z
    .literal("dnd:read")
    .describe(
      "View Do Not Disturb settings for users. Required for: dnd_updated_user event"
    ),
  z
    .literal("emoji:read")
    .describe(
      "View custom emoji in the workspace. Required for: emoji_changed event"
    ),
  z
    .literal("files:read")
    .describe(
      "View files shared in channels and conversations. Required for: file_change, file_created, file_deleted, file_public, file_shared, file_unshared events"
    ),
  z.literal("files:write").describe("Upload, edit, and delete files"),
  z
    .literal("groups:history")
    .describe(
      "Read message history in private channels the bot has access to. Required for: message.groups event"
    ),
  z
    .literal("groups:read")
    .describe(
      "View basic information about private channels. Required for: group_archive, group_deleted, group_rename, group_unarchive, member_joined_channel, member_left_channel events"
    ),
  z
    .literal("groups:write")
    .describe("Manage private channels (archive, rename, create, etc.)"),
  z
    .literal("im:history")
    .describe(
      "Read message history in direct messages with the bot. Required for: message.im event"
    ),
  z
    .literal("im:read")
    .describe("View basic information about direct messages with the bot"),
  z.literal("im:write").describe("Start and manage direct messages with users"),
  z
    .literal("links:read")
    .describe("View URLs in messages. Required for: link_shared event"),
  z.literal("links:write").describe("Show previews of URLs (unfurling)"),
  z.literal("metadata.message:read").describe("Read message metadata"),
  z
    .literal("mpim:history")
    .describe(
      "Read message history in multi-party direct messages. Required for: message.mpim event"
    ),
  z
    .literal("mpim:read")
    .describe("View basic information about multi-party direct messages"),
  z
    .literal("mpim:write")
    .describe("Start and manage multi-party direct messages"),
  z
    .literal("pins:read")
    .describe(
      "View pinned items in channels and conversations. Required for: pin_added, pin_removed events"
    ),
  z
    .literal("pins:write")
    .describe("Pin and unpin items in channels and conversations"),
  z
    .literal("reactions:read")
    .describe(
      "View emoji reactions on messages. Required for: reaction_added, reaction_removed events"
    ),
  z
    .literal("reactions:write")
    .describe("Add and remove emoji reactions to messages"),
  z.literal("reminders:read").describe("View reminders created by the bot"),
  z.literal("reminders:write").describe("Create, update, and delete reminders"),
  z
    .literal("team:read")
    .describe(
      "View workspace name, domain, and other basic information. Required for: email_domain_changed event"
    ),
  z.literal("usergroups:read").describe("View user groups and their members"),
  z
    .literal("usergroups:write")
    .describe("Create, update, and archive user groups"),
  z
    .literal("users.profile:read")
    .describe("View profile information about users"),
  z
    .literal("users:read")
    .describe(
      "View users in the workspace. Required for: team_join, user_change events"
    ),
  z
    .literal("users:read.email")
    .describe("View email addresses of users in the workspace"),
  z.literal("users:write").describe("Set presence and status for the bot user"),
]);

// User scopes
const UserScope = z.union([
  z
    .literal("channels:history")
    .describe("Read message history in public channels on behalf of the user"),
  z
    .literal("channels:read")
    .describe(
      "View basic information about public channels on behalf of the user"
    ),
  z
    .literal("channels:write")
    .describe("Manage public channels on behalf of the user"),
  z.literal("chat:write").describe("Send messages on behalf of the user"),
  z.literal("emoji:read").describe("View custom emoji on behalf of the user"),
  z.literal("files:read").describe("View files on behalf of the user"),
  z
    .literal("files:write")
    .describe("Upload, edit, and delete files on behalf of the user"),
  z
    .literal("groups:history")
    .describe("Read message history in private channels on behalf of the user"),
  z
    .literal("groups:read")
    .describe(
      "View basic information about private channels on behalf of the user"
    ),
  z
    .literal("groups:write")
    .describe("Manage private channels on behalf of the user"),
  z
    .literal("im:history")
    .describe("Read direct message history on behalf of the user"),
  z
    .literal("im:read")
    .describe(
      "View basic information about direct messages on behalf of the user"
    ),
  z
    .literal("im:write")
    .describe("Manage direct messages on behalf of the user"),
  z
    .literal("links:read")
    .describe("View URLs in messages on behalf of the user"),
  z.literal("links:write").describe("Show URL previews on behalf of the user"),
  z
    .literal("mpim:history")
    .describe("Read multi-party direct message history on behalf of the user"),
  z
    .literal("mpim:read")
    .describe(
      "View basic information about multi-party direct messages on behalf of the user"
    ),
  z
    .literal("mpim:write")
    .describe("Manage multi-party direct messages on behalf of the user"),
  z.literal("pins:read").describe("View pinned items on behalf of the user"),
  z.literal("pins:write").describe("Pin and unpin items on behalf of the user"),
  z
    .literal("reactions:read")
    .describe("View emoji reactions on behalf of the user"),
  z
    .literal("reactions:write")
    .describe("Add and remove emoji reactions on behalf of the user"),
  z.literal("reminders:read").describe("View reminders on behalf of the user"),
  z
    .literal("reminders:write")
    .describe("Create, update, and delete reminders on behalf of the user"),
  z
    .literal("search:read")
    .describe("Search messages and files on behalf of the user"),
  z.literal("stars:read").describe("View starred items on behalf of the user"),
  z
    .literal("stars:write")
    .describe("Star and unstar items on behalf of the user"),
  z
    .literal("team:read")
    .describe("View workspace information on behalf of the user"),
  z
    .literal("usergroups:read")
    .describe("View user groups on behalf of the user"),
  z
    .literal("usergroups:write")
    .describe("Manage user groups on behalf of the user"),
  z
    .literal("users.profile:read")
    .describe("View user profile information on behalf of the user"),
  z
    .literal("users.profile:write")
    .describe("Edit the user's profile information"),
  z
    .literal("users:read")
    .describe("View users in the workspace on behalf of the user"),
  z
    .literal("users:read.email")
    .describe("View email addresses on behalf of the user"),
  z.literal("users:write").describe("Set presence for the user"),
]);

export const createSlackAppSchema = z.object({
  display_information: z
    .object({
      name: z.string().describe("The name of the Slack app."),
      description: z
        .string()
        .optional()
        .describe("A short description of the app."),
      background_color: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/)
        .optional()
        .describe(
          "Background color for the app in hex format (e.g., #4A154B)."
        ),
      long_description: z
        .string()
        .optional()
        .describe("A longer description of the app."),
    })
    .describe("Display information for the Slack app."),

  features: z
    .object({
      bot_user: z
        .object({
          display_name: z
            .string()
            .describe("The display name for the bot user."),
          always_online: z
            .boolean()
            .optional()
            .default(true)
            .describe("Whether the bot always appears online."),
        })
        .optional()
        .describe("Configuration for the bot user."),

      app_home: z
        .object({
          home_tab_enabled: z
            .boolean()
            .optional()
            .describe("Enable the Home tab."),
          messages_tab_enabled: z
            .boolean()
            .optional()
            .describe("Enable the Messages tab."),
          messages_tab_read_only_enabled: z
            .boolean()
            .optional()
            .describe("Make the Messages tab read-only."),
        })
        .optional()
        .describe("Configuration for the App Home."),

      assistant_view: z
        .object({
          assistant_description: z
            .string()
            .optional()
            .describe("Description for the assistant view."),
        })
        .optional()
        .describe("Configuration for the assistant view."),

      slash_commands: z
        .array(
          z.object({
            command: z
              .string()
              .regex(/^\//)
              .describe("The command (must start with /)."),
            description: z.string().describe("Description of the command."),
            usage_hint: z
              .string()
              .optional()
              .describe("Usage hint for the command."),
            should_escape: z
              .boolean()
              .optional()
              .describe("Whether to escape special characters."),
          })
        )
        .optional()
        .describe("Slash commands for the app."),

      unfurl_domains: z
        .array(z.string())
        .optional()
        .describe("Domains for link unfurling."),
    })
    .optional()
    .describe("Features configuration for the Slack app."),

  oauth_config: z
    .object({
      redirect_urls: z
        .array(z.string().url())
        .optional()
        .describe("OAuth redirect URLs."),
      scopes: z
        .object({
          bot: z
            .array(z.union([BotScope, z.string()]))
            .optional()
            .describe(
              "Bot scopes required by the app. Each scope defines specific permissions for what the bot can do."
            ),
          user: z
            .array(z.union([UserScope, z.string()]))
            .optional()
            .describe(
              "User scopes required by the app. Each scope defines specific permissions for actions performed on behalf of users."
            ),
        })
        .describe("OAuth scopes for bot and user tokens."),
    })
    .optional()
    .describe("OAuth configuration for the Slack app."),

  settings: z
    .object({
      event_subscriptions: z
        .object({
          request_url: z
            .string()
            .url()
            .describe("The webhook URL for event subscriptions."),
          bot_events: z
            .array(z.union([BotEvent, z.string()]))
            .optional()
            .describe(
              "Bot events to subscribe to. Each event notifies your app when specific actions occur in the workspace."
            ),
        })
        .optional()
        .describe("Event subscriptions configuration."),

      interactivity: z
        .object({
          is_enabled: z.boolean().describe("Enable interactivity."),
          request_url: z
            .string()
            .url()
            .describe("The webhook URL for interactive components."),
          message_menu_options_url: z
            .string()
            .url()
            .optional()
            .describe("URL for message menu options."),
        })
        .optional()
        .describe("Interactivity configuration."),

      org_deploy_enabled: z
        .boolean()
        .optional()
        .default(false)
        .describe("Enable organization-wide deployment."),

      socket_mode_enabled: z
        .boolean()
        .optional()
        .default(false)
        .describe("Enable Socket Mode."),

      token_rotation_enabled: z
        .boolean()
        .optional()
        .default(false)
        .describe("Enable automatic token rotation."),
    })
    .optional()
    .describe("Settings for the Slack app."),
});
