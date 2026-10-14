import os
import json
import logging
import secrets
import hashlib
import hmac
import time
from urllib.parse import parse_qsl
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

import requests
from flask import Flask, jsonify, request, send_from_directory

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
log = logging.getLogger("salsacos")

app = Flask(__name__, static_folder=None)

BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()
CHANNEL_ID = os.getenv("CHANNEL_ID", "").strip()
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "").strip()
WEBHOOK_URL = os.getenv("WEBHOOK_URL", "").strip().rstrip("/")
PORT = int(os.getenv("PORT", "10000"))

# Server-side prices are authoritative. Edit these to match your actual menu.
PRODUCTS = {
    "tacos": {"name": "Tacos", "price": 250, "emoji": "🌮"},
    "special_tacos": {"name": "Special Tacos", "price": 300, "emoji": "🌮"},
    "wrap": {"name": "Wrap", "price": 200, "emoji": "🌯"},
    "special_wrap": {"name": "Special Wrap", "price": 250, "emoji": "🌯"},
    "ketchup": {"name": "Ketchup", "price": 40, "emoji": "🍅"},
    "mayonnaise": {"name": "Mayonnaise", "price": 40, "emoji": "🥣"},
    "salsacos_sauce": {"name": "Salsacos Sauce", "price": 50, "emoji": "🌶️"},
    "coca_cola": {"name": "Coca-Cola", "price": 70, "emoji": "🥤"},
    "fanta": {"name": "Fanta", "price": 70, "emoji": "🍊"},
    "sprite": {"name": "Sprite", "price": 70, "emoji": "🍋"},
    "water": {"name": "Bottled Water", "price": 50, "emoji": "💧"},
    "milkshake": {"name": "Milkshake", "price": 350, "emoji": "🥤"},
    "strawberry_shake": {"name": "Strawberry Shake", "price": 350, "emoji": "🍓"},
    "strawberry_mojito": {"name": "Strawberry Mojito", "price": 450, "emoji": "🍓"},
    "mint_mojito": {"name": "Mint Mojito", "price": 450, "emoji": "🌿"},
    "dashen_beer": {"name": "Dashen Beer", "price": 120, "emoji": "🍺"},
    "st_george_beer": {"name": "St. George Beer", "price": 120, "emoji": "🍺"},
    "arada_beer": {"name": "Arada Beer", "price": 120, "emoji": "🍺"},
}
DELIVERY_FEE = 50
MAX_QTY_PER_ITEM = 50
ALLOWED_ORDER_TYPES = {"delivery", "pickup", "dine_in"}
ALLOWED_PAYMENTS = {"telebirr", "cbe", "cash"}


def telegram_api(method: str, payload: dict[str, Any]) -> dict[str, Any]:
    if not BOT_TOKEN:
        raise RuntimeError("BOT_TOKEN environment variable is missing")
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/{method}"
    response = requests.post(url, json=payload, timeout=20)
    response.raise_for_status()
    data = response.json()
    if not data.get("ok"):
        raise RuntimeError(f"Telegram API error: {data}")
    return data["result"]


def send_text(chat_id: str | int, text: str, reply_markup: dict | None = None) -> None:
    payload = {"chat_id": chat_id, "text": text}
    if reply_markup:
        payload["reply_markup"] = reply_markup
    telegram_api("sendMessage", payload)


def clean_text(value: Any, limit: int = 500) -> str:
    if value is None:
        return ""
    return str(value).strip()[:limit]


def validate_telegram_init_data(init_data: str) -> dict[str, Any]:
    """Validate Telegram Web App initData using the bot token."""
    if not BOT_TOKEN:
        raise ValueError("The bot is not configured.")
    if not init_data or len(init_data) > 10000:
        raise ValueError("Open this app inside Telegram and try again.")
    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = pairs.pop("hash", None)
    if not received_hash:
        raise ValueError("Telegram authentication data is missing.")
    check_string = "\\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode("utf-8"), hashlib.sha256).digest()
    expected_hash = hmac.new(secret_key, check_string.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected_hash, received_hash):
        raise ValueError("Telegram authentication failed. Reopen the app from Telegram.")
    try:
        auth_date = int(pairs.get("auth_date", "0"))
        user = json.loads(pairs.get("user", "{}"))
    except (ValueError, json.JSONDecodeError):
        raise ValueError("Invalid Telegram authentication data.")
    if auth_date <= 0 or abs(int(time.time()) - auth_date) > 86400:
        raise ValueError("Your Telegram session has expired. Reopen the app and try again.")
    if not isinstance(user, dict) or not user.get("id"):
        raise ValueError("Telegram user information is missing.")
    return user


def format_money(value: int) -> str:
    return f"{value:,} ETB"


def build_order(data: dict[str, Any], telegram_user: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise ValueError("Order data must be an object.")

    items_in = data.get("items")
    if not isinstance(items_in, list) or not items_in:
        raise ValueError("Your cart is empty.")

    items = []
    subtotal = 0
    seen = set()
    for raw in items_in:
        if not isinstance(raw, dict):
            raise ValueError("Invalid item in order.")
        product_id = clean_text(raw.get("id"), 80)
        if product_id not in PRODUCTS:
            raise ValueError(f"Unknown menu item: {product_id or 'unknown'}.")
        if product_id in seen:
            raise ValueError("The order contains a repeated item. Please submit again.")
        seen.add(product_id)
        try:
            qty = int(raw.get("qty", 0))
        except (TypeError, ValueError):
            raise ValueError("Invalid item quantity.")
        if qty < 1 or qty > MAX_QTY_PER_ITEM:
            raise ValueError(f"Quantity for {PRODUCTS[product_id]['name']} must be between 1 and {MAX_QTY_PER_ITEM}.")
        product = PRODUCTS[product_id]
        line_total = product["price"] * qty
        subtotal += line_total
        items.append({
            "id": product_id,
            "name": product["name"],
            "emoji": product["emoji"],
            "unit_price": product["price"],
            "qty": qty,
            "line_total": line_total,
        })

    order_type = clean_text(data.get("order_type"), 30)
    payment = clean_text(data.get("payment"), 30)
    if order_type not in ALLOWED_ORDER_TYPES:
        raise ValueError("Choose delivery, self-pickup, or dine-in.")
    if payment not in ALLOWED_PAYMENTS:
        raise ValueError("Choose a valid payment method.")

    name = clean_text(data.get("name"), 120)
    phone = clean_text(data.get("phone"), 40)
    address = clean_text(data.get("address"), 500)
    if len(name) < 2:
        raise ValueError("Please enter the customer's full name.")
    if sum(ch.isdigit() for ch in phone) < 7:
        raise ValueError("Please enter a valid phone number.")
    if order_type == "delivery" and len(address) < 3:
        raise ValueError("A delivery address is required.")

    has_alcohol = any(item["id"] in {"dashen_beer", "st_george_beer", "arada_beer"} for item in items)
    age_confirmed = bool(data.get("age_confirmed"))
    if has_alcohol and not age_confirmed:
        raise ValueError("Age confirmation is required for an order containing alcohol.")

    delivery_fee = DELIVERY_FEE if order_type == "delivery" else 0
    user = telegram_user or {}
    username = clean_text(user.get("username"), 100)
    first_name = clean_text(user.get("first_name"), 100)
    last_name = clean_text(user.get("last_name"), 100)

    return {
        "items": items,
        "subtotal": subtotal,
        "delivery_fee": delivery_fee,
        "total": subtotal + delivery_fee,
        "order_type": order_type,
        "payment": payment,
        "name": name,
        "phone": phone,
        "address": address if order_type == "delivery" else "Not required",
        "age_confirmed": age_confirmed,
        "telegram_user_id": user.get("id"),
        "telegram_username": username,
        "telegram_name": " ".join(x for x in [first_name, last_name] if x),
        "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
    }


def format_channel_order(order: dict[str, Any], order_id: str) -> str:
    lines = [
        "🍽️ NEW SALSACOS FOOD ORDER",
        f"🧾 Order: {order_id}",
        f"🕒 Time: {order['created_at']}",
        "",
        "🛒 ITEMS",
    ]
    for item in order["items"]:
        lines.append(
            f"{item['emoji']} {item['name']} × {item['qty']} — {format_money(item['line_total'])}"
        )
    lines.extend([
        "",
        f"Subtotal: {format_money(order['subtotal'])}",
        f"Delivery fee: {format_money(order['delivery_fee'])}",
        f"💰 TOTAL: {format_money(order['total'])}",
        "",
        f"👤 Customer: {order['name']}",
        f"📞 Phone: {order['phone']}",
        f"🚚 Order type: {order['order_type'].replace('_', ' ').title()}",
        f"💳 Payment method: {order['payment'].upper()}",
        f"📍 Address: {order['address']}",
    ])
    if order["telegram_username"]:
        lines.append(f"Telegram: @{order['telegram_username']}")
    elif order["telegram_user_id"]:
        lines.append(f"Telegram user ID: {order['telegram_user_id']}")
    if any(i["id"] in {"dashen_beer", "st_george_beer", "arada_beer"} for i in order["items"]):
        lines.append("🔞 Customer checked the legal drinking-age confirmation in the app.")
    lines.extend(["", "⚠️ Payment is not verified by this notification."])
    return "\n".join(lines)


def accept_and_send_order(data: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    if data.get("type") != "salsacos_order":
        raise ValueError("Invalid order request.")
    order = build_order(data, user)
    order_id = f"SAL-{secrets.token_hex(3).upper()}"
    if not CHANNEL_ID:
        raise RuntimeError("CHANNEL_ID environment variable is missing")
    send_text(CHANNEL_ID, format_channel_order(order, order_id))
    return {"order_id": order_id, "total": order["total"]}


def process_web_app_order(message: dict[str, Any]) -> None:
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    user = message.get("from") or {}
    web_app_data = message.get("web_app_data") or {}
    raw = web_app_data.get("data", "")

    if not chat_id:
        log.warning("web_app_data update did not include a chat ID")
        return

    try:
        data = json.loads(raw)
        if data.get("type") != "salsacos_order":
            raise ValueError("This does not look like a Salsacos order.")
        order = build_order(data, user)
        order_id = f"SAL-{secrets.token_hex(3).upper()}"
        if not CHANNEL_ID:
            raise RuntimeError("CHANNEL_ID environment variable is missing")
        send_text(CHANNEL_ID, format_channel_order(order, order_id))
        send_text(
            chat_id,
            f"✅ Your order request {order_id} was sent to Salsacos.\n"
            f"Total: {format_money(order['total'])}\n"
            "The restaurant will contact you to confirm availability and payment. "
            "This message does not mean Telebirr/CBE payment has been verified."
        )
    except ValueError as exc:
        send_text(chat_id, f"❌ I could not accept this order: {exc}")
    except Exception:
        log.exception("Failed to process a food order")
        try:
            send_text(chat_id, "⚠️ Sorry, your order could not be sent to the restaurant. Please try again or contact @zilasun.")
        except Exception:
            log.exception("Could not notify customer about failed order")


@app.get("/")
def index():
    return send_from_directory(app.root_path, "index.html")


@app.get("/health")
def health():
    return jsonify({"ok": True, "service": "salsacos-food-order-bot"})


@app.post("/api/orders")
def api_orders():
    body = request.get_json(silent=True) or {}
    try:
        user = validate_telegram_init_data(clean_text(body.get("initData"), 10000))
        order_data = body.get("order")
        if not isinstance(order_data, dict):
            raise ValueError("Invalid order details.")
        result = accept_and_send_order(order_data, user)
        return jsonify({"ok": True, "order_id": result["order_id"], "total": result["total"], "currency": "ETB"})
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception:
        log.exception("API order could not be sent")
        return jsonify({"ok": False, "error": "The order could not be sent. Please try again or contact @zilasun."}), 500


@app.post("/telegram-webhook")
def telegram_webhook():
    # Telegram sends this header when the webhook was registered with secret_token.
    if WEBHOOK_SECRET:
        supplied = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
        if not secrets.compare_digest(supplied, WEBHOOK_SECRET):
            return jsonify({"ok": False, "error": "unauthorized"}), 403

    update = request.get_json(silent=True) or {}
    try:
        message = update.get("message") or update.get("edited_message") or {}
        if message.get("web_app_data"):
            process_web_app_order(message)
        elif message.get("text") == "/start" and message.get("chat", {}).get("id"):
            send_text(
                message["chat"]["id"],
                "Welcome to Salsacos! Open the Food Order Mini App from the bot menu to place an order."
            )
    except Exception:
        log.exception("Could not process Telegram update")
        # Return 200 to avoid Telegram repeatedly retrying an update that has already failed.
    return jsonify({"ok": True})


def configure_webhook() -> None:
    if not BOT_TOKEN or not WEBHOOK_URL:
        log.warning("BOT_TOKEN or WEBHOOK_URL is not configured; webhook registration skipped.")
        return
    payload = {"url": f"{WEBHOOK_URL}/telegram-webhook"}
    if WEBHOOK_SECRET:
        payload["secret_token"] = WEBHOOK_SECRET
    try:
        telegram_api("setWebhook", payload)
        log.info("Telegram webhook configured.")
    except Exception:
        log.exception("Could not configure Telegram webhook. Check BOT_TOKEN and WEBHOOK_URL.")


# Register the webhook when the WSGI app is imported by Render/Gunicorn.
# If environment variables are not configured yet, this safely logs a warning.
configure_webhook()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT)
