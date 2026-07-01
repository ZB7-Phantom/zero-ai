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

    console.log('\n== GET /api/notifications (Initial) ==');
    const listRes1 = await axios.get('http://localhost:3000/api/notifications', { headers });
    console.log('Status:', listRes1.status);
    console.log(JSON.stringify(listRes1.data, null, 2));

    console.log('\n== CREATE TEST NOTIFICATION ==');
    const notif1 = await prisma.notification.create({
      data: {
        clinicId: clinic.id,
        type: 'escalation',
        title: 'Symptom flagged as urgent',
        body: 'Test notification',
        metadata: {}
      }
    });
    console.log('Created notification:', notif1.id);

    console.log('\n== GET /api/notifications (After Insert) ==');
    const listRes2 = await axios.get('http://localhost:3000/api/notifications', { headers });
    console.log('Status:', listRes2.status);
    console.log(JSON.stringify(listRes2.data, null, 2));

    console.log(`\n== PATCH /api/notifications/${notif1.id}/read ==`);
    const readRes = await axios.patch(`http://localhost:3000/api/notifications/${notif1.id}/read`, {}, { headers });
    console.log('Status:', readRes.status);
    console.log(JSON.stringify(readRes.data, null, 2));

    console.log('\n== GET /api/notifications (After Read) ==');
    const listRes3 = await axios.get('http://localhost:3000/api/notifications', { headers });
    console.log('Status:', listRes3.status);
    console.log(JSON.stringify(listRes3.data, null, 2));

    console.log('\n== CREATE TWO MORE NOTIFICATIONS ==');
    await prisma.notification.create({
      data: { clinicId: clinic.id, type: 'escalation', title: 'Test 2', body: 'Body 2', metadata: {} }
    });
    await prisma.notification.create({
      data: { clinicId: clinic.id, type: 'no_show', title: 'Test 3', body: 'Body 3', metadata: {} }
    });

    console.log('\n== PATCH /api/notifications/read-all ==');
    const readAllRes = await axios.patch(`http://localhost:3000/api/notifications/read-all`, {}, { headers });
    console.log('Status:', readAllRes.status);
    console.log(JSON.stringify(readAllRes.data, null, 2));

    console.log('\n== GET /api/notifications (After Read All) ==');
    const listRes4 = await axios.get('http://localhost:3000/api/notifications', { headers });
    console.log('Status:', listRes4.status);
    console.log(JSON.stringify(listRes4.data, null, 2));

  } catch (err) {
    console.error('Error:', err.response?.data || err.message);
  } finally {
    await prisma.$disconnect();
  }
}
run();
