# Salsacos Telegram Mini App — Render deployment

This project serves the Salsacos frontend and order API from one Render web service. It preserves the current menu/prices and validates Telegram Mini App `initData` before forwarding orders to Telegram.

## Files
- `server.js` — Node.js web server and Telegram order API
- `package.json` — Render start command
- `frontend/index.html` — Mini App interface
- `frontend/config.js` — same-origin API configuration

## Deploy on Render
1. Upload these files and folders to the **root** of your GitHub repository (so `package.json` and `server.js` are at repository root).
2. In Render, choose **New + → Web Service**, connect the GitHub repository, and choose the branch you use (usually `main`).
3. Set **Root Directory** blank if the files are at repository root.
4. Set **Runtime** to Node, **Build Command** to `npm install` (there are no external packages), and **Start Command** to `npm start`.
5. Add environment variables in Render → Environment:
   - `BOT_TOKEN` = your Telegram bot token (secret; never paste it into chat or source code)
   - `CHANNEL_ID` = your Telegram channel/group chat ID (bot must be an admin with permission to post)
   - `ALLOWED_ORIGIN` = optional; only needed for an extra separate frontend origin. For a same-origin Render frontend/API, leave it unset.
6. Deploy. Open `https://YOUR-SERVICE.onrender.com/health`. Expected response: `{"ok":true,"service":"Salsacos order API"}`.
7. Set the Telegram Mini App URL in BotFather to the Render service URL ending in `/`.

## Important
- Do not delete the Cloudflare Worker until the Render app has been deployed and tested.
- Free Render web services can spin down after inactivity and may take time to wake up.
- Telegram must open the page as a Mini App so `Telegram.WebApp.initData` is present. Opening the URL directly in a normal browser will not submit an order.
- The bot must be able to post in the configured channel. Private customer confirmations may fail if the customer has not started the bot; the Mini App will still show the returned confirmation after the channel accepts the order.
- Telebirr/CBE payment is not automatically verified by this project.
