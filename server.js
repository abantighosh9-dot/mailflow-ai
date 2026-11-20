import dotenv from "dotenv";
dotenv.config();

import { app } from "./netlify/functions/api.mjs";

const PORT = process.env.API_PORT || 3001;

app.listen(PORT, () => {
  console.log(`MailFlow API server running on http://localhost:${PORT}`);
});
