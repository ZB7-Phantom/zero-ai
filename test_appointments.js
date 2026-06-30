const axios = require('axios');

async function run() {
  try {
    console.log('== LOGIN ==');
    const loginRes = await axios.post('http://localhost:3000/api/auth/login', {
      email: 'admin@testclinic.com',
      password: 'testpass123',
    });
    const token = loginRes.data.token;
    const headers = { Authorization: `Bearer ${token}` };

    console.log('\n== POST /api/appointments ==');
    const appt1Res = await axios.post('http://localhost:3000/api/appointments', {
      patientName: 'Jane Doe',
      patientPhone: '2349000000002',
      scheduledAt: '2026-07-01T10:00:00.000Z',
      service: 'Cardiology',
      doctorName: 'Dr. Lan Mandragoran'
    }, { headers });
    console.log('Status:', appt1Res.status);
    console.log(JSON.stringify(appt1Res.data, null, 2));
    const appointmentId = appt1Res.data.id;

    console.log('\n== POST /api/appointments (CONFLICT) ==');
    try {
      await axios.post('http://localhost:3000/api/appointments', {
        patientName: 'John Smith',
        patientPhone: '2349000000003',
        scheduledAt: '2026-07-01T10:00:00.000Z',
        service: 'Cardiology',
        doctorName: 'Dr. Lan Mandragoran'
      }, { headers });
    } catch (err) {
      console.log('Status:', err.response?.status);
      console.log(JSON.stringify(err.response?.data, null, 2));
    }

    console.log('\n== GET /api/appointments?from=2026-06-29&to=2026-07-05 ==');
    const listRes = await axios.get('http://localhost:3000/api/appointments?from=2026-06-29&to=2026-07-05', { headers });
    console.log('Status:', listRes.status);
    console.log(JSON.stringify(listRes.data, null, 2));

    console.log('\n== PATCH /api/appointments/:id ==');
    const patchRes = await axios.patch(`http://localhost:3000/api/appointments/${appointmentId}`, {
      status: 'COMPLETED'
    }, { headers });
    console.log('Status:', patchRes.status);
    console.log(JSON.stringify(patchRes.data, null, 2));

    console.log('\n== GET /api/patients (Verify nextAppointmentAt) ==');
    const patientsRes = await axios.get('http://localhost:3000/api/patients', { headers });
    console.log('Status:', patientsRes.status);
    console.log(JSON.stringify(patientsRes.data.find(p => p.phone === '2349000000002'), null, 2));

  } catch (err) {
    console.error('Error:', err.response?.data || err.message);
  }
}
run();
