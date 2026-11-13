import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
const prisma = new PrismaClient();

async function main() {
  const email = "demo@mailflow.local";
  const password = "MailFlowDemo!2026";
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, name: "Demo Admin" },
    create: { email, passwordHash, name: "Demo Admin" }
  });
  let workspace = await prisma.workspace.findFirst({ where: { name: "Demo Company" } });
  if (!workspace) workspace = await prisma.workspace.create({ data: { name: "Demo Company" } });
  await prisma.workspaceMember.upsert({
    where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
    update: { role: "OWNER" },
    create: { userId: user.id, workspaceId: workspace.id, role: "OWNER" }
  });
  console.log("Demo account created:");
  console.log("Email:", email);
  console.log("Password:", password);
  console.log("Change this password and remove the demo account before production.");
}
main().finally(() => prisma.$disconnect());
