const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = 5000;

const sslOptions = {
  key: fs.readFileSync(path.join(__dirname, 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
};

const SERVICES = {
  users: { port: 5001, healthy: true, failures: 0 },
  products: { port: 5002, healthy: true, failures: 0 },
  products_replica: { port: 5012, healthy: true, failures: 0 },
  orders: { port: 5003, healthy: true, failures: 0 }
};

let productsRoundRobin = 0;

function forward(port, urlPath, method, headers, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port,
      path: urlPath,
      method,
      rejectUnauthorized: false,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function syncReplica(downPort, healthyPort) {
  try {
    const r = await forward(healthyPort, '/products', 'GET', {}, null);
    const products = JSON.parse(r.body);
    if (products.length === 0) return;
    const syncData = JSON.stringify(products);
    const options = {
      hostname: 'localhost',
      port: downPort,
      path: '/products/sync',
      method: 'POST',
      rejectUnauthorized: false,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(syncData)
      }
    };
    await new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          console.log(`[${new Date().toISOString()}] [SYNC] Porta ${downPort}: ${raw}`);
          resolve();
        });
      });
      req.on('error', reject);
      req.write(syncData);
      req.end();
    });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] [SYNC ERROR] Porta ${downPort}: ${err.message}`);
  }
}

function checkHealth(name, port) {
  return new Promise((resolve) => {
    const req = https.request(
      { hostname: 'localhost', port, path: '/health', method: 'GET', timeout: 3000, rejectUnauthorized: false },
      (res) => {
        const wasDown = !SERVICES[name].healthy;
        SERVICES[name].healthy = true;
        SERVICES[name].failures = 0;
        if (wasDown) {
          console.log(`[${new Date().toISOString()}] RECUPERADO: ${name} (porta ${port})`);
          if (name === 'products_replica') syncReplica(5012, 5002);
          if (name === 'products') syncReplica(5002, 5012);
        }
        resolve(true);
      }
    );
    req.on('error', () => {
      SERVICES[name].failures += 1;
      if (SERVICES[name].failures >= 2) {
        const wasUp = SERVICES[name].healthy;
        SERVICES[name].healthy = false;
        if (wasUp) {
          console.log(`[${new Date().toISOString()}] FALHA: ${name} (porta ${port}) está fora do ar`);
        }
      }
      resolve(false);
    });
    req.on('timeout', () => req.destroy());
    req.end();
  });
}

setInterval(async () => {
  for (const [name, service] of Object.entries(SERVICES)) {
    await checkHealth(name, service.port);
  }
}, 5000);

function getProductsPort() {
  const replicas = ['products', 'products_replica'].filter(n => SERVICES[n].healthy);
  if (replicas.length === 0) return null;
  const chosen = replicas[productsRoundRobin % replicas.length];
  productsRoundRobin++;
  return SERVICES[chosen].port;
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'gateway', services: SERVICES });
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.post('/users/register', async (req, res) => {
  if (!SERVICES.users.healthy) return res.status(503).json({ error: 'Serviço de usuários indisponível' });
  try {
    const r = await forward(5001, '/users/register', 'POST', {}, req.body);
    res.status(r.status).json(JSON.parse(r.body));
  } catch (e) {
    res.status(503).json({ error: 'Serviço de usuários indisponível' });
  }
});

app.post('/users/login', async (req, res) => {
  if (!SERVICES.users.healthy) return res.status(503).json({ error: 'Serviço de usuários indisponível' });
  try {
    const r = await forward(5001, '/users/login', 'POST', {}, req.body);
    res.status(r.status).json(JSON.parse(r.body));
  } catch (e) {
    res.status(503).json({ error: 'Serviço de usuários indisponível' });
  }
});

app.get('/users/:id', async (req, res) => {
  if (!SERVICES.users.healthy) return res.status(503).json({ error: 'Serviço de usuários indisponível' });
  try {
    const r = await forward(5001, `/users/${req.params.id}`, 'GET', { authorization: req.headers.authorization }, null);
    res.status(r.status).json(JSON.parse(r.body));
  } catch (e) {
    res.status(503).json({ error: 'Serviço de usuários indisponível' });
  }
});

app.get('/products', async (req, res) => {
  const port = getProductsPort();
  if (!port) return res.status(503).json({ error: 'Serviço de produtos indisponível' });
  try {
    const r = await forward(port, '/products', 'GET', {}, null);
    res.status(r.status).json(JSON.parse(r.body));
  } catch (e) {
    res.status(503).json({ error: 'Serviço de produtos indisponível' });
  }
});

app.get('/products/:id', async (req, res) => {
  const port = getProductsPort();
  if (!port) return res.status(503).json({ error: 'Serviço de produtos indisponível' });
  try {
    const r = await forward(port, `/products/${req.params.id}`, 'GET', {}, null);
    res.status(r.status).json(JSON.parse(r.body));
  } catch (e) {
    res.status(503).json({ error: 'Serviço de produtos indisponível' });
  }
});

app.post('/products', async (req, res) => {
  if (!SERVICES.products.healthy) return res.status(503).json({ error: 'Serviço de produtos indisponível' });
  try {
    const r = await forward(5002, '/products', 'POST', { authorization: req.headers.authorization }, req.body);
    if (r.status === 201) {
      const product = JSON.parse(r.body).product;
      if (SERVICES.products_replica.healthy) {
        await forward(5012, '/products/replicate', 'POST', {}, product);
      }
    }
    res.status(r.status).json(JSON.parse(r.body));
  } catch (e) {
    res.status(503).json({ error: 'Serviço de produtos indisponível' });
  }
});

app.post('/orders', async (req, res) => {
  if (!SERVICES.orders.healthy) return res.status(503).json({ error: 'Serviço de pedidos indisponível' });
  try {
    const r = await forward(5003, '/orders', 'POST', { authorization: req.headers.authorization }, req.body);
    res.status(r.status).json(JSON.parse(r.body));
  } catch (e) {
    res.status(503).json({ error: 'Serviço de pedidos indisponível' });
  }
});

app.get('/orders/:userId', async (req, res) => {
  if (!SERVICES.orders.healthy) return res.status(503).json({ error: 'Serviço de pedidos indisponível' });
  try {
    const r = await forward(5003, `/orders/${req.params.userId}`, 'GET', { authorization: req.headers.authorization }, null);
    res.status(r.status).json(JSON.parse(r.body));
  } catch (e) {
    res.status(503).json({ error: 'Serviço de pedidos indisponível' });
  }
});

https.createServer(sslOptions, app).listen(PORT, () => {
  console.log(`API Gateway rodando em HTTPS na porta ${PORT}`);
  console.log('Iniciando heartbeat a cada 5 segundos...');
});