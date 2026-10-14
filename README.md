# Salsacos Food Order Mini App + Telegram Channel Bot

This project contains:
- `index.html`: your existing Salsacos food-ordering Mini App
- `app.py`: Flask backend + Telegram webhook
- `requirements.txt`: Python dependencies
- `render.yaml`: Render deployment blueprint

## Before deploying

1. Create a Telegram bot with `@BotFather`, or use your existing food-order bot.
2. Add the bot as an **administrator** to your restaurant channel, with permission to post messages.
3. Keep the bot token private. Never put it in `index.html` or share it in public.
4. Push these project files to a private GitHub repository.

## Deploy to Render

1. Sign in to Render and choose **New + → Blueprint** (or create a Python Web Service).
2. Connect the repository containing these files.
3. Add these environment variables in the Render service:
   - `BOT_TOKEN`: token from BotFather
   - `CHANNEL_ID`: channel numeric ID (usually looks like `-100...`) or `@public_channel_username`
   - `WEBHOOK_URL`: your deployed Render base URL, e.g. `https://your-service-name.onrender.com` (no trailing slash)
   - `WEBHOOK_SECRET`: a long random secret using letters, numbers, `_`, and `-`; if using the Blueprint, Render can generate it.
4. Deploy. Open `https://YOUR-SERVICE.onrender.com/health` and confirm it returns `{"ok":true,...}`.
5. Open `https://YOUR-SERVICE.onrender.com/` and confirm the menu loads.

## Connect the Mini App to Telegram

The bot must launch the page as a Telegram Web App so Telegram sends `web_app_data` updates to this backend.

In `@BotFather`:
1. Select your bot.
2. Configure its **Menu Button** / Web App URL to `https://YOUR-SERVICE.onrender.com/`.
3. If BotFather's current menu setup does not expose a Web App URL for your bot, use a bot keyboard button with `web_app` configured by your bot backend. `sendData()` only works when the app was opened through a supported Telegram Web App button.
4. Start the bot, open the Mini App inside Telegram, add items, and submit a test order.

## Find the channel ID

For a private channel, add your bot as an administrator first. Then obtain the channel's numeric ID using a trusted Telegram bot-update/channel-ID method or a bot-management tool. For a public channel, `@channelusername` can be used. Do not post your bot token to third-party sites.

## How orders work

- The HTML posts the cart to `/api/orders` with Telegram's `initData`.
- The backend verifies Telegram's signed `initData` using the bot token, then validates product IDs, quantities, customer details, order type, and payment method.
- Prices and totals are recalculated on the server, rather than trusted from the browser.
- The bot sends a formatted order message to `CHANNEL_ID` and the app displays the result.
- `/telegram-webhook` is also included for Telegram `web_app_data` updates if you later use a reply-keyboard Web App button.

## Important notes

- The order notification does **not** verify Telebirr or CBE payment. Configure an official merchant API/payment verification process before treating those payments as paid.
- The included age checkbox is a customer declaration, not age verification. Follow local laws for alcohol sales.
- The sample has no database. Telegram channel messages are the order log; add a database if you need durable order status, reporting, or duplicate-order protection.
- Free hosting plans can sleep or have usage limits. Orders cannot be delivered while a service is unavailable; verify the current hosting plan before relying on it for business.
- Do not publish `BOT_TOKEN`, webhook secrets, customer phone numbers, or order data.
