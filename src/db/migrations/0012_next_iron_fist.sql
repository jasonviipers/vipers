ALTER TABLE "runtime_settings" ADD COLUMN "canary_loss_budget_pct" integer;--> statement-breakpoint
ALTER TABLE "runtime_settings" ADD COLUMN "canary_max_allocation_pct" integer;