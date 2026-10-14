# Salsacos Telegram Mini App — Cloudflare Free Setup

This version uses **Cloudflare Pages** for the menu and **Cloudflare Workers** for the order API. It does not use Render and does not require a Flask server. Cloudflare Workers' free plan currently includes 100,000 requests/day; limits and terms can change. Workers do not have the typical sleep/wake behavior of many free web hosts, but no host can guarantee uninterrupted service.

## What this project does
- Keeps the existing Salsacos menu, cart, delivery/pickup/dine-in choices, customer details, GPS address option, and payment method selection.
- Sends a submitted order to your Telegram channel through the Telegram Bot API.
- Validates Telegram Mini App `initData` on the server and recalculates prices on the server.
- Keeps the bot token in a Cloudflare secret, not in the browser.

**Important:** This sends an order request to the channel; it does not automatically verify Telebirr/CBE payments. The bot must be an administrator of the target channel with permission to post. Only deploy to a channel you control.

## Part 1 — Create the Telegram channel connection
1. Open Telegram and create/use your orders channel.
2. Add your bot to that channel as an **administrator** and allow it to post messages.
3. Get the bot token from the official `@BotFather`. Keep it private. Never paste it into `index.html` or `config.js`.
4. Get the channel ID. For a private channel, one common method is to forward a channel post to a trusted bot/tool that displays chat IDs, or use your own bot update flow. It usually looks like `-1001234567890`. Make sure the bot is already an admin.

## Part 2 — Deploy the Worker (backend)
1. Sign in at https://dash.cloudflare.com/ and open **Workers & Pages**.
2. Choose **Create application** → **Create Worker**. Name it `salsacos-order-api` and deploy the starter Worker.
3. Open the new Worker, choose **Edit code**, replace the editor contents with the full contents of `worker/worker.js`, and save/deploy.
4. Open **Settings** → **Variables and Secrets** (wording may vary). Add these:
   - `BOT_TOKEN` — create as a **Secret**, and paste the token from BotFather.
   - `CHANNEL_ID` — text variable with your channel ID, for example `-1001234567890` (use your real ID).
   - `ALLOWED_ORIGIN` — text variable; temporarily set to `https://YOUR-PAGES-SITE.pages.dev` after you create the Pages site in Part 3. It must match the Pages origin exactly, with no slash at the end.
5. Save and redeploy the Worker after setting variables.
6. Copy the Worker URL, for example `https://salsacos-order-api.YOUR-SUBDOMAIN.workers.dev`. Open that URL in a browser; it should show `{"ok":true,"service":"Salsacos order API"}`.

## Part 3 — Deploy the frontend on Cloudflare Pages
1. In Cloudflare, go to **Workers & Pages** → **Create application** → **Pages** (or **Upload assets** / **Direct Upload**, depending on the dashboard).
2. Create a Pages project named `salsacos-menu` and upload the **contents** of the `frontend` folder: `index.html` and `config.js`. Do not upload the outer ZIP itself if the upload screen asks for a folder.
3. Cloudflare will give you a URL like `https://salsacos-menu.pages.dev`. Copy the exact URL.
4. Edit `frontend/config.js` on your computer. Replace `PASTE_YOUR_CLOUDFLARE_WORKER_URL_HERE` with the Worker URL copied in Part 2, with no trailing slash. Example:
   `window.SALSACOS_API_URL = 'https://salsacos-order-api.YOUR-SUBDOMAIN.workers.dev';`
5. Upload the updated `index.html` and `config.js` to the same Pages project again.
6. Go back to Worker settings and set `ALLOWED_ORIGIN` to your exact Pages URL, e.g. `https://salsacos-menu.pages.dev` (no trailing slash). Save/redeploy.
7. Reload the Pages URL. The menu should load, but ordering is intended to work **inside Telegram** because the server verifies Telegram Mini App data.

## Part 4 — Connect the Mini App to your Telegram bot
1. Open `@BotFather`, choose your bot, and configure its **Main Mini App** or menu button URL to the Cloudflare Pages URL. The exact menu names in BotFather can vary.
2. Make sure the bot's Mini App opens the Pages URL from inside Telegram. Do not test order submission by opening the URL in an ordinary browser; it will not have signed Telegram `initData`.
3. Place a small test order. Confirm it appears in the channel, then delete/cancel the test order as needed.

## Troubleshooting
- **"Origin not allowed"**: `ALLOWED_ORIGIN` must exactly match the Pages URL, including `https://` and excluding a trailing slash. Save/deploy after changing it.
- **"Telegram verification failed"**: open the app from the Telegram bot, not from an ordinary browser. Confirm the Worker has the correct `BOT_TOKEN` for that same bot.
- **Telegram send fails**: verify `CHANNEL_ID`, confirm the bot is an admin in that channel, and ensure it has permission to post.
- **Changes not visible**: upload both frontend files again and hard-refresh/reopen Telegram.
- **Orders not appearing**: check Worker logs in Cloudflare and make sure the Worker was redeployed after adding secrets/variables.

## Security notes
- Never share your bot token. If it has been exposed, revoke/regenerate it with BotFather.
- The channel ID is not a password, but configure it carefully.
- The app currently treats payment as a selected method only; payment verification requires official merchant integration or manual confirmation.
- This is an order-notification flow, not a database/order-management system. Channel messages are the record unless you add a database later.
