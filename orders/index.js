const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const http = require('http');

const app = express();
app.use(express.json());

const PORT = 5003;
const JWT_SECRET = process.env.JWT_SECRET || 'segredo_super_secreto_2024';
const DB_FILE = path.join(__dirname, 'orders.json');

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

function httpGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port, path, method: 'GET' }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.end();
  });
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'orders', port: PORT });
});

// Criar pedido
app.post('/orders', async (req, res) => {
  const decoded = verifyToken(req, res);
  if (!decoded) return;

  try {
    const { productId } = req.body;
    if (!productId) {
      return res.status(400).json({ error: 'productId é obrigatório' });
    }

    // Verifica se produto existe
    let product;
    try {
      product = await httpGet(5002, `/products/${productId}`);
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

// Listar pedidos de um usuário
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

app.listen(PORT, () => {
  console.log(`Serviço de Pedidos rodando na porta ${PORT}`);
});