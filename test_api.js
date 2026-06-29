const http = require('http');

async function request(method, path, data, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };
    if (data) {
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }
    if (token) {
      options.headers['Authorization'] = 'Bearer ' + token;
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch(e) {
          resolve({ status: res.statusCode, body: body });
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  try {
    console.log("== REGISTER ==");
    const regRes = await request('POST', '/api/auth/register', JSON.stringify({
      fullName: "Test Admin", email: "admin@testclinic.com", password: "testpass123", clinicName: "Test Clinic"
    }));
    console.log(JSON.stringify(regRes, null, 2));

    console.log("== LOGIN ==");
    const loginRes = await request('POST', '/api/auth/login', JSON.stringify({
      email: "admin@testclinic.com", password: "testpass123"
    }));
    console.log(JSON.stringify(loginRes, null, 2));

    const token = loginRes.body.token;

    console.log("== GET CLINIC ==");
    const clinicRes = await request('GET', '/api/clinic', null, token);
    console.log(JSON.stringify(clinicRes, null, 2));

    console.log("== PATCH CLINIC ==");
    const patchRes = await request('PATCH', '/api/clinic', JSON.stringify({
      services: ["Cardiology", "Dermatology", "General Medicine"],
      address: "123 Test Street", openDays: [1,2,3,4,5],
      opensAt: "09:00", closesAt: "17:00"
    }), token);
    console.log(JSON.stringify(patchRes, null, 2));

    console.log("== ADD STAFF ==");
    const staffAddRes = await request('POST', '/api/staff', JSON.stringify({
      fullName: "Dr. Test", email: "doctor@testclinic.com", role: "PHYSICIAN"
    }), token);
    console.log(JSON.stringify(staffAddRes, null, 2));

    console.log("== GET STAFF ==");
    const staffGetRes = await request('GET', '/api/staff', null, token);
    console.log(JSON.stringify(staffGetRes, null, 2));

  } catch(err) {
    console.error(err);
  }
}
run();
