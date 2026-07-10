// One-off script to verify Brevo credentials before setting them in Railway.
// Usage: set BREVO_API_KEY, FROM_EMAIL, and TEST_EMAIL_TO in .env, then run:
//   node test_email.js
require('dotenv').config();
const axios = require('axios');

async function main() {
  const { BREVO_API_KEY, FROM_EMAIL, TEST_EMAIL_TO } = process.env;
  if (!BREVO_API_KEY || !FROM_EMAIL) {
    console.error('Set BREVO_API_KEY and FROM_EMAIL in .env first.');
    process.exit(1);
  }

  const to = TEST_EMAIL_TO || FROM_EMAIL;

  await axios.post(
    'https://api.brevo.com/v3/smtp/email',
    {
      sender: { email: FROM_EMAIL, name: 'Zero Clinic OS' },
      to: [{ email: to }],
      subject: 'Zero Clinic OS — Brevo test',
      textContent: 'If you got this, Brevo is configured correctly.',
    },
    { headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' } }
  );

  console.log(`Sent successfully to ${to}. Check the inbox (and spam folder).`);
}

main().catch((err) => {
  console.error('Send failed:', err.response ? JSON.stringify(err.response.data) : err.message);
  process.exit(1);
});
