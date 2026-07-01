const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const prisma = new PrismaClient();

async function run() {
  try {
    console.log('== LOGIN ==');
    const loginRes = await axios.post('http://localhost:3000/api/auth/login', {
      email: 'admin@testclinic.com',
      password: 'testpass123',
    });
    const token = loginRes.data.token;
    const headers = { Authorization: `Bearer ${token}` };

    const clinic = await prisma.clinic.findFirst();

    console.log('\n== CREATE TEST CONVERSATION ==');
    const conv = await prisma.conversation.create({
      data: {
        clinicId: clinic.id,
        patientPhone: '2349000000099',
        patientName: 'Test Patient',
        status: 'NEEDS_REVIEW',
        aiState: { state: 'START', data: {}, history: [] }
      }
    });
    console.log('Created conversation:', conv.id);

    console.log('\n== GET /api/conversations ==');
    const listRes = await axios.get('http://localhost:3000/api/conversations', { headers });
    console.log('Status:', listRes.status);
    console.log(JSON.stringify(listRes.data, null, 2));

    console.log('\n== GET /api/conversations/counts ==');
    const countsRes = await axios.get('http://localhost:3000/api/conversations/counts', { headers });
    console.log('Status:', countsRes.status);
    console.log(JSON.stringify(countsRes.data, null, 2));

    console.log(`\n== GET /api/conversations/${conv.id} ==`);
    const getRes = await axios.get(`http://localhost:3000/api/conversations/${conv.id}`, { headers });
    console.log('Status:', getRes.status);
    console.log(JSON.stringify(getRes.data, null, 2));

    console.log(`\n== POST /api/conversations/${conv.id}/take-over ==`);
    const takeOverRes = await axios.post(`http://localhost:3000/api/conversations/${conv.id}/take-over`, {}, { headers });
    console.log('Status:', takeOverRes.status);
    console.log(JSON.stringify(takeOverRes.data, null, 2));

    console.log(`\n== POST /api/conversations/${conv.id}/reply ==`);
    try {
      const replyRes = await axios.post(`http://localhost:3000/api/conversations/${conv.id}/reply`, {
        content: "Hi, this is the clinic staff"
      }, { headers });
      console.log('Status:', replyRes.status);
      console.log(JSON.stringify(replyRes.data, null, 2));
    } catch (e) {
      console.log('Reply failed:', e.response?.data || e.message);
    }

    console.log(`\n== POST /api/conversations/${conv.id}/resolve ==`);
    const resolveRes = await axios.post(`http://localhost:3000/api/conversations/${conv.id}/resolve`, {}, { headers });
    console.log('Status:', resolveRes.status);
    console.log(JSON.stringify(resolveRes.data, null, 2));

  } catch (err) {
    console.error('Error:', err.response?.data || err.message);
  } finally {
    await prisma.$disconnect();
  }
}
run();
