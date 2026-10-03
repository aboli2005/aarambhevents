# Aarambh Dandiya Nights 2026

Website (React + Vite) on Netlify, API (Node + Express) on Render, data in MongoDB Atlas.

## Run locally
    npm install
    cp .env.example .env        # fill in MONGODB_URI, staff logins, AUTH_SECRET (+ Razorpay keys, or DEMO_PAYMENTS=true)
    npm run server              # terminal 1 (API on :5000)
    npm run dev                 # terminal 2 (website on :5173)

## Deploy
1. MongoDB Atlas: create a cluster, a database user, and allow network access 0.0.0.0/0. Copy the connection string into MONGODB_URI.
2. Render: New > Web Service from this repo. Build command `npm install`, start command `npm start`, Health Check Path `/health`.
   Use a paid instance (a free one sleeps). Add every line of .env.example in the Environment tab.
3. Razorpay: Webhooks > Add: URL `https://YOUR-SERVICE.onrender.com/api/webhook`, secret = RAZORPAY_WEBHOOK_SECRET, events `payment.captured` and `order.paid`.
   Settings > Payment Capture: set to Automatic.
4. Netlify: build command `npm run build`, publish directory `dist`. Edit `public/_redirects` and put your Render service name before deploying.
5. Put your Netlify address in SITE_URL on Render.
6. Ticket e-mail is OPTIONAL. Without it, customers download the ticket on the confirmation page and can get it again any time from the "Find my ticket" page (phone + e-mail used at booking). To also e-mail tickets (sent from aarambheventmail@gmail.com):
   - FREE Render blocks normal e-mail (SMTP), so use Brevo: sign up at brevo.com, Senders & IPs > add `aarambheventmail@gmail.com` and click the verification link sent to that inbox, SMTP & API > API keys > create a key, and put it in BREVO_API_KEY on Render. Free plan: 300 e-mails a day.
   - PAID Render (or your own PC): leave BREVO_API_KEY empty and fill SMTP_PASS with a Gmail App password (Google account > Security > 2-Step Verification on, then App passwords).

## How it stays reliable
- Booking is created on the server. The price is calculated on the server, never taken from the browser.
- A ticket is issued exactly once per payment, whether the browser, the Razorpay webhook or the 1-minute background check confirms it first.
- Check-in is one atomic database update, so two gates cannot admit the same ticket.
- Failed ticket e-mails are retried automatically (up to 5 times) and can be re-sent from the dashboard.
- Staff login is checked on the server; passwords live only in server environment variables.
