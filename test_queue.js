const axios = require('axios');
const fs = require('fs');

async function run() {
  try {
    console.log('== LOGIN ==');
    const loginRes = await axios.post('http://localhost:3000/api/auth/login', {
      email: 'admin@testclinic.com',
      password: 'testpass123',
    });
    const token = loginRes.data.token;
    console.log('Token received');

    const headers = { Authorization: `Bearer ${token}` };

    console.log('\n== POST /api/queue/walk-in ==');
    const walkInRes = await axios.post('http://localhost:3000/api/queue/walk-in', {
      name: 'Jane Doe',
      phone: '2349000000002',
      complaint: 'Headache',
      department: 'General'
    }, { headers });
    console.log('Status:', walkInRes.status);
    console.log(JSON.stringify(walkInRes.data, null, 2));
    const patientId = walkInRes.data.id;

    console.log('\n== GET /api/queue ==');
    const queueRes = await axios.get('http://localhost:3000/api/queue', { headers });
    console.log('Status:', queueRes.status);
    console.log('Waiting:', JSON.stringify(queueRes.data.waiting, null, 2));

    console.log('\n== GET /api/queue/stats ==');
    const statsRes = await axios.get('http://localhost:3000/api/queue/stats', { headers });
    console.log('Status:', statsRes.status);
    console.log(JSON.stringify(statsRes.data, null, 2));

    console.log('\n== PATCH /api/queue/patients/:id/status (WITH_DOCTOR) ==');
    const patch1 = await axios.patch(`http://localhost:3000/api/queue/patients/${patientId}/status`, {
      status: 'WITH_DOCTOR'
    }, { headers });
    console.log('Status:', patch1.status);
    console.log(JSON.stringify(patch1.data, null, 2));

    console.log('\n== PATCH /api/queue/patients/:id/status (WAITING) ==');
    const patch2 = await axios.patch(`http://localhost:3000/api/queue/patients/${patientId}/status`, {
      status: 'WAITING'
    }, { headers });
    console.log('Status:', patch2.status);

    console.log('\n== PATCH /api/queue/patients/:id/status (COMPLETED from WAITING) ==');
    try {
      await axios.patch(`http://localhost:3000/api/queue/patients/${patientId}/status`, {
        status: 'COMPLETED'
      }, { headers });
    } catch (err) {
      console.log('Status:', err.response?.status);
      console.log(JSON.stringify(err.response?.data, null, 2));
    }

    console.log('\n== GET /api/patients ==');
    const patientsRes = await axios.get('http://localhost:3000/api/patients', { headers });
    console.log('Status:', patientsRes.status);
    console.log(JSON.stringify(patientsRes.data, null, 2));

    console.log('\n== GET /api/patients/:id ==');
    const patientRes = await axios.get(`http://localhost:3000/api/patients/${patientId}`, { headers });
    console.log('Status:', patientRes.status);
    console.log(JSON.stringify(patientRes.data, null, 2));

  } catch (err) {
    console.error('Error:', err.response?.data || err.message);
  }
}
run();
