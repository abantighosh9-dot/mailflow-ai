import { spawn } from "child_process";

console.log("\n🚀 Starting MailFlow AI Development Server...\n");

const server = spawn("node", ["server.js"], { stdio: "inherit", shell: true });
const vite = spawn("npx", ["vite"], { stdio: "inherit", shell: true });

function cleanup() {
  server.kill();
  vite.kill();
  process.exit();
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("exit", cleanup);
