ALTER TABLE "chat" DROP CONSTRAINT "chat_agent_id_agent_id_fk";
--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;