const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
app.use(express.json());

const PORT = 5003;
const JWT_SECRET = process.env.JWT_SECRET || 'senha12345678';
const PRODUCTS_HOST = process.env.PRODUCTS_HOST || 'localhost';
const DB_FILE = path.join(__dirname, 'orders.json');

const sslOptions = {
  key: fs.readFileSync(path.join(__dirname, 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
};

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify([]));
}

function getOrders() {
  return JSON.parse(fs.readFileSync(DB_FILE));
}

function saveOrders(orders) {
  fs.writeFileSync(DB_FILE, JSON.stringify(orders, null, 2));
}

function verifyToken(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token não fornecido' });
    return null;
  }
  try {
    const token = authHeader.split(' ')[1];
    return jwt.verify(token, JWT_SECRET);
  } catch {
    res.status(401).json({ error: 'Token inválido' });
    return null;
  }
}

function httpsGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: PRODUCTS_HOST,
      port,
      path,
      method: 'GET',
      rejectUnauthorized: false
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.end();
  });
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'orders', port: PORT });
});

app.post('/orders', async (req, res) => {
  const decoded = verifyToken(req, res);
  if (!decoded) return;
  try {
    const { productId } = req.body;
    if (!productId) {
      return res.status(400).json({ error: 'productId é obrigatório' });
    }
    let product;
    try {
      product = await httpsGet(5002, `/products/${productId}`);
    } catch {
      return res.status(404).json({ error: 'Produto não encontrado ou serviço indisponível' });
    }
    if (product.error) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    const newOrder = {
      id: Date.now().toString(),
      userId: decoded.userId,
      productId,
      productName: product.name,
      productPrice: product.price,
      status: 'criado',
      createdAt: new Date().toISOString()
    };
    const orders = getOrders();
    orders.push(newOrder);
    saveOrders(orders);
    res.status(201).json({ message: 'Pedido criado com sucesso', order: newOrder });
  } catch (error) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/orders/:userId', (req, res) => {
  const decoded = verifyToken(req, res);
  if (!decoded) return;
  try {
    const orders = getOrders();
    const userOrders = orders.filter(o => o.userId === req.params.userId);
    res.json(userOrders);
  } catch (error) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

https.createServer(sslOptions, app).listen(PORT, () => {
  console.log(`Serviço de Pedidos rodando em HTTPS na porta ${PORT}`);
});