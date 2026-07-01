const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const prisma = new PrismaClient();

async function run() {
  try {
    console.log('== POST /api/auth/login ==');
    const loginRes = await axios.post('http://localhost:3000/api/auth/login', {
      email: 'admin@testclinic.com',
      password: 'testpass123',
    });
    const token = loginRes.data.token;
    const headers = { Authorization: `Bearer ${token}` };
    console.log(JSON.stringify(loginRes.data, null, 2));

    console.log('\n== PATCH /api/clinic ==');
    const updateClinicRes = await axios.patch('http://localhost:3000/api/clinic', {
      operatingHours: { days: ["Mon","Tue","Wed","Thu","Fri"], openTime: "09:00", closeTime: "17:00" },
      servicesOffered: ["Cardiology", "General Medicine"]
    }, { headers });
    console.log('Status:', updateClinicRes.status);
    console.log(JSON.stringify(updateClinicRes.data, null, 2));

    console.log('\n== POST /api/staff ==');
    // Randomize email to avoid collision
    const addStaffRes = await axios.post('http://localhost:3000/api/staff', {
      fullName: "Dr. Lan",
      email: `lan-${Date.now()}@testclinic.com`,
      role: "PHYSICIAN",
      roleOrSpecialization: "Cardiologist"
    }, { headers });
    console.log('Status:', addStaffRes.status);
    console.log(JSON.stringify(addStaffRes.data, null, 2));

    console.log('\n== GET /api/analytics/dashboard ==');
    const dashboardRes = await axios.get('http://localhost:3000/api/analytics/dashboard', { headers });
    console.log('Status:', dashboardRes.status);
    console.log(JSON.stringify(dashboardRes.data, null, 2));

    console.log('\n== GET /api/appointments ==');
    const aptRes = await axios.get('http://localhost:3000/api/appointments', { headers });
    console.log(JSON.stringify(aptRes.data[0] || aptRes.data, null, 2));

    console.log('\n== GET /api/queue ==');
    const queueRes = await axios.get('http://localhost:3000/api/queue', { headers });
    console.log(JSON.stringify(queueRes.data.waiting[0] || queueRes.data.waiting, null, 2));

    console.log('\n== GET /api/conversations/:id ==');
    const convRes1 = await axios.get('http://localhost:3000/api/conversations?status=NEEDS_REVIEW', { headers });
    if (convRes1.data.length > 0) {
      const convId = convRes1.data[0].id;
      // take over
      await axios.post(`http://localhost:3000/api/conversations/${convId}/take-over`, {}, { headers });
      const convRes2 = await axios.get(`http://localhost:3000/api/conversations/${convId}`, { headers });
      console.log(JSON.stringify(convRes2.data.systemEvents, null, 2));
    } else {
      console.log("No NEEDS_REVIEW conversations found.");
    }

    console.log('\n== GET /api/patients/:id ==');
    const patientsRes = await axios.get('http://localhost:3000/api/patients', { headers });
    if (patientsRes.data.length > 0) {
      const patientId = patientsRes.data[0].id;
      const patientRes = await axios.get(`http://localhost:3000/api/patients/${patientId}`, { headers });
      console.log("intakeNotes:");
      console.log(JSON.stringify(patientRes.data.intakeNotes, null, 2));
      console.log("history:");
      console.log(JSON.stringify(patientRes.data.history, null, 2));
    } else {
      console.log("No patients found.");
    }

  } catch (err) {
    console.error('Error:', err.response?.data || err.message);
  } finally {
    await prisma.$disconnect();
  }
}
run();
