-- Timeline branches live inside one collaborative workspace. Mainline rows
-- keep a null branch_id; branch rows inherit history through from_seq.
ALTER TABLE "workspace_revisions"
  ADD COLUMN IF NOT EXISTS "branch_id" uuid;

ALTER TABLE "chat_messages"
  ADD COLUMN IF NOT EXISTS "branch_id" uuid;

ALTER TABLE "timeline_branches"
  ADD COLUMN IF NOT EXISTS "parent_branch_id" uuid;

DO $$ BEGIN
  ALTER TABLE "workspace_revisions"
    ADD CONSTRAINT "workspace_revisions_branch_id_timeline_branches_id_fk"
    FOREIGN KEY ("branch_id") REFERENCES "public"."timeline_branches"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "chat_messages"
    ADD CONSTRAINT "chat_messages_branch_id_timeline_branches_id_fk"
    FOREIGN KEY ("branch_id") REFERENCES "public"."timeline_branches"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "timeline_branches"
    ADD CONSTRAINT "timeline_branches_parent_branch_id_timeline_branches_id_fk"
    FOREIGN KEY ("parent_branch_id") REFERENCES "public"."timeline_branches"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "workspace_revisions_workspace_branch_seq_idx"
  ON "workspace_revisions" USING btree ("workspace_id", "branch_id", "seq");

CREATE INDEX IF NOT EXISTS "chat_messages_workspace_branch_created_idx"
  ON "chat_messages" USING btree ("workspace_id", "branch_id", "created_at");
