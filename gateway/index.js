const express = require('express');
const http = require('http');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = 5000;

const SERVICES = {
  users: { port: 5001, healthy: true, failures: 0 },
  products: { port: 5002, healthy: true, failures: 0 },
  products_replica: { port: 5012, healthy: true, failures: 0 },
  orders: { port: 5003, healthy: true, failures: 0 }
};

let productsRoundRobin = 0;

// ─── Heartbeat ───────────────────────────────────────────────
function checkHealth(name, port) {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: 'localhost', port, path: '/health', method: 'GET', timeout: 3000 },
      (res) => {
        const wasDown = !SERVICES[name].healthy;
        SERVICES[name].healthy = true;
        SERVICES[name].failures = 0;
        if (wasDown) {
          console.log(`[${new Date().toISOString()}] RECUPERADO: ${name} (porta ${port})`);
          // Aciona sincronização automática ao retornar ao ar
          if (name === 'products' || name === 'products_replica') {
            syncReplica(name, port);
          }
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

// ─── Proxy helper ────────────────────────────────────────────
function forward(port, path, method, headers, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function getProductsPort() {
  const replicas = ['products', 'products_replica'].filter(n => SERVICES[n].healthy);
  if (replicas.length === 0) return null;
  const chosen = replicas[productsRoundRobin % replicas.length];
  productsRoundRobin++;
  return SERVICES[chosen].port;
}

// ─── Sincronização automática de réplica ─────────────────────
// Chamada quando o heartbeat detecta que uma réplica voltou ao ar.
// Busca todos os produtos da réplica saudável e envia para a que recuperou.
async function syncReplica(recoveringName, recoveringPort) {
  const peerName = recoveringName === 'products' ? 'products_replica' : 'products';
  const peerPort = recoveringName === 'products' ? 5012 : 5002;

  if (!SERVICES[peerName].healthy) {
    console.log(`[${new Date().toISOString()}] Sync impossível: ${peerName} (${peerPort}) também está fora do ar`);
    return;
  }

  try {
    console.log(`[${new Date().toISOString()}] Iniciando sync: ${recoveringName} (${recoveringPort}) ← ${peerName} (${peerPort})`);
    const r = await forward(peerPort, '/products', 'GET', {}, null);
    const products = JSON.parse(r.body);
    await forward(recoveringPort, '/products/sync', 'POST', {}, { products });
    console.log(`[${new Date().toISOString()}] Sync concluído: ${products.length} produto(s) enviado(s) para ${recoveringName} (${recoveringPort})`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Erro ao sincronizar ${recoveringName}: ${err.message}`);
  }
}

// ─── Health do gateway ───────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'gateway', services: SERVICES });
});

// ─── Dashboard ───────────────────────────────────────────────
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// ─── Rotas de Usuários ───────────────────────────────────────
app.post('/users/register', async (req, res) => {
  if (!SERVICES.users.healthy) return res.status(503).json({ error: 'Serviço de usuários indisponível' });
  try {
    const r = await forward(5001, '/users/register', 'POST', {}, req.body);
    res.status(r.status).json(JSON.parse(r.body));
  } catch (err) {
    res.status(503).json({ error: 'Serviço de usuários indisponível' });
  }
});

app.post('/users/login', async (req, res) => {
  if (!SERVICES.users.healthy) return res.status(503).json({ error: 'Serviço de usuários indisponível' });
  try {
    const r = await forward(5001, '/users/login', 'POST', {}, req.body);
    res.status(r.status).json(JSON.parse(r.body));
  } catch (err) {
    res.status(503).json({ error: 'Serviço de usuários indisponível' });
  }
});

app.get('/users/:id', async (req, res) => {
  if (!SERVICES.users.healthy) return res.status(503).json({ error: 'Serviço de usuários indisponível' });
  try {
    const r = await forward(5001, `/users/${req.params.id}`, 'GET', req.headers, null);
    res.status(r.status).json(JSON.parse(r.body));
  } catch (err) {
    res.status(503).json({ error: 'Serviço de usuários indisponível' });
  }
});

// ─── Rotas de Produtos ───────────────────────────────────────
app.get('/products', async (req, res) => {
  const port = getProductsPort();
  if (!port) return res.status(503).json({ error: 'Serviço de produtos indisponível' });
  try {
    const r = await forward(port, '/products', 'GET', {}, null);
    res.status(r.status).json(JSON.parse(r.body));
  } catch (err) {
    res.status(503).json({ error: 'Serviço de produtos indisponível' });
  }
});

app.get('/products/:id', async (req, res) => {
  const port = getProductsPort();
  if (!port) return res.status(503).json({ error: 'Serviço de produtos indisponível' });
  try {
    const r = await forward(port, `/products/${req.params.id}`, 'GET', {}, null);
    res.status(r.status).json(JSON.parse(r.body));
  } catch (err) {
    res.status(503).json({ error: 'Serviço de produtos indisponível' });
  }
});

app.post('/products', async (req, res) => {
  if (!SERVICES.products.healthy) return res.status(503).json({ error: 'Serviço de produtos indisponível' });
  try {
    // Escrita no primário (5002): valida JWT, cria produto e persiste
    const r = await forward(5002, '/products', 'POST', req.headers, req.body);
    if (r.status !== 201) return res.status(r.status).json(JSON.parse(r.body));

    const result = JSON.parse(r.body);

    // Replicação síncrona para o secundário antes de confirmar sucesso ao cliente
    if (SERVICES.products_replica.healthy) {
      try {
        await forward(5012, '/products/replicate', 'POST', {}, result.product);
      } catch (replicaErr) {
        console.warn(`[${new Date().toISOString()}] Falha ao replicar para products_replica (5012): ${replicaErr.message}`);
      }
    }

    res.status(201).json(result);
  } catch (err) {
    res.status(503).json({ error: 'Serviço de produtos indisponível' });
  }
});

// ─── Rotas de Pedidos ────────────────────────────────────────
app.post('/orders', async (req, res) => {
  if (!SERVICES.orders.healthy) return res.status(503).json({ error: 'Serviço de pedidos indisponível' });
  try {
    const r = await forward(5003, '/orders', 'POST', req.headers, req.body);
    res.status(r.status).json(JSON.parse(r.body));
  } catch (err) {
    res.status(503).json({ error: 'Serviço de pedidos indisponível' });
  }
});

app.get('/orders/:userId', async (req, res) => {
  if (!SERVICES.orders.healthy) return res.status(503).json({ error: 'Serviço de pedidos indisponível' });
  try {
    const r = await forward(5003, `/orders/${req.params.userId}`, 'GET', req.headers, null);
    res.status(r.status).json(JSON.parse(r.body));
  } catch (err) {
    res.status(503).json({ error: 'Serviço de pedidos indisponível' });
  }
});

app.listen(PORT, () => {
  console.log(`API Gateway rodando na porta ${PORT}`);
  console.log('Iniciando heartbeat a cada 5 segundos...');
});
