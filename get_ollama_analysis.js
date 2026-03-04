const http = require('http');

const data = JSON.stringify({
  model: 'qwen3:latest',
  prompt: 'Give me a brief technical analysis for XRPUSD.',
  stream: false
});

const options = {
  hostname: 'localhost',
  port: 11434,
  path: '/api/generate',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => console.log(JSON.parse(body).response));
});

req.on('error', console.error);
req.write(data);
req.end();
