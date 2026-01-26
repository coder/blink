/**
 * Creates a Slack manifest URL for app creation.
 */

export interface SlackManifest {
  display_information: {
    name: string;
    description?: string;
  };
  features?: {
    bot_user?: {
      display_name: string;
      always_online?: boolean;
    };
    app_home?: {
      home_tab_enabled?: boolean;
      messages_tab_enabled?: boolean;
      messages_tab_read_only_enabled?: boolean;
    };
    assistant_view: {
      assistant_description: string;
      suggested_prompts: string[];
    };
  };
  oauth_config: {
    scopes: {
      bot?: string[];
      user?: string[];
    };
  };
  settings?: {
    event_subscriptions?: {
      request_url: string;
      bot_events?: string[];
    };
    interactivity?: {
      is_enabled: boolean;
      request_url: string;
    };
    org_deploy_enabled?: boolean;
    socket_mode_enabled?: boolean;
    token_rotation_enabled?: boolean;
  };
}

/**
 * Creates a URL to initialize Slack App creation with a manifest.
 * @param manifest The Slack App manifest configuration
 * @returns URL to create the Slack app with the provided manifest
 */
export function createSlackAppUrl(manifest: SlackManifest): string {
  const manifestJson = encodeURIComponent(JSON.stringify(manifest));
  return `https://api.slack.com/apps?new_app=1&manifest_json=${manifestJson}`;
}

/**
 * Creates a default Slack manifest for a Blink agent.
 * @param appName The display name for the Slack app
 * @param webhookUrl The webhook URL for event subscriptions
 * @returns A Slack manifest configured for the agent
 */
export function createAgentSlackManifest(
  appName: string,
  webhookUrl: string
): SlackManifest {
  return {
    display_information: {
      name: appName,
      description: `Chat with ${appName}`,
    },
    features: {
      bot_user: {
        display_name: appName,
        always_online: true,
      },
      app_home: {
        home_tab_enabled: false,
        messages_tab_enabled: true,
        messages_tab_read_only_enabled: false,
      },
      assistant_view: {
        assistant_description: `A helpful assistant powered by Blink`,
        suggested_prompts: [],
      },
    },
    oauth_config: {
      scopes: {
        bot: [
          "assistant:write",
          "chat:write",
          "im:history",
          "im:read",
          "im:write",
        ],
      },
    },
    settings: {
      event_subscriptions: {
        request_url: webhookUrl,
        bot_events: [
          "assistant_thread_context_changed",
          "assistant_thread_started",
          "message.im",
        ],
      },
      interactivity: {
        is_enabled: true,
        request_url: webhookUrl,
      },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
}
