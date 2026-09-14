import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Global risk-control switches (singleton row, id = "global").
 *
 * The kill switch is SERVER-OWNED on purpose: the consensus workflow's risk
 * gate reads this row before approving any proposal, so arming it halts new
 * order submission even if the client that armed it goes away. The /settings
 * toggle writes here via POST /api/risk/kill-switch — the old localStorage
 * flag never reached the server and could not stop anything.
 */
export const riskControls = pgTable("risk_controls", {
  id: text("id").primaryKey(),
  killSwitchEnabled: boolean("kill_switch_enabled").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
