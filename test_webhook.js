const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  console.log('== UPDATING DB ==');
  await prisma.$executeRaw`
    UPDATE "Clinic"
    SET "phoneNumberId" = '1132724323258409',
        "phoneNumber" = '+2349021191779',
        "whatsappStatus" = 'CONNECTED'
    WHERE name = 'Test Clinic';
  `;

  console.log('== VERIFY WEBHOOK ==');
  const res1 = await fetch('http://localhost:3000/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=latencyzero2026&hub.challenge=TEST123');
  console.log('Status:', res1.status);
  console.log('Body:', await res1.text());

  const payload = {
    "object": "whatsapp_business_account",
    "entry": [{
      "id": "test",
      "changes": [{
        "field": "messages",
        "value": {
          "metadata": { "phone_number_id": "1132724323258409" },
          "contacts": [{ "profile": { "name": "Test Patient" }, "wa_id": "2349000000001" }],
          "messages": [{
            "from": "2349000000001",
            "id": "test-msg-001",
            "type": "text",
            "text": { "body": "Hi" },
            "timestamp": "1234567890"
          }]
        }
      }]
    }]
  };

  console.log('== SEND MESSAGE 1 ==');
  const res2 = await fetch('http://localhost:3000/webhook/whatsapp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  console.log('Status:', res2.status);
  
  // Wait a moment for async brain process to finish saving to DB
  await new Promise(r => setTimeout(r, 8000));
  
  const conversation = await prisma.conversation.findFirst({
    where: { patientPhone: '2349000000001' }
  });
  console.log('Conversation Row:', JSON.stringify(conversation, null, 2));

  console.log('== SEND MESSAGE 2 ==');
  payload.entry[0].changes[0].value.messages[0].id = "test-msg-002";
  payload.entry[0].changes[0].value.messages[0].text.body = "My name is John, I am 34, male";
  
  const res3 = await fetch('http://localhost:3000/webhook/whatsapp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  console.log('Status:', res3.status);

  await new Promise(r => setTimeout(r, 8000));
  
  const conversationUpdated = await prisma.conversation.findFirst({
    where: { patientPhone: '2349000000001' }
  });
  console.log('Updated aiState:', JSON.stringify(conversationUpdated.aiState, null, 2));

  console.log('== SEND DUPLICATE MESSAGE 1 ==');
  payload.entry[0].changes[0].value.messages[0].id = "test-msg-001";
  
  const res4 = await fetch('http://localhost:3000/webhook/whatsapp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  console.log('Status:', res4.status);

  // Allow log time
  await new Promise(r => setTimeout(r, 2000));

  await prisma.$disconnect();
}

run().catch(console.error);
