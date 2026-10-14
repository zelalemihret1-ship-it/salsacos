const PRODUCTS = {
  tacos: { name: "Tacos", price: 250 },
  special_tacos: { name: "Special Tacos", price: 300 },
  wrap: { name: "Wrap", price: 200 },
  special_wrap: { name: "Special Wrap", price: 250 },
  ketchup: { name: "Ketchup", price: 40 },
  mayonnaise: { name: "Mayonnaise", price: 40 },
  salsacos_sauce: { name: "Salsacos Sauce", price: 50 },
  coca_cola: { name: "Coca-Cola", price: 70 },
  fanta: { name: "Fanta", price: 70 },
  sprite: { name: "Sprite", price: 70 },
  water: { name: "Bottled Water", price: 50 },
  milkshake: { name: "Milkshake", price: 350 },
  strawberry_shake: { name: "Strawberry Shake", price: 350 },
  strawberry_mojito: { name: "Strawberry Mojito", price: 450 },
  mint_mojito: { name: "Mint Mojito", price: 450 },
  dashen_beer: {
    name: "Dashen Beer",
    price: 120,
    alcohol: true
  },
  st_george_beer: {
    name: "St. George Beer",
    price: 120,
    alcohol: true
  },
  arada_beer: {
    name: "Arada Beer",
    price: 120,
    alcohol: true
  }
};

const DELIVERY_FEE = 50;

const KNOWN_ORIGINS = [
  "https://salsacos.zelalemihret1.workers.dev",
  "https://sweet-violet-7514.zelalemihret1.workers.dev"
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    const allowedOrigins = new Set([
      ...KNOWN_ORIGINS,
      ...(env.ALLOWED_ORIGIN || "")
        .split(",")
        .map(value => value.trim().replace(/\/$/, ""))
        .filter(Boolean),
      ...(env.ALLOWED_ORIGINS || "")
        .split(",")
        .map(value => value.trim().replace(/\/$/, ""))
        .filter(Boolean)
    ]);

    const originAllowed = allowedOrigins.has(
      origin.replace(/\/$/, "")
    );

    const cors = {
      "Vary": "Origin",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      ...(originAllowed
        ? { "Access-Control-Allow-Origin": origin }
        : {})
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: originAllowed ? 204 : 403,
        headers: cors
      });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({
        ok: true,
        service: "Salsacos order API"
      }, 200, cors);
    }

    if (url.pathname !== "/api/orders" || request.method !== "POST") {
      return json({
        ok: false,
        error: "Endpoint not found."
      }, 404, cors);
    }

    if (!originAllowed) {
      return json({
        ok: false,
        error: "Frontend origin is not allowed."
      }, 403, cors);
    }

    if (!env.BOT_TOKEN || !env.CHANNEL_ID) {
      return json({
        ok: false,
        error: "Order service is not configured."
      }, 500, cors);
    }

    try {
      const body = await request.json();

      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return json({
          ok: false,
          error: "Invalid order request."
        }, 400, cors);
      }

      // Verify that the order comes from an authenticated
      // Telegram Mini App session.
      const verified = await verifyTelegramInitData(
        body.initData,
        env.BOT_TOKEN
      );

      if (!verified.ok) {
        return json({
          ok: false,
          error: "Telegram verification failed. Close and reopen the Mini App from Telegram, then try again."
        }, 401, cors);
      }

      const name = clean(body.name, 100);
      const phone = clean(body.phone, 40);
      const address = clean(body.address, 500);

      const orderType = [
        "delivery",
        "pickup",
        "dine_in"
      ].includes(body.order_type)
        ? body.order_type
        : "";

      const payment = [
        "telebirr",
        "cbe",
        "cash"
      ].includes(body.payment)
        ? body.payment
        : "";

      if (
        name.length < 2 ||
        phone.replace(/\D/g, "").length < 7 ||
        !orderType ||
        !payment
      ) {
        return json({
          ok: false,
          error: "Please check your name, phone number, order type, and payment method."
        }, 400, cors);
      }

      if (orderType === "delivery" && address.length < 3) {
        return json({
          ok: false,
          error: "Please enter your delivery address."
        }, 400, cors);
      }

      if (
        !Array.isArray(body.items) ||
        body.items.length < 1 ||
        body.items.length > 30
      ) {
        return json({
          ok: false,
          error: "Your cart is empty or invalid."
        }, 400, cors);
      }

      let subtotal = 0;
      let hasAlcohol = false;

      const lines = [];
      const seen = new Set();

      for (const item of body.items) {
        const id = String(item?.id || "");
        const product = PRODUCTS[id];
        const qty = Number(item?.qty);

        if (
          !product ||
          !Number.isInteger(qty) ||
          qty < 1 ||
          qty > 20 ||
          seen.has(id)
        ) {
          return json({
            ok: false,
            error: "One or more products are invalid. Refresh the menu and try again."
          }, 400, cors);
        }

        seen.add(id);

        const lineTotal = product.price * qty;
        subtotal += lineTotal;
        hasAlcohol ||= !!product.alcohol;

        lines.push(
          `• ${product.name} × ${qty} = ${lineTotal} ETB`
        );
      }

      if (hasAlcohol && body.age_confirmed !== true) {
        return json({
          ok: false,
          error: "Age confirmation is required for alcohol orders."
        }, 400, cors);
      }

      const fee = orderType === "delivery" ? DELIVERY_FEE : 0;
      const total = subtotal + fee;

      const orderCode = crypto.randomUUID()
        .replace(/-/g, "")
        .slice(0, 8)
        .toUpperCase();

      const user = verified.user || {};

      const userLine = user.username
        ? `Telegram: @${clean(user.username, 64)}`
        : user.id
          ? `Telegram user ID: ${user.id}`
          : "Telegram user verified";

      const orderMessage = [
        "🛎️ NEW SALSACOS ORDER",
        `Order: #${orderCode}`,
        "",
        ...lines,
        "",
        `Subtotal: ${subtotal} ETB`,
        `Delivery fee: ${fee} ETB`,
        `TOTAL: ${total} ETB`,
        "",
        `Order type: ${orderType.replace("_", " ")}`,
        `Payment: ${payment.toUpperCase()}`,
        `Customer: ${name}`,
        `Phone: ${phone}`,
        `Address: ${orderType === "delivery" ? address : "Not required"}`,
        userLine,
        hasAlcohol
          ? "Age confirmation: customer confirmed."
          : ""
      ].filter(Boolean).join("\n");

      // 1. Send the order to the configured Telegram channel.
      let telegramResponse;

      try {
        telegramResponse = await fetch(
          `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              chat_id: env.CHANNEL_ID,
              text: orderMessage,
              disable_web_page_preview: true
            })
          }
        );
      } catch (error) {
        console.error("Telegram network error:", String(error));

        return json({
          ok: false,
          error: "Could not contact Telegram. Your order was not confirmed. Please try again."
        }, 502, cors);
      }

      const telegramData = await telegramResponse
        .json()
        .catch(() => ({}));

      if (!telegramResponse.ok || !telegramData.ok) {
        console.error(
          "Telegram order delivery failed:",
          telegramData.description || telegramResponse.status
        );

        return json({
          ok: false,
          error: "Telegram could not accept the order. Please try again later."
        }, 502, cors);
      }

      // The order has now been accepted by Telegram.
      // A private confirmation is attempted only if the
      // customer has a verified Telegram user ID.
      let privateConfirmationSent = false;

      if (user.id) {
        try {
          const privateResponse = await fetch(
            `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                chat_id: user.id,
                text: [
                  "✅ ORDER RECEIVED — SALSACOS",
                  "",
                  `Your order number is #${orderCode}.`,
                  `Total: ${total} ETB`,
                  "",
                  "Your order has been sent to our team.",
                  "Thank you for ordering from Salsacos!"
                ].join("\n")
              })
            }
          );

          const privateData = await privateResponse
            .json()
            .catch(() => ({}));

          privateConfirmationSent =
            privateResponse.ok && privateData.ok === true;
        } catch (error) {
          console.error(
            "Private customer confirmation failed:",
            String(error)
          );
        }
      }

      // 2. Return a clear confirmation to the Mini App.
      return json({
        ok: true,
        order_code: orderCode,
        message: `✅ Order placed successfully! Your order number is #${orderCode}. Total: ${total} ETB. Thank you for ordering from Salsacos!`,
        total: total,
        currency: "ETB",
        customer_confirmation_sent: privateConfirmationSent
      }, 200, cors);

    } catch (error) {
      console.error("Order API error:", String(error));

      return json({
        ok: false,
        error: "Could not process the order. Please try again."
      }, 500, cors);
    }
  }
};

function json(data, status, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

function clean(value, max) {
  return String(value ?? "")
    .replace(/[<>\u0000-\u001F]/g, " ")
    .trim()
    .slice(0, max);
}

async function verifyTelegramInitData(initData, botToken) {
  if (
    typeof initData !== "string" ||
    !initData ||
    initData.length > 10000
  ) {
    return { ok: false };
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");

  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
    return { ok: false };
  }

  params.delete("hash");

  const pairs = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b));

  const dataCheckString = pairs
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const encoder = new TextEncoder();

  const webAppKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(botToken),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const secretKey = await crypto.subtle.sign(
    "HMAC",
    webAppKey,
    encoder.encode("WebAppData")
  );

  const checkKey = await crypto.subtle.importKey(
    "raw",
    secretKey,
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const calculated = [
    ...new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        checkKey,
        encoder.encode(dataCheckString)
      )
    )
  ].map(byte => byte.toString(16).padStart(2, "0")).join("");

  if (!constantTimeEqual(calculated, receivedHash.toLowerCase())) {
    return { ok: false };
  }

  const authDate = Number(params.get("auth_date"));
  const now = Math.floor(Date.now() / 1000);

  if (
    !Number.isFinite(authDate) ||
    authDate > now + 60 ||
    now - authDate > 86400
  ) {
    return { ok: false };
  }

  let user = null;

  try {
    user = JSON.parse(params.get("user") || "null");
  } catch {
    return { ok: false };
  }

  return { ok: true, user };
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;

  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return diff === 0;
}
