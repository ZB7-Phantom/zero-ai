// One-off script to verify Gmail SMTP credentials before setting them in Railway.
// Usage: set GMAIL_USER, GMAIL_APP_PASSWORD, and TEST_EMAIL_TO in .env, then run:
//   node test_email.js
require('dotenv').config();
const nodemailer = require('nodemailer');

async function main() {
  const { GMAIL_USER, GMAIL_APP_PASSWORD, TEST_EMAIL_TO } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    console.error('Set GMAIL_USER and GMAIL_APP_PASSWORD in .env first.');
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });

  await transporter.sendMail({
    from: `Zero Clinic OS <${GMAIL_USER}>`,
    to: TEST_EMAIL_TO || GMAIL_USER,
    subject: 'Zero Clinic OS — SMTP test',
    text: 'If you got this, Gmail SMTP is configured correctly.',
  });

  console.log(`Sent successfully to ${TEST_EMAIL_TO || GMAIL_USER}. Check the inbox (and spam folder).`);
}

main().catch((err) => {
  console.error('Send failed:', err.message);
  process.exit(1);
});
