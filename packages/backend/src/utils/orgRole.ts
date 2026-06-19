import type { OrgRole } from "../db/schema";

/** Map a GitHub org role to a Keyway org role (GitHub admin == Keyway owner). */
export const keywayRoleFromGitHub = (role: "admin" | "member"): OrgRole =>
  role === "admin" ? "owner" : "member";
