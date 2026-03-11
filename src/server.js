import { env } from "./config.js";
import app from "./app.js";

app.listen(env.port, () => {
  console.log(`citrea-wallet-flow-tracker running on http://localhost:${env.port}`);
  console.log("mode=live");
});
