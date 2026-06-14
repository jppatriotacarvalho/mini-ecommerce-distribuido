const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = 5000;
const USERS_HOST = process.env.USERS_HOST || 'localhost';
const PRODUCTS_HOST = process.env.PRODUCTS_HOST || 'localhost';
const PRODUCTS_REPLICA_HOST = process.env.PRODUCTS_REPLICA_HOST || 'localhost';
const ORDERS_HOST = process.env.ORDERS_HOST || 'localhost';
const INTERNAL_KEY = process.env.INTERNAL_KEY || 'internal-secret';

function findCertFile(filename) {
  const local = path.join(__dirname, filename);
  if (fs.existsSync(local)) return local;
  return path.join(__dirname, '..', 'certs', filename);
}

const sslOptions = {
  key: fs.readFileSync(findCertFile('key.pem')),
  cert: fs.readFileSync(findCertFile('cert.pem'))
};

const SERVICES = {
  users: { port: 5001, healthy: true, failures: 0 },
  products: { port: 5002, healthy: true, failures: 0 },
  products_replica: { port: 5012, healthy: true, failures: 0 },
  orders: { port: 5003, healthy: true, failures: 0 }
};

let productsRoundRobin = 0;

function hostForPort(port) {
  if (port === 5001) return USERS_HOST;
  if (port === 5002) return PRODUCTS_HOST;
  if (port === 5012) return PRODUCTS_REPLICA_HOST;
  if (port === 5003) return ORDERS_HOST;
  return 'localhost';
}

function forward(port, urlPath, method, headers, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: hostForPort(port),
      port,
      path: urlPath,
      method,
      rejectUnauthorized: false,
      timeout: 5000,
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
    req.on('timeout', () => req.destroy());
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
      hostname: hostForPort(downPort),
      port: downPort,
      path: '/products/sync',
      method: 'POST',
      rejectUnauthorized: false,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(syncData),
        'x-internal-key': INTERNAL_KEY
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
      { hostname: hostForPort(port), port, path: '/health', method: 'GET', timeout: 3000, rejectUnauthorized: false },
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

setInterval(() => {
  Promise.all(
    Object.entries(SERVICES).map(([name, service]) => checkHealth(name, service.port))
  );
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
        const rep = await forward(5012, '/products/replicate', 'POST', { 'x-internal-key': INTERNAL_KEY }, product);
        if (rep.status !== 200) {
          console.error(`[${new Date().toISOString()}] [REPLICATION ERROR] Réplica 5012 retornou status ${rep.status} — marcada como indisponível`);
          SERVICES.products_replica.healthy = false;
          SERVICES.products_replica.failures = 2;
        }
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