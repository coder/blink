/**
 * Creates a URL to initialize Slack App creation with a manifest.
 * @param manifest The Slack App manifest configuration
 * @returns URL to create the Slack app with the provided manifest
 */
export function createSlackAppUrl(manifest: unknown): string {
  const manifestJson = encodeURIComponent(JSON.stringify(manifest));
  return `https://api.slack.com/apps?new_app=1&manifest_json=${manifestJson}`;
}

/**
 * Creates a default Slack manifest for a Blink agent.
 * @param appName The display name for the Slack app
 * @param webhookUrl The webhook URL for event subscriptions
 * @returns A Slack manifest configured for the agent
 */
export function createAgentSlackManifest(appName: string, webhookUrl: string) {
  return {
    display_information: {
      name: appName,
      description: "A Blink agent for Slack",
    },
    features: {
      bot_user: {
        display_name: appName.toString(),
        always_online: true,
      },
      app_home: {
        home_tab_enabled: false,
        messages_tab_enabled: true,
        messages_tab_read_only_enabled: false,
      },
      assistant_view: {
        assistant_description: "A helpful assistant powered by Blink",
      },
    },
    oauth_config: {
      scopes: {
        bot: [
          "app_mentions:read",
          "assistant:write",
          "reactions:write",
          "reactions:read",
          "channels:history",
          "chat:write",
          "groups:history",
          "groups:read",
          "files:read",
          "im:history",
          "im:read",
          "im:write",
          "mpim:history",
          "mpim:read",
          "users:read",
          "links:read",
          "commands",
        ],
      },
    },
    settings: {
      event_subscriptions: {
        request_url: webhookUrl,
        bot_events: [
          "app_mention",
          "message.channels",
          "message.groups",
          "message.im",
          "reaction_added",
          "reaction_removed",
          "assistant_thread_started",
          "member_joined_channel",
        ],
      },
      interactivity: {
        is_enabled: true,
        request_url: webhookUrl,
      },
      token_rotation_enabled: false,
      org_deploy_enabled: false,
      socket_mode_enabled: false,
    },
  };
}
