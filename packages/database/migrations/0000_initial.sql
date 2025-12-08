CREATE TABLE agent (id uuid NOT NULL DEFAULT gen_random_uuid(), created_at timestamp without time zone NOT NULL DEFAULT now(), updated_at timestamp without time zone NOT NULL DEFAULT now(), visibility character varying NOT NULL DEFAULT 'organization'::character varying, description text, organization_id uuid NOT NULL, created_by uuid NOT NULL, last_deployment_number integer NOT NULL DEFAULT 0, last_run_number integer NOT NULL DEFAULT 0, active_deployment_id uuid, name character varying(40) NOT NULL, avatar_file_id uuid, chat_expire_ttl integer);
--> statement-breakpoint
CREATE TABLE agent_deployment (created_at timestamp without time zone NOT NULL DEFAULT now(), updated_at timestamp without time zone NOT NULL DEFAULT now(), agent_id uuid NOT NULL, output_files json, status character varying NOT NULL DEFAULT 'pending'::character varying, error_message text, number bigint NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), entrypoint text NOT NULL, target_id uuid NOT NULL, created_by uuid, created_from text NOT NULL, user_message text, platform text NOT NULL, platform_memory_mb integer NOT NULL, platform_region text, platform_metadata json, direct_access_url text, compatibility_version text NOT NULL DEFAULT '1'::text, source_files json);
--> statement-breakpoint
CREATE TABLE agent_deployment_log (id uuid NOT NULL DEFAULT gen_random_uuid(), created_at timestamp without time zone NOT NULL DEFAULT now(), updated_at timestamp without time zone NOT NULL DEFAULT now(), agent_id uuid NOT NULL, deployment_id integer NOT NULL, level character varying NOT NULL, message text NOT NULL);
--> statement-breakpoint
CREATE TABLE agent_deployment_target (id uuid NOT NULL DEFAULT gen_random_uuid(), agent_id uuid NOT NULL, created_at timestamp without time zone NOT NULL DEFAULT now(), updated_at timestamp without time zone NOT NULL DEFAULT now(), target text NOT NULL, request_id uuid NOT NULL DEFAULT gen_random_uuid());
--> statement-breakpoint
CREATE TABLE agent_environment_variable (id uuid NOT NULL DEFAULT gen_random_uuid(), created_at timestamp without time zone NOT NULL DEFAULT now(), updated_at timestamp without time zone NOT NULL DEFAULT now(), agent_id uuid NOT NULL, value text, secret boolean NOT NULL DEFAULT false, created_by uuid NOT NULL, updated_by uuid NOT NULL, key text NOT NULL, target text[] NOT NULL DEFAULT '{preview,production}'::text[], encrypted_value text, encrypted_dek text, encryption_iv text, encryption_auth_tag text);
--> statement-breakpoint
CREATE TABLE agent_log (id uuid NOT NULL DEFAULT gen_random_uuid(), agent_id uuid NOT NULL, level character varying(8) NOT NULL DEFAULT 'info'::character varying, payload jsonb NOT NULL, metadata jsonb, "timestamp" timestamp without time zone NOT NULL DEFAULT now(), payload_str text NOT NULL);
--> statement-breakpoint
CREATE TABLE agent_permission (id uuid NOT NULL DEFAULT gen_random_uuid(), agent_id uuid NOT NULL, user_id uuid, permission character varying NOT NULL, created_at timestamp without time zone NOT NULL DEFAULT now(), updated_at timestamp without time zone NOT NULL DEFAULT now(), created_by uuid NOT NULL);
--> statement-breakpoint
CREATE TABLE agent_pin (id uuid NOT NULL DEFAULT gen_random_uuid(), created_at timestamp without time zone NOT NULL DEFAULT now(), agent_id uuid NOT NULL, user_id uuid NOT NULL);
--> statement-breakpoint
CREATE TABLE agent_storage_kv (id uuid NOT NULL DEFAULT gen_random_uuid(), agent_id uuid NOT NULL, agent_deployment_target_id uuid NOT NULL, key text NOT NULL, value text NOT NULL);
--> statement-breakpoint
CREATE TABLE agent_trace (id uuid NOT NULL DEFAULT gen_random_uuid(), agent_id uuid NOT NULL, created_at timestamp without time zone NOT NULL DEFAULT now(), start_time timestamp without time zone NOT NULL, end_time timestamp without time zone NOT NULL, payload jsonb NOT NULL, payload_original text NOT NULL, payload_str text NOT NULL);
--> statement-breakpoint
CREATE TABLE api_key (id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid NOT NULL, name character varying(255), key_hash text NOT NULL, key_lookup character varying(12) NOT NULL, key_prefix character varying(20) NOT NULL, key_suffix character varying(4) NOT NULL, scope character varying NOT NULL DEFAULT 'full'::character varying, expires_at timestamp without time zone, last_used_at timestamp without time zone, created_at timestamp without time zone NOT NULL DEFAULT now(), updated_at timestamp without time zone NOT NULL DEFAULT now(), revoked_at timestamp without time zone, revoked_by uuid);
--> statement-breakpoint
CREATE TABLE chat (id uuid NOT NULL DEFAULT gen_random_uuid(), created_at timestamp without time zone NOT NULL, created_by uuid, title text, organization_id uuid NOT NULL, visibility character varying NOT NULL DEFAULT 'private'::character varying, metadata json, archived boolean NOT NULL DEFAULT false, last_run_number integer NOT NULL DEFAULT 0, agent_id uuid NOT NULL, agent_deployment_id uuid, agent_deployment_target_id uuid, agent_key character varying(128) NOT NULL, expire_ttl integer);
--> statement-breakpoint
CREATE TABLE chat_run (chat_id uuid NOT NULL, number bigint NOT NULL, agent_id uuid NOT NULL, created_at timestamp without time zone NOT NULL DEFAULT now(), last_step_number integer NOT NULL DEFAULT 0, id uuid NOT NULL DEFAULT gen_random_uuid(), agent_deployment_id uuid);
--> statement-breakpoint
CREATE TABLE chat_run_step (chat_id uuid NOT NULL, number integer NOT NULL, agent_id uuid NOT NULL, started_at timestamp without time zone NOT NULL DEFAULT now(), heartbeat_at timestamp without time zone NOT NULL DEFAULT now(), completed_at timestamp without time zone, interrupted_at timestamp without time zone, first_message_id uuid, last_message_id uuid, error text, response_status integer, response_headers json, response_headers_redacted boolean NOT NULL DEFAULT false, response_body text, response_body_redacted boolean NOT NULL DEFAULT false, response_message_id uuid, continuation_reason text, id uuid NOT NULL DEFAULT gen_random_uuid(), chat_run_id uuid NOT NULL, agent_deployment_id uuid NOT NULL, tool_calls_total integer NOT NULL DEFAULT 0, tool_calls_completed integer NOT NULL DEFAULT 0, tool_calls_errored integer NOT NULL DEFAULT 0, time_to_first_token_micros bigint, usage_cost_usd double precision, usage_model text, usage_total_input_tokens integer, usage_total_output_tokens integer, usage_total_tokens integer, usage_total_cached_input_tokens integer);
--> statement-breakpoint
CREATE TABLE chat_user_state (chat_id uuid NOT NULL, user_id uuid NOT NULL, last_read_at timestamp without time zone);
--> statement-breakpoint
CREATE TABLE email_verification (email text NOT NULL, code text NOT NULL, created_at timestamp without time zone NOT NULL DEFAULT now(), expires_at timestamp without time zone NOT NULL);
--> statement-breakpoint
CREATE TABLE file (id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid, name text NOT NULL, content_type text NOT NULL, byte_length integer NOT NULL, created_at timestamp without time zone NOT NULL DEFAULT now(), updated_at timestamp without time zone NOT NULL DEFAULT now(), pdf_page_count integer, organization_id uuid, message_id uuid, content bytea);
--> statement-breakpoint
CREATE TABLE message (id uuid NOT NULL DEFAULT gen_random_uuid(), chat_id uuid NOT NULL, role character varying NOT NULL, parts json NOT NULL, user_id uuid, created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP, metadata json, agent_id uuid, updated_at timestamp without time zone NOT NULL DEFAULT now(), agent_deployment_id uuid, chat_run_id uuid, chat_run_step_id uuid);
--> statement-breakpoint
CREATE TABLE organization (id uuid NOT NULL DEFAULT gen_random_uuid(), created_at timestamp without time zone NOT NULL DEFAULT now(), created_by uuid, billing_tier character varying NOT NULL DEFAULT 'free'::character varying, billing_interval character varying NOT NULL DEFAULT 'month'::character varying, stripe_customer_id text, stripe_subscription_id text, next_billing_date timestamp without time zone, avatar_url character varying(2048), updated_at timestamp without time zone NOT NULL DEFAULT now(), name character varying(40) NOT NULL, kind character varying NOT NULL DEFAULT 'organization'::character varying, personal_owner_user_id uuid, metronome_customer_id text, metronome_contract_id text, billing_entitled_at timestamp without time zone);
--> statement-breakpoint
CREATE TABLE organization_billing_usage_event (id uuid NOT NULL DEFAULT gen_random_uuid(), created_at timestamp without time zone NOT NULL DEFAULT now(), organization_id uuid NOT NULL, transaction_id text NOT NULL, event_type text NOT NULL, cost_usd numeric(32,18) NOT NULL, user_id uuid, processed_at timestamp without time zone, error_message text);
--> statement-breakpoint
CREATE TABLE organization_invite (id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, email text, role character varying NOT NULL DEFAULT 'member'::character varying, code text NOT NULL, reusable boolean NOT NULL DEFAULT false, expires_at timestamp without time zone DEFAULT now(), last_accepted_at timestamp without time zone, created_at timestamp without time zone NOT NULL DEFAULT now(), updated_at timestamp without time zone NOT NULL DEFAULT now(), invited_by uuid NOT NULL);
--> statement-breakpoint
CREATE TABLE organization_membership (organization_id uuid NOT NULL, user_id uuid NOT NULL, role character varying NOT NULL DEFAULT 'member'::character varying, created_at timestamp without time zone NOT NULL DEFAULT now(), updated_at timestamp without time zone NOT NULL DEFAULT now(), billing_emails_opt_out boolean NOT NULL DEFAULT false);
--> statement-breakpoint
CREATE TABLE "user" (id uuid NOT NULL, display_name text, email text, email_verified timestamp without time zone, password text, created_at timestamp without time zone NOT NULL DEFAULT now(), updated_at timestamp without time zone NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE TABLE user_account (user_id uuid NOT NULL, type text NOT NULL, provider text NOT NULL, provider_account_id text NOT NULL, refresh_token text, access_token text, expires_at integer, token_type text, scope text, id_token text, session_state text);
--> statement-breakpoint
ALTER TABLE agent ADD CONSTRAINT agent_visibility_check CHECK (((visibility)::text = ANY ((ARRAY['private'::character varying, 'public'::character varying, 'organization'::character varying])::text[])));
--> statement-breakpoint
ALTER TABLE agent ADD CONSTRAINT name_format CHECK (((name)::text ~* '^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$'::text));
--> statement-breakpoint
ALTER TABLE organization ADD CONSTRAINT name_format CHECK (((name)::text ~* '^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$'::text));
--> statement-breakpoint
ALTER TABLE organization ADD CONSTRAINT name_not_reserved CHECK (((name)::text <> ALL ((ARRAY['api'::character varying, 'auth'::character varying, 'login'::character varying, 'logout'::character varying, 'signup'::character varying, 'register'::character varying, 'help'::character varying, 'docs'::character varying, 'support'::character varying, 'contact'::character varying, 'about'::character varying, 'blog'::character varying, 'chat'::character varying, 'agents'::character varying, 'agent'::character varying, 'shortcuts'::character varying, 'integrations'::character varying, 'user'::character varying, 'team'::character varying, 'new'::character varying, 'recent-chats'::character varying, 'telemetry'::character varying, 'settings'::character varying, 'account'::character varying, 'profile'::character varying, 'billing'::character varying, 'admin'::character varying, 'dashboard'::character varying, 'privacy'::character varying, 'terms'::character varying, 'tos'::character varying, 'legal'::character varying, 'security'::character varying, 'internal'::character varying, 'webhook'::character varying, 'webhooks'::character varying, 'callback'::character varying, 'verify'::character varying, 'metrics'::character varying, 'status'::character varying, 'health'::character varying])::text[])));
--> statement-breakpoint
ALTER TABLE organization ADD CONSTRAINT personal_created_by_matches_owner CHECK ((((kind)::text <> 'personal'::text) OR (created_by = personal_owner_user_id)));
--> statement-breakpoint
ALTER TABLE organization ADD CONSTRAINT personal_owner_presence CHECK (((((kind)::text = 'personal'::text) AND (personal_owner_user_id IS NOT NULL)) OR (((kind)::text = 'organization'::text) AND (personal_owner_user_id IS NULL))));
--> statement-breakpoint
ALTER TABLE agent_deployment_target ADD CONSTRAINT agent_deployment_target_request_id_unique UNIQUE (request_id);
--> statement-breakpoint
ALTER TABLE api_key ADD CONSTRAINT api_key_key_lookup_unique UNIQUE (key_lookup);
--> statement-breakpoint
ALTER TABLE organization_invite ADD CONSTRAINT organization_invite_code_unique UNIQUE (code);
--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT user_email_unique UNIQUE (email);
--> statement-breakpoint
ALTER TABLE agent ADD CONSTRAINT agent_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE agent_deployment ADD CONSTRAINT agent_deployment_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE agent_deployment_log ADD CONSTRAINT agent_deployment_log_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE agent_deployment_target ADD CONSTRAINT agent_deployment_target_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE agent_environment_variable ADD CONSTRAINT agent_environment_variable_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE agent_log ADD CONSTRAINT agent_log_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE agent_permission ADD CONSTRAINT agent_permission_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE agent_pin ADD CONSTRAINT agent_pin_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE agent_storage_kv ADD CONSTRAINT agent_storage_kv_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE agent_trace ADD CONSTRAINT agent_trace_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE api_key ADD CONSTRAINT api_key_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE chat ADD CONSTRAINT chat_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE chat_run ADD CONSTRAINT chat_run_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE chat_run_step ADD CONSTRAINT chat_run_step_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE chat_user_state ADD CONSTRAINT chat_user_state_chat_id_user_id_pk PRIMARY KEY (chat_id, user_id);
--> statement-breakpoint
ALTER TABLE file ADD CONSTRAINT message_attachment_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE message ADD CONSTRAINT message_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE organization ADD CONSTRAINT organization_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE organization_billing_usage_event ADD CONSTRAINT organization_billing_usage_event_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE organization_invite ADD CONSTRAINT organization_invite_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE organization_membership ADD CONSTRAINT organization_membership_organization_id_user_id_pk PRIMARY KEY (organization_id, user_id);
--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT user_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE user_account ADD CONSTRAINT user_account_provider_provider_account_id_pk PRIMARY KEY (provider, provider_account_id);
--> statement-breakpoint
ALTER TABLE agent_deployment ADD CONSTRAINT agent_deployment_agent_id_agent_id_fk FOREIGN KEY (agent_id) REFERENCES agent(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE agent_deployment ADD CONSTRAINT agent_deployment_target_id_agent_deployment_target_id_fk FOREIGN KEY (target_id) REFERENCES agent_deployment_target(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE agent_deployment_log ADD CONSTRAINT agent_deployment_log_agent_id_agent_id_fk FOREIGN KEY (agent_id) REFERENCES agent(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE agent_deployment_target ADD CONSTRAINT agent_deployment_target_agent_id_agent_id_fk FOREIGN KEY (agent_id) REFERENCES agent(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE agent_environment_variable ADD CONSTRAINT agent_environment_variable_agent_id_agent_id_fk FOREIGN KEY (agent_id) REFERENCES agent(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE agent_log ADD CONSTRAINT agent_log_agent_id_agent_id_fk FOREIGN KEY (agent_id) REFERENCES agent(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE agent_permission ADD CONSTRAINT agent_permission_agent_id_agent_id_fk FOREIGN KEY (agent_id) REFERENCES agent(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE agent_permission ADD CONSTRAINT agent_permission_created_by_user_id_fk FOREIGN KEY (created_by) REFERENCES "user"(id);
--> statement-breakpoint
ALTER TABLE agent_permission ADD CONSTRAINT agent_permission_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE agent_pin ADD CONSTRAINT agent_pin_agent_id_agent_id_fk FOREIGN KEY (agent_id) REFERENCES agent(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE agent_pin ADD CONSTRAINT agent_pin_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE agent_storage_kv ADD CONSTRAINT agent_storage_kv_agent_deployment_target_id_agent_deployment_ta FOREIGN KEY (agent_deployment_target_id) REFERENCES agent_deployment_target(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE agent_storage_kv ADD CONSTRAINT agent_storage_kv_agent_id_agent_id_fk FOREIGN KEY (agent_id) REFERENCES agent(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE agent_trace ADD CONSTRAINT agent_trace_agent_id_agent_id_fk FOREIGN KEY (agent_id) REFERENCES agent(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE api_key ADD CONSTRAINT api_key_revoked_by_user_id_fk FOREIGN KEY (revoked_by) REFERENCES "user"(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE api_key ADD CONSTRAINT api_key_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE chat ADD CONSTRAINT chat_agent_deployment_id_agent_deployment_id_fk FOREIGN KEY (agent_deployment_id) REFERENCES agent_deployment(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE chat ADD CONSTRAINT chat_agent_deployment_target_id_agent_deployment_target_id_fk FOREIGN KEY (agent_deployment_target_id) REFERENCES agent_deployment_target(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE chat ADD CONSTRAINT chat_agent_id_agent_id_fk FOREIGN KEY (agent_id) REFERENCES agent(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE chat ADD CONSTRAINT chat_organization_id_organization_id_fk FOREIGN KEY (organization_id) REFERENCES organization(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE chat_run ADD CONSTRAINT chat_run_agent_id_agent_id_fk FOREIGN KEY (agent_id) REFERENCES agent(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE chat_run ADD CONSTRAINT chat_run_chat_id_chat_id_fk FOREIGN KEY (chat_id) REFERENCES chat(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE chat_run_step ADD CONSTRAINT chat_run_step_chat_id_chat_id_fk FOREIGN KEY (chat_id) REFERENCES chat(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE chat_run_step ADD CONSTRAINT chat_run_step_chat_run_id_chat_run_id_fk FOREIGN KEY (chat_run_id) REFERENCES chat_run(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE chat_user_state ADD CONSTRAINT chat_user_state_chat_id_chat_id_fk FOREIGN KEY (chat_id) REFERENCES chat(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE chat_user_state ADD CONSTRAINT chat_user_state_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE message ADD CONSTRAINT message_chat_id_chat_id_fk FOREIGN KEY (chat_id) REFERENCES chat(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE organization ADD CONSTRAINT organization_personal_owner_user_id_user_id_fk FOREIGN KEY (personal_owner_user_id) REFERENCES "user"(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE organization_invite ADD CONSTRAINT organization_invite_invited_by_membership_fk FOREIGN KEY (organization_id, invited_by) REFERENCES organization_membership(organization_id, user_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE organization_invite ADD CONSTRAINT organization_invite_organization_id_organization_id_fk FOREIGN KEY (organization_id) REFERENCES organization(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE organization_membership ADD CONSTRAINT organization_membership_organization_id_organization_id_fk FOREIGN KEY (organization_id) REFERENCES organization(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE organization_membership ADD CONSTRAINT organization_membership_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE user_account ADD CONSTRAINT user_account_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX agent_name_unique ON public.agent USING btree (organization_id, lower((name)::text));
--> statement-breakpoint
CREATE UNIQUE INDEX agent_deployment_agent_id_number_unique ON public.agent_deployment USING btree (agent_id, number);
--> statement-breakpoint
CREATE UNIQUE INDEX agent_deployment_target_agent_id_target_unique ON public.agent_deployment_target USING btree (agent_id, target);
--> statement-breakpoint
CREATE UNIQUE INDEX agent_env_key_prev_unique ON public.agent_environment_variable USING btree (agent_id, key) WHERE ('preview'::text = ANY (target));
--> statement-breakpoint
CREATE UNIQUE INDEX agent_env_key_prod_unique ON public.agent_environment_variable USING btree (agent_id, key) WHERE ('production'::text = ANY (target));
--> statement-breakpoint
CREATE INDEX agent_environment_variable_agent_id_idx ON public.agent_environment_variable USING btree (agent_id);
--> statement-breakpoint
CREATE INDEX agent_log_agent_time_idx ON public.agent_log USING btree (agent_id, "timestamp" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX agent_log_payload_gin_idx ON public.agent_log USING gin (payload jsonb_path_ops);
--> statement-breakpoint
CREATE INDEX agent_log_timestamp_brin_idx ON public.agent_log USING brin ("timestamp");
--> statement-breakpoint
CREATE INDEX agent_permission_agent_id_index ON public.agent_permission USING btree (agent_id);
--> statement-breakpoint
CREATE UNIQUE INDEX agent_permission_agent_id_user_id_unique ON public.agent_permission USING btree (agent_id, user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX agent_pin_agent_id_user_id_unique ON public.agent_pin USING btree (agent_id, user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX agent_storage_kv_agent_deployment_target_id_key_unique ON public.agent_storage_kv USING btree (agent_deployment_target_id, key);
--> statement-breakpoint
CREATE INDEX agent_trace_agent_time_idx ON public.agent_trace USING btree (agent_id, start_time DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX agent_trace_payload_gin_idx ON public.agent_trace USING gin (payload jsonb_path_ops);
--> statement-breakpoint
CREATE INDEX agent_trace_start_time_brin_idx ON public.agent_trace USING brin (start_time);
--> statement-breakpoint
CREATE INDEX api_key_lookup_idx ON public.api_key USING btree (key_lookup);
--> statement-breakpoint
CREATE INDEX api_key_user_idx ON public.api_key USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_organization_created_at_idx ON public.chat USING btree (organization_id, created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_chat_agent_deployment_target_id_key_unique ON public.chat USING btree (agent_deployment_target_id, agent_key);
--> statement-breakpoint
CREATE INDEX idx_chat_expire_ttl ON public.chat USING btree (created_at) WHERE (expire_ttl IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_chat_organization_created_by ON public.chat USING btree (organization_id, created_by, created_at);
--> statement-breakpoint
CREATE INDEX idx_chat_visibility ON public.chat USING btree (organization_id, visibility, created_at) WHERE ((visibility)::text = ANY ((ARRAY['public'::character varying, 'private'::character varying, 'organization'::character varying])::text[]));
--> statement-breakpoint
CREATE UNIQUE INDEX chat_run_chat_id_number_unique ON public.chat_run USING btree (chat_id, number);
--> statement-breakpoint
CREATE INDEX chat_run_step_agent_deployment_id_started_at_idx ON public.chat_run_step USING btree (agent_deployment_id, started_at);
--> statement-breakpoint
CREATE INDEX chat_run_step_agent_id_started_at_idx ON public.chat_run_step USING btree (agent_id, started_at);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_run_step_chat_run_id_id_unique ON public.chat_run_step USING btree (chat_run_id, number);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_run_step_single_streaming ON public.chat_run_step USING btree (chat_id) WHERE ((completed_at IS NULL) AND (error IS NULL) AND (interrupted_at IS NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX idx_email_verification_email_code ON public.email_verification USING btree (email, code);
--> statement-breakpoint
CREATE INDEX idx_message_chat_role_created ON public.message USING btree (chat_id, role) WHERE ((role)::text = 'user'::text);
--> statement-breakpoint
CREATE UNIQUE INDEX organization_name_unique ON public.organization USING btree (lower((name)::text));
--> statement-breakpoint
CREATE UNIQUE INDEX personal_org_per_user ON public.organization USING btree (personal_owner_user_id) WHERE ((kind)::text = 'personal'::text);
--> statement-breakpoint
CREATE UNIQUE INDEX organization_billing_usage_event_org_txn_unique ON public.organization_billing_usage_event USING btree (organization_id, transaction_id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.assign_agent_deployment_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE agent
  SET last_deployment_number = last_deployment_number + 1
  WHERE id = NEW.agent_id
  RETURNING last_deployment_number INTO NEW.number;
  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.assign_chat_run_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE chat
  SET last_run_number = last_run_number + 1
  WHERE id = NEW.chat_id
  RETURNING last_run_number INTO NEW.number;
  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.assign_chat_run_step_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE chat_run
  SET last_step_number = last_step_number + 1
  WHERE id = NEW.chat_run_id
  RETURNING last_step_number INTO NEW.number;
  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.ensure_agent_deployment_targets()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  insert into agent_deployment_target (agent_id, target) values (new.id, 'preview')
  on conflict do nothing;
  insert into agent_deployment_target (agent_id, target) values (new.id, 'production')
  on conflict do nothing;
  return new;
end $function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.forbid_direct_delete_personal_org()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- This only allows deletions through CASCADE.
  -- This prevents *us* from accidentally allowing users to delete
  -- their personal organizations via the API, and then losing their data.
  IF OLD.kind = 'personal' AND pg_trigger_depth() = 0 THEN
    RAISE EXCEPTION 'Cannot delete personal organizations directly';
  END IF;
  RETURN OLD;
END$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.set_agent_key_default()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.agent_key IS NULL THEN
    NEW.agent_key := NEW.id::text;
  END IF;
  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE TRIGGER trg_agent_deployment_targets_after_insert AFTER INSERT ON public.agent FOR EACH ROW EXECUTE FUNCTION ensure_agent_deployment_targets();
--> statement-breakpoint
CREATE TRIGGER tg_assign_agent_deployment_number BEFORE INSERT ON public.agent_deployment FOR EACH ROW WHEN ((new.number IS NULL)) EXECUTE FUNCTION assign_agent_deployment_number();
--> statement-breakpoint
CREATE TRIGGER set_agent_key_before_insert BEFORE INSERT ON public.chat FOR EACH ROW EXECUTE FUNCTION set_agent_key_default();
--> statement-breakpoint
CREATE TRIGGER tg_assign_chat_run_number BEFORE INSERT ON public.chat_run FOR EACH ROW WHEN ((new.number IS NULL)) EXECUTE FUNCTION assign_chat_run_number();
--> statement-breakpoint
CREATE TRIGGER tg_assign_chat_run_step_number BEFORE INSERT ON public.chat_run_step FOR EACH ROW WHEN ((new.number IS NULL)) EXECUTE FUNCTION assign_chat_run_step_number();
--> statement-breakpoint
CREATE TRIGGER no_direct_delete_personal_org BEFORE DELETE ON public.organization FOR EACH ROW EXECUTE FUNCTION forbid_direct_delete_personal_org();
--> statement-breakpoint
CREATE VIEW chat_run_step_with_status AS  SELECT id,
    number,
    chat_id,
    chat_run_id,
    agent_id,
    agent_deployment_id,
    started_at,
    heartbeat_at,
    completed_at,
    interrupted_at,
    first_message_id,
    last_message_id,
    error,
    response_status,
    response_headers,
    response_headers_redacted,
    response_body,
    response_body_redacted,
    response_message_id,
    continuation_reason,
    time_to_first_token_micros,
    tool_calls_total,
    tool_calls_completed,
    tool_calls_errored,
    usage_cost_usd,
    usage_model,
    usage_total_input_tokens,
    usage_total_output_tokens,
    usage_total_tokens,
    usage_total_cached_input_tokens,
        CASE
            WHEN (error IS NOT NULL) THEN 'error'::text
            WHEN (interrupted_at IS NOT NULL) THEN 'interrupted'::text
            WHEN (completed_at IS NOT NULL) THEN 'completed'::text
            WHEN (continuation_reason IS NOT NULL) THEN 'streaming'::text
            WHEN (heartbeat_at < (now() - '00:01:30'::interval)) THEN 'stalled'::text
            ELSE 'streaming'::text
        END AS status
   FROM chat_run_step;
--> statement-breakpoint
CREATE VIEW chat_run_with_status AS  SELECT chat_run.id,
    chat_run.number,
    chat_run.chat_id,
    COALESCE(chat_run_step_with_status.agent_id, chat_run.agent_id) AS agent_id,
    COALESCE(chat_run_step_with_status.agent_deployment_id, chat_run.agent_deployment_id) AS agent_deployment_id,
    chat_run.created_at,
    chat_run.last_step_number,
    COALESCE(chat_run_step_with_status.completed_at, chat_run_step_with_status.interrupted_at, chat_run_step_with_status.heartbeat_at, chat_run_step_with_status.started_at, chat_run.created_at) AS updated_at,
    chat_run_step_with_status.error,
    chat_run_step_with_status.status
   FROM (chat_run
     LEFT JOIN chat_run_step_with_status ON (((chat_run.id = chat_run_step_with_status.chat_run_id) AND (chat_run_step_with_status.number = chat_run.last_step_number))));
--> statement-breakpoint
CREATE VIEW chat_with_status AS  SELECT chat.id,
    chat.created_at,
    chat.created_by,
    chat.organization_id,
    chat.visibility,
    chat.title,
    chat.metadata,
    chat.archived,
    chat.agent_id,
    COALESCE(chat_run_with_status.agent_deployment_id, chat.agent_deployment_id) AS agent_deployment_id,
    chat.agent_deployment_target_id,
    chat.agent_key,
    chat.last_run_number,
    chat.expire_ttl,
    COALESCE(chat_run_with_status.updated_at, chat.created_at) AS updated_at,
    chat_run_with_status.error,
        CASE
            WHEN (chat_run_with_status.status IS NULL) THEN 'idle'::text
            WHEN (chat_run_with_status.status = ANY (ARRAY['error'::text, 'stalled'::text])) THEN 'error'::text
            WHEN (chat_run_with_status.status = 'interrupted'::text) THEN 'interrupted'::text
            WHEN (chat_run_with_status.status = ANY (ARRAY['completed'::text, 'idle'::text])) THEN 'idle'::text
            ELSE 'streaming'::text
        END AS status,
        CASE
            WHEN (chat.expire_ttl IS NULL) THEN NULL::timestamp without time zone
            ELSE (COALESCE(chat_run_with_status.updated_at, chat.created_at) + ((chat.expire_ttl || ' seconds'::text))::interval)
        END AS expires_at
   FROM (chat
     LEFT JOIN chat_run_with_status ON (((chat.id = chat_run_with_status.chat_id) AND (chat_run_with_status.number = chat.last_run_number))));
--> statement-breakpoint
CREATE VIEW user_with_personal_organization AS  SELECT "user".id,
    "user".created_at,
    "user".updated_at,
    "user".display_name,
    "user".email,
    "user".email_verified,
    "user".password,
    organization.id AS organization_id,
    organization.name AS username,
    organization.avatar_url
   FROM ("user"
     JOIN organization ON (("user".id = organization.personal_owner_user_id)));
--> statement-breakpoint
